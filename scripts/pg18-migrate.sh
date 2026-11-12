#!/bin/sh
# pg18-migrate.sh [--force-recreate-18] <compose args...>
#
# Migrates the OJ database from the old Postgres 16 volume (<project>_db-data)
# into the new Postgres 18 volume (<project>_db-data-18), end to end:
#
#   1. resolve the compose project name (docker compose <args> config --format json)
#   2. preconditions: old volume holds a Postgres 16 cluster; the 18 volume is
#      missing or empty (--force-recreate-18 deletes and recreates ONLY the 18
#      volume, after a typed confirmation)
#      free disk is checked, images are pulled and `docker compose build` runs
#      while the site is still up
#   3. stop every service of the project
#   4. start a temporary postgres:16-alpine on the old volume (no network)
#   5. back up: backups/pg16-<UTC>.sql (pg_dumpall, kept), .globals.sql,
#      .dump (pg_dump -Fc of the app database) and .counts (exact row counts
#      of every table in the app database's public schema)
#   6. stop and remove the temporary container (the old volume stays)
#   7. start the compose `database` service, which initialises Postgres 18
#   8. restore roles, then the app database
#   9. count every public table again and compare; any mismatch exits 1 with
#      the app stopped
#  10. write the migrated marker <18 volume>/.oj-pg18-migrated-from-16 (the
#      deploy guard requires it while the old volume exists), start the whole
#      stack, check the backend's pg_dump is 18, and print the runbook's
#      verification checklist
#
# The old volume's data is never modified or removed: no step deletes,
# re-initialises or writes user data to it. (Postgres itself rewrites its own
# system/WAL files when the temporary 16 server starts and stops cleanly.)
# Runbook: docs/runbooks/postgres-18-upgrade.md
#
# Run it inside tmux/screen: a dropped SSH session must not interrupt it.
# HUP/INT/TERM/PIPE are trapped and always stop the temporary 16 server first.
# Free space is checked up front (>= 4x the old cluster's data on the backups/
# filesystem, >= 2x on Docker's); OJ_PG18_SKIP_DISK_CHECK=1 skips the abort.
#
# Example (production, from the repository root):
#   scripts/pg18-migrate.sh -f docker-compose.yml -f docker-compose.production.yml
set -eu

RUNBOOK=docs/runbooks/postgres-18-upgrade.md
MARKER=.oj-pg18-migration-incomplete
DONE_MARKER=.oj-pg18-migrated-from-16
HELPER_IMAGE=alpine:3
PG16_IMAGE=postgres:16-alpine
KEY_TABLES="users problems testcases submissions contests"
WAIT_SECONDS=180

usage() {
    cat <<'EOF'
Usage: scripts/pg18-migrate.sh [--force-recreate-18] <docker compose args...>

  <docker compose args>  the same arguments deploy.sh passes to docker compose,
                         e.g. -f docker-compose.yml -f docker-compose.production.yml
  --force-recreate-18    the Postgres 18 volume already holds data: delete and
                         recreate ONLY that volume (asks for confirmation)

See docs/runbooks/postgres-18-upgrade.md.
EOF
}

force=0
while [ $# -gt 0 ]; do
    case $1 in
        --force-recreate-18) force=1; shift ;;
        -h | --help) usage; exit 0 ;;
        --) shift; break ;;
        *) break ;;
    esac
done
if [ $# -eq 0 ]; then
    usage >&2
    exit 64
fi

cd "$(dirname "$0")/.."
umask 077

# Keep the compose arguments as one shell-quoted string so helper functions
# can reuse them (POSIX sh has no arrays).
shell_quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}
compose_args=
for arg do
    compose_args="$compose_args $(shell_quote "$arg")"
done
dc() {
    eval "docker compose $compose_args \"\$@\""
}
rerun_cmd="scripts/pg18-migrate.sh$compose_args"

stage=preflight
project=
old_volume=
new_volume=
tmp_dir=
pg16_container=
backup_base=

log() {
    printf '\n==> %s\n' "$*"
}

die() {
    printf 'pg18-migrate: ERROR: %s\n' "$*" >&2
    exit 1
}

on_exit() {
    status=$?
    # Cleanup first, before printing anything: stdout may be a pipe whose
    # reader (tee) is already gone, and a second Ctrl-C/HUP must not cut the
    # temporary server's shutdown short.
    trap '' PIPE HUP INT TERM
    trap - EXIT
    set +e
    if [ -n "$pg16_container" ] && docker container inspect "$pg16_container" >/dev/null 2>&1; then
        docker stop -t 120 "$pg16_container" >/dev/null 2>&1
        docker rm -f "$pg16_container" >/dev/null 2>&1
        pg16_cleanup="stopped and removed the temporary Postgres 16 container $pg16_container"
    fi
    if [ -n "$tmp_dir" ]; then
        rm -rf "$tmp_dir"
    fi
    [ -n "${pg16_cleanup:-}" ] && echo "$pg16_cleanup"
    echo
    if [ "$status" -eq 0 ]; then
        cat <<EOF
pg18-migrate: DONE.
  Postgres 18 data: $new_volume (migrated, row counts match)
  Postgres 16 data: $old_volume (kept, data unmodified; remove it only as described in $RUNBOOK)
  Backups:          $backup_base.{sql,globals.sql,dump,counts} and ${backup_base%/*}/pg18-${backup_base##*/pg16-}.counts
Next: ./deploy.sh   (builds this release, passes the upgrade guard, health-checks the site)
      then run the manual verification checklist above.
EOF
        exit 0
    fi
    printf 'pg18-migrate: FAILED (exit %s) during stage: %s\n' "$status" "$stage"
    echo "  Postgres 16 data: ${old_volume:-<project>_db-data} was NOT removed, recreated or modified."
    case $stage in
        preflight)
            echo "  Nothing was changed and the app was not stopped."
            echo "Next: fix the problem above, then re-run: $rerun_cmd"
            ;;
        stop | prepare | pg16-start | backup | pg16-stop)
            echo "  The app is STOPPED. Postgres 18 has not been initialised yet."
            echo "Next: fix the problem above and re-run: $rerun_cmd"
            echo "      or roll back to Postgres 16: see 'Rollback' in $RUNBOOK"
            ;;
        pg18-init | restore | verify)
            echo "  The app is STOPPED (only the database service may be running, for inspection)."
            echo "  ${new_volume:-the 18 volume} holds an INCOMPLETE Postgres 18 cluster;"
            echo "  deploy.sh refuses to start on it ($MARKER is present)."
            [ -n "$backup_base" ] && echo "  Postgres 16 backups: $backup_base.*"
            echo "Next: inspect (docker compose$compose_args logs database), then start over with:"
            echo "        scripts/pg18-migrate.sh --force-recreate-18$compose_args"
            echo "      or roll back to Postgres 16: see 'Rollback' in $RUNBOOK"
            ;;
        finalise)
            echo "  Row counts matched, but writing the migrated marker $DONE_MARKER failed;"
            echo "  the app is STOPPED and deploy.sh still refuses."
            echo "Next: start over with: scripts/pg18-migrate.sh --force-recreate-18$compose_args"
            ;;
        start)
            echo "  The data migration completed and was verified, but starting the stack failed."
            echo "Next: ./deploy.sh"
            ;;
        check-images)
            echo "  The data migration completed and was verified and the stack is up, but the"
            echo "  backend image is not this release's (pg_dump must be 18; admin DB export fails)."
            echo "Next: ./deploy.sh   (rebuilds the images), then check:"
            echo "      docker compose$compose_args exec -T backend pg_dump --version"
            ;;
    esac
    exit "$status"
}
pg16_cleanup=
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 141' PIPE
trap 'exit 143' TERM

# Same resolution as scripts/pg18-guard.sh.
resolve_project() {
    config_json=$(dc config --format json) ||
        die "docker compose config failed; cannot determine the project name"
    name=$(printf '%s\n' "$config_json" | awk '
        /^  "name": "/ { sub(/^  "name": "/, ""); sub(/",?[[:space:]]*$/, ""); print; exit }
        NR == 1 && /^\{"name":"/ { s = $0; sub(/^\{"name":"/, "", s); sub(/".*$/, "", s); print s; exit }
    ')
    case $name in
        '' | *[!a-z0-9_-]*) die "could not read the project name from docker compose config (got '$name')" ;;
    esac
    printf '%s\n' "$name"
}

# 0 = exists, 1 = no such volume; any other Docker error aborts (fail closed).
volume_exists() {
    if err=$(docker volume inspect "$1" 2>&1 >/dev/null); then
        return 0
    fi
    case $err in
        *"o such volume"*) return 1 ;;
    esac
    die "docker volume inspect $1 failed: $err"
}

# Trimmed contents of <path> inside volume <vol> (read-only), or __MISSING__.
volume_file() {
    out=$(docker run --rm --network none -v "$1:/v:ro" "$HELPER_IMAGE" \
        sh -c 'if [ -f "/v/$1" ]; then cat "/v/$1"; else echo __MISSING__; fi' sh "$2") ||
        die "could not read $2 from volume $1"
    printf '%s' "$out" | tr -d '[:space:]'
}

# Regular files in volume <vol> other than the migration marker (first few).
volume_data_files() {
    docker run --rm --network none -v "$1:/v:ro" "$HELPER_IMAGE" \
        sh -c 'find /v -type f ! -name "$1" | head -n 5' sh "$MARKER" ||
        die "could not list volume $1"
}

# Runs SQL from stdin with psql inside container $1, against database $2
# (default: the app database), using the container's own POSTGRES_* env.
psql_in() {
    docker exec -i "$1" sh -c \
        'psql -X -q -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}" -f -' sh "${2:-}"
}

# Exact row count of every table in the public schema, "table|count" per line.
COUNT_SQL="SELECT format('%s|%s', c.relname,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
 ORDER BY c.relname;"

write_counts() { # container output-file
    printf '%s\n' "$COUNT_SQL" | psql_in "$1" >"$2.tmp" || die "row count query failed in $1"
    LC_ALL=C sort "$2.tmp" >"$2"
    rm -f "$2.tmp"
}

count_of() { # table counts-file
    awk -F'|' -v t="$1" '$1 == t { print $2; found = 1 } END { if (!found) print "missing" }' "$2"
}

server_version() { # container
    printf '%s\n' "SHOW server_version;" | psql_in "$1" postgres
}

wait_until() { # description command...
    what=$1
    shift
    i=0
    until "$@"; do
        i=$((i + 2))
        [ "$i" -lt "$WAIT_SECONDS" ] || die "timed out after ${WAIT_SECONDS}s waiting for $what"
        sleep 2
    done
}

# --- 1. project ---------------------------------------------------------------
log "Resolving the compose project"
docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon (docker info failed)"
project=$(resolve_project)
old_volume="${project}_db-data"
new_volume="${project}_db-data-18"
pg16_name="${project}-pg16-migrate"
echo "project: $project"
echo "Postgres 16 volume (source, kept): $old_volume"
echo "Postgres 18 volume (target):       $new_volume"

# --- 2. preconditions ---------------------------------------------------------
log "Checking preconditions"
volume_exists "$old_volume" || die "$old_volume does not exist: nothing to migrate (fresh installs need no migration)"
old_version=$(volume_file "$old_volume" PG_VERSION)
[ "$old_version" = 16 ] || die "$old_volume has PG_VERSION=$old_version, expected a Postgres 16 cluster"
echo "ok: $old_volume holds a Postgres 16 cluster"

recreate_18=0
if volume_exists "$new_volume"; then
    new_files=$(volume_data_files "$new_volume")
    if [ -n "$new_files" ]; then
        echo "$new_volume already holds data, e.g.:"
        printf '%s\n' "$new_files" | sed 's|^/v/|    |'
        if [ "$force" -ne 1 ]; then
            die "$new_volume is not empty. To DELETE it and migrate again from $old_volume, re-run with --force-recreate-18"
        fi
        case $new_volume in
            *_db-data-18) ;;
            *) die "refusing to delete unexpected volume name $new_volume" ;;
        esac
        [ "$new_volume" != "$old_volume" ] || die "refusing: source and target volume are the same"
        printf 'This DELETES volume %s and everything in it (%s is kept).\n' "$new_volume" "$old_volume"
        printf 'Type the volume name to confirm: '
        answer=
        read -r answer || true
        [ -t 0 ] || echo
        [ "$answer" = "$new_volume" ] || die "confirmation did not match; nothing was deleted"
        recreate_18=1
    else
        echo "ok: $new_volume exists and is empty"
    fi
else
    echo "ok: $new_volume does not exist yet"
fi

mkdir -p backups
[ -w backups ] || die "backups/ is not writable"

# Disk: the plain pg_dumpall writes bytea as hex (~2x), plus the .dump, plus
# transient copies in the containers, plus the new 18 cluster.
data_kb=$(docker run --rm --network none -v "$old_volume:/v:ro" "$HELPER_IMAGE" du -sk /v/base | awk '{ print $1 }') ||
    die "could not measure $old_volume"
backups_free_kb=$(df -Pk backups | awk 'NR == 2 { print $4 }')
docker_free_kb=$(docker run --rm --network none -v "$old_volume:/v:ro" "$HELPER_IMAGE" df -Pk /v | awk 'NR == 2 { print $4 }') ||
    die "could not measure free space on the Docker data filesystem"
docker_root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo unknown)
mb() { awk -v k="$1" 'BEGIN { printf "%.0f MiB", k / 1024 }'; }
echo "Old cluster data (base/):        $(mb "$data_kb")"
echo "Free on backups/ filesystem:     $(mb "$backups_free_kb") (need >= 4x = $(mb $((data_kb * 4))))"
echo "Free on Docker data filesystem:  $(mb "$docker_free_kb") (need >= 2x = $(mb $((data_kb * 2)))); DockerRootDir=$docker_root"
df -h backups | sed 's/^/    /'
if [ -d "$docker_root" ]; then
    df -h "$docker_root" | sed 's/^/    /'
fi
if [ "$backups_free_kb" -lt $((data_kb * 4)) ] || [ "$docker_free_kb" -lt $((data_kb * 2)) ]; then
    if [ "${OJ_PG18_SKIP_DISK_CHECK:-}" = 1 ]; then
        echo "warning: not enough free space by the rule above; continuing because OJ_PG18_SKIP_DISK_CHECK=1"
    else
        die "not enough free disk space (see above); free space or set OJ_PG18_SKIP_DISK_CHECK=1 if you are sure"
    fi
fi

echo "Pulling images (best effort, before the app is stopped) ..."
docker image inspect "$PG16_IMAGE" >/dev/null 2>&1 || docker pull -q "$PG16_IMAGE" >/dev/null
docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1 || docker pull -q "$HELPER_IMAGE" >/dev/null
dc pull -q database || echo "warning: could not pull the database image; using the local one"

# Build this release's images now, while the site is still up: the final
# `up -d` must not start a backend image left over from the Postgres 16
# release (its pg_dump 16 cannot export from an 18 server).
log "Building this release's images (the app is still running)"
dc build || die "docker compose build failed; nothing was stopped"

# --- 3. stop the app ----------------------------------------------------------
stage=stop
log "Stopping every service of project $project"
dc stop
# A temporary 16 server left by an earlier run that was killed outright
# (SIGKILL, power loss) would otherwise keep the old volume open.
if docker container inspect "$pg16_name" >/dev/null 2>&1; then
    echo "stopping a leftover $pg16_name container from an earlier run"
    docker stop -t 120 "$pg16_name" >/dev/null || true
    docker rm -f "$pg16_name" >/dev/null
fi
running=$(docker ps -q --filter "volume=$old_volume")
[ -z "$running" ] || die "containers still running on $old_volume: $running"
running=$(docker ps -q --filter "volume=$new_volume")
[ -z "$running" ] || die "containers still running on $new_volume: $running"

if [ "$recreate_18" -eq 1 ]; then
    log "Recreating $new_volume (only this volume)"
    users=$(docker ps -aq --filter "volume=$new_volume" --filter "label=com.docker.compose.project=$project")
    if [ -n "$users" ]; then
        # shellcheck disable=SC2086 # container ids, one per word
        docker rm $users >/dev/null
    fi
    docker volume rm "$new_volume" >/dev/null
fi

# --- 4. temporary Postgres 16 ---------------------------------------------------
stage=prepare
log "Reading POSTGRES_* from the compose database service"
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/oj-pg18-migrate.XXXXXX")
# Read POSTGRES_* exactly as compose passes them to the database container.
# (This creates the 18 volume, still empty, with compose's labels.)
dc run --rm --no-deps -T --entrypoint env database >"$tmp_dir/env.all"
grep -E '^POSTGRES_(DB|USER|PASSWORD)=' "$tmp_dir/env.all" >"$tmp_dir/pg.env" || true
pg_user=$(sed -n 's/^POSTGRES_USER=//p' "$tmp_dir/pg.env" | head -n 1)
pg_db=$(sed -n 's/^POSTGRES_DB=//p' "$tmp_dir/pg.env" | head -n 1)
if [ -z "$pg_user" ]; then
    pg_user=postgres
    echo "POSTGRES_USER=$pg_user" >>"$tmp_dir/pg.env"
fi
if [ -z "$pg_db" ]; then
    pg_db=$pg_user
    echo "POSTGRES_DB=$pg_db" >>"$tmp_dir/pg.env"
fi
echo "app database: $pg_db (superuser $pg_user)"
docker run --rm --network none -v "$new_volume:/v" "$HELPER_IMAGE" \
    sh -c 'date -u +%Y-%m-%dT%H:%M:%SZ >"/v/$1"' sh "$MARKER"

stage=pg16-start
log "Starting a temporary Postgres 16 on $old_volume (no network)"
pg16_container=$pg16_name
docker run -d --name "$pg16_container" --network none --env-file "$tmp_dir/pg.env" \
    -v "$old_volume:/var/lib/postgresql/data" "$PG16_IMAGE" >/dev/null
pg16_ready() {
    [ "$(docker inspect -f '{{.State.Running}}' "$pg16_container")" = true ] || {
        docker logs --tail 30 "$pg16_container" >&2
        die "the temporary Postgres 16 container exited"
    }
    docker exec "$pg16_container" sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}
wait_until "Postgres 16 to accept connections" pg16_ready
v16=$(server_version "$pg16_container")
case $v16 in 16*) ;; *) die "temporary server reports version $v16, expected 16" ;; esac
echo "Postgres $v16 is up"

# --- 5. backups -----------------------------------------------------------------
stage=backup
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_base="backups/pg16-$stamp"
counts16="$backup_base.counts"
counts18="backups/pg18-$stamp.counts"
log "Writing backups to $backup_base.*"
docker exec "$pg16_container" sh -c 'pg_dumpall -U "$POSTGRES_USER"' >"$backup_base.sql"
grep -q 'PostgreSQL database cluster dump complete' "$backup_base.sql" ||
    die "$backup_base.sql looks incomplete"
docker exec "$pg16_container" sh -c 'pg_dumpall -U "$POSTGRES_USER" --globals-only' >"$backup_base.globals.sql"
docker exec "$pg16_container" sh -c \
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/oj-app.dump && pg_restore -l /tmp/oj-app.dump >/dev/null'
docker cp -q "$pg16_container:/tmp/oj-app.dump" "$backup_base.dump"
chmod 600 "$backup_base.dump"
write_counts "$pg16_container" "$counts16"
[ -s "$counts16" ] || die "no tables found in the public schema of $pg_db"
for table in $KEY_TABLES; do
    [ "$(count_of "$table" "$counts16")" != missing ] ||
        die "table $table not found in $pg_db: is this the OJ database?"
done
for f in "$backup_base.sql" "$backup_base.globals.sql" "$backup_base.dump" "$counts16"; do
    printf '    %s (%s bytes)\n' "$f" "$(wc -c <"$f" | tr -d ' ')"
done
echo "Postgres 16 row counts: $(wc -l <"$counts16" | tr -d ' ') tables"
for table in $KEY_TABLES; do
    printf '    %-12s %s\n' "$table" "$(count_of "$table" "$counts16")"
done

# --- 6. stop the temporary server -----------------------------------------------
stage=pg16-stop
log "Stopping the temporary Postgres 16 (the volume stays)"
docker stop -t 120 "$pg16_container" >/dev/null
docker rm "$pg16_container" >/dev/null
pg16_container=

# --- 7. Postgres 18 ---------------------------------------------------------------
stage=pg18-init
log "Starting Postgres 18 (initialises $new_volume)"
dc up -d database
db_container=$(dc ps -q database)
[ -n "$db_container" ] || die "the database container did not start"
pg18_ready() {
    [ "$(docker inspect -f '{{.State.Running}}' "$db_container")" = true ] || {
        docker logs --tail 30 "$db_container" >&2
        die "the Postgres 18 container exited"
    }
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$db_container")" = healthy ] &&
        # TCP only listens once the entrypoint's init-time server has restarted.
        docker exec "$db_container" sh -c 'pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}
wait_until "Postgres 18 to become healthy" pg18_ready
v18=$(server_version "$db_container")
case $v18 in 18*) ;; *) die "database service reports version $v18, expected 18" ;; esac
tables18=$(printf '%s\n' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');" | psql_in "$db_container")
[ "$tables18" = 0 ] || die "the new Postgres 18 database $pg_db already has $tables18 tables"
echo "Postgres $v18 is up with an empty $pg_db"

# --- 8. restore -------------------------------------------------------------------
stage=restore
log "Restoring roles"
# The bootstrap superuser already exists in 18 with the password compose gave
# it; skip its CREATE/ALTER ... WITH lines and restore every other role.
awk -v u="$pg_user" '
    BEGIN { q = "\"" u "\"" }
    ($1 == "CREATE" && $2 == "ROLE" && ($3 == u ";" || $3 == q ";")) { next }
    ($1 == "ALTER" && $2 == "ROLE" && ($3 == u || $3 == q) && $4 == "WITH") { next }
    { print }
' "$backup_base.globals.sql" >"$tmp_dir/globals.sql"
# Without ON_ERROR_STOP, psql exits 0 even when statements fail (checked
# below); a non-zero exit means it could not run at all (2 = connection).
psql_rc=0
docker exec -i "$db_container" sh -c 'psql -X -q -U "$POSTGRES_USER" -d postgres -f -' \
    <"$tmp_dir/globals.sql" >"$tmp_dir/globals.out" 2>"$tmp_dir/globals.err" || psql_rc=$?
if [ "$psql_rc" -ne 0 ]; then
    cat "$tmp_dir/globals.err" >&2
    die "psql could not restore roles (exit $psql_rc)"
fi
if grep 'ERROR:' "$tmp_dir/globals.err" | grep -v 'role ".*" already exists' >"$tmp_dir/globals.bad"; then
    cat "$tmp_dir/globals.err" >&2
    die "restoring roles failed (only 'role already exists' is ignored)"
fi
grep 'already exists' "$tmp_dir/globals.err" | sed 's/^/    ignored: /' || true

log "Restoring $pg_db from $backup_base.dump"
docker cp -q "$backup_base.dump" "$db_container:/tmp/oj-app.dump"
docker exec "$db_container" sh -c \
    'pg_restore --no-owner --role="$POSTGRES_USER" --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/oj-app.dump; s=$?; rm -f /tmp/oj-app.dump; exit $s'

# --- 9. verify --------------------------------------------------------------------
stage=verify
log "Comparing exact row counts (16 vs 18)"
write_counts "$db_container" "$counts18"
printf '    %-12s %10s %10s\n' table pg16 pg18
for table in $KEY_TABLES; do
    printf '    %-12s %10s %10s\n' "$table" "$(count_of "$table" "$counts16")" "$(count_of "$table" "$counts18")"
done
if ! diff -u "$counts16" "$counts18" >"$tmp_dir/counts.diff"; then
    echo "Row counts DIFFER between Postgres 16 and 18:" >&2
    cat "$tmp_dir/counts.diff" >&2
    die "row count mismatch ($counts16 vs $counts18); the app stays stopped"
fi
echo "ok: all $(wc -l <"$counts16" | tr -d ' ') public tables have identical row counts"

# --- 10. finalise and start -----------------------------------------------------------
stage=finalise
# Only reached after the row counts matched. The migrated marker (root of the
# 18 volume) is what lets deploy.sh's guard pass while the old 16 volume
# exists; it is written last and atomically, so an interrupted or failed run
# never leaves it behind.
docker exec "$db_container" sh -c \
    'cd /var/lib/postgresql && rm -f "$4" &&
     printf "from=%s\nbackup=%s\nat=%s\n" "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$3.tmp" &&
     mv -f "$3.tmp" "$3"' \
    sh "$old_volume" "$backup_base" "$DONE_MARKER" "$MARKER"
eval "scripts/pg18-guard.sh $compose_args" || die "the upgrade guard still refuses this state"

stage=start
log "Starting the stack (images built above)"
dc up -d

stage=check-images
if dc config --services | grep -qx backend; then
    log "Checking that the backend's pg_dump is Postgres 18"
    backend_running() {
        [ -n "$(dc ps -q --status running backend)" ]
    }
    wait_until "the backend container to run" backend_running
    pg_dump_version=$(dc exec -T backend pg_dump --version) ||
        die "could not run pg_dump in the backend container"
    echo "backend: $pg_dump_version"
    pg_dump_major=$(printf '%s\n' "$pg_dump_version" | awk '
        { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+(\.[0-9]+)*$/) { split($i, v, "."); print v[1]; exit } }')
    [ "$pg_dump_major" = 18 ] ||
        die "the backend image has pg_dump ${pg_dump_major:-?}, expected 18 (admin DB export would fail)"
else
    echo "(no backend service in this compose configuration; pg_dump check skipped)"
fi

log "Verification checklist ($RUNBOOK)"
if [ -f "$RUNBOOK" ]; then
    awk '/<!-- checklist:start -->/ { on = 1; next } /<!-- checklist:end -->/ { on = 0 } on' "$RUNBOOK"
else
    echo "Log in, open recent submissions, open a contest scoreboard, run an admin export."
fi
