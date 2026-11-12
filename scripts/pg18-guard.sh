#!/bin/sh
# pg18-guard.sh [compose args...]
#
# Deploy-time guard for the Postgres 16 -> 18 upgrade. It stops a deploy that
# would bring the site up on an empty Postgres 18 database while the real data
# still sits in the old Postgres 16 volume.
#
#   <project>_db-data     old volume (Postgres 16, data directory at its root)
#   <project>_db-data-18  new volume (Postgres 18, cluster at 18/docker/)
#
# Exit codes:
#   0  no old volume (or an old volume without PG_VERSION): fresh install or
#      already cleaned up; or the 18 volume holds a cluster that
#      scripts/pg18-migrate.sh migrated and verified (marker
#      .oj-pg18-migrated-from-16) and the old volume has not been started since
#   1  Docker unreachable, or a volume could not be read (fails closed)
#   2  migration required / refused: the old volume holds a cluster (any
#      PG_VERSION) and the 18 volume is missing, has no cluster, has a cluster
#      WITHOUT the migrated marker (e.g. a raw `docker compose up` initialised
#      it empty), or the marker's pg_control hash no longer matches the old
#      volume (it was started again after the migration: a rollback); or the
#      18 volume carries .oj-pg18-migration-incomplete (always, even with no
#      old volume)
#   3  the 18 volume holds a pre-18 data directory at its root
#
# The migrated marker lives at the root of the 18 volume (next to 18/); only
# scripts/pg18-migrate.sh writes it, after the 16-vs-18 row counts matched. It
# records pg16_pg_control_sha256, the sha256 of the old volume's
# global/pg_control after the temporary 16 server stopped: any later start of
# Postgres 16 on the old volume rewrites pg_control and so invalidates it.
#
# The project name is resolved the way docker compose resolves it:
# `docker compose <args> config --format json` -> top-level "name".
# OJ_PG_GUARD_PROJECT overrides it (tests only). Volumes are only read, through
# a read-only mount; nothing is ever written or removed.
set -eu

RUNBOOK=docs/runbooks/postgres-18-upgrade.md
MARKER=.oj-pg18-migration-incomplete
DONE_MARKER=.oj-pg18-migrated-from-16
HELPER_IMAGE=alpine:3

cd "$(dirname "$0")/.."

die() {
    printf 'pg18-guard: %s\n' "$*" >&2
    exit 1
}

# Prints the compose project name for the given compose arguments.
resolve_project() {
    if [ -n "${OJ_PG_GUARD_PROJECT:-}" ]; then
        printf '%s\n' "$OJ_PG_GUARD_PROJECT"
        return 0
    fi
    config_json=$(docker compose "$@" config --format json) ||
        die "docker compose config failed; cannot determine the project name"
    # Compose prints indented JSON whose first key is the top-level "name";
    # also accept a compact rendering. Project names are [a-z0-9_-], so no
    # JSON escapes can occur in them.
    name=$(printf '%s\n' "$config_json" | awk '
        /^  "name": "/ { sub(/^  "name": "/, ""); sub(/",?[[:space:]]*$/, ""); print; exit }
        NR == 1 && /^\{"name":"/ { s = $0; sub(/^\{"name":"/, "", s); sub(/".*$/, "", s); print s; exit }
    ')
    case $name in
        '' | *[!a-z0-9_-]*) die "could not read the project name from docker compose config (got '$name')" ;;
    esac
    printf '%s\n' "$name"
}

# 0 = exists, 1 = no such volume; any other Docker error fails closed.
volume_exists() {
    if err=$(docker volume inspect "$1" 2>&1 >/dev/null); then
        return 0
    fi
    case $err in
        *"o such volume"*) return 1 ;;
    esac
    die "docker volume inspect $1 failed: $err"
}

# Prints the trimmed contents of <path> inside volume <vol>, or __MISSING__.
# Any Docker failure aborts the guard (fail closed) instead of reading as "missing".
volume_file() {
    out=$(docker run --rm --network none -v "$1:/v:ro" "$HELPER_IMAGE" \
        sh -c 'if [ -f "/v/$1" ]; then cat "/v/$1"; else echo __MISSING__; fi' sh "$2") ||
        die "could not read $2 from volume $1"
    printf '%s' "$out" | tr -d '[:space:]'
}

docker info >/dev/null 2>&1 ||
    die "cannot reach the Docker daemon (docker info failed); refusing to guess the volume state"
# Value of key=<value> lines in <file> inside volume <vol>, or empty.
volume_marker_value() {
    docker run --rm --network none -v "$1:/v:ro" "$HELPER_IMAGE" \
        sh -c 'sed -n "s/^$2=//p" "/v/$1" 2>/dev/null | head -n 1' sh "$2" "$3" ||
        die "could not read $2 from volume $1"
}

# sha256 of <path> inside volume <vol>, or __MISSING__.
volume_sha256() {
    out=$(docker run --rm --network none -v "$1:/v:ro" "$HELPER_IMAGE" \
        sh -c 'if [ -f "/v/$1" ]; then sha256sum "/v/$1"; else echo __MISSING__; fi' sh "$2") ||
        die "could not hash $2 in volume $1"
    printf '%s\n' "${out%% *}"
}

project=$(resolve_project "$@")
old_volume="${project}_db-data"
new_volume="${project}_db-data-18"

old_version=absent
if volume_exists "$old_volume"; then
    old_version=$(volume_file "$old_volume" PG_VERSION)
fi

new_root=absent
new_version=absent
new_marker=absent
new_done=absent
new_rolled=absent
if volume_exists "$new_volume"; then
    new_root=$(volume_file "$new_volume" PG_VERSION)
    new_version=$(volume_file "$new_volume" 18/docker/PG_VERSION)
    new_marker=$(volume_file "$new_volume" "$MARKER")
    new_done=$(volume_file "$new_volume" "$DONE_MARKER")
    new_rolled=$(volume_file "$new_volume" .oj-pg18-rolled-back)
fi

if [ "$new_root" != absent ] && [ "$new_root" != __MISSING__ ]; then
    printf '%s\n' \
        "Postgres 18 volume holds a Postgres $new_root data directory at its root: see $RUNBOOK" \
        "  new volume: $new_volume (expected the cluster at 18/docker/, found PG_VERSION=$new_root at /)" \
        "  old volume: $old_volume" \
        "Refusing to deploy. Do not delete either volume; follow the runbook."
    exit 3
fi

if [ "$new_marker" != absent ] && [ "$new_marker" != __MISSING__ ]; then
    printf '%s\n' \
        "Postgres 18 upgrade required: see $RUNBOOK" \
        "  new volume: $new_volume carries $MARKER: a migration into it was interrupted or failed" \
        "  old volume: $old_volume" \
        "Refusing to deploy: the site would start on an incomplete database." \
        "Next: scripts/pg18-migrate.sh --force-recreate-18 $*"
    exit 2
fi

if [ "$old_version" != absent ] && [ "$old_version" != __MISSING__ ]; then
    if [ "$new_version" = 18 ] && [ "$new_done" != __MISSING__ ]; then
        recorded=$(volume_marker_value "$new_volume" "$DONE_MARKER" pg16_pg_control_sha256)
        if [ -z "$recorded" ]; then
            echo "pg18-guard: warning: $new_volume/$DONE_MARKER has no pg16_pg_control_sha256 line" \
                "(hand-made marker?); cannot tell whether $old_volume was started after the migration" >&2
            echo "pg18-guard: ok ($new_volume holds a Postgres 18 cluster marked as migrated; $old_volume is kept)"
            exit 0
        fi
        current=$(volume_sha256 "$old_volume" global/pg_control)
        if [ "$current" = "$recorded" ]; then
            echo "pg18-guard: ok ($new_volume holds the migrated Postgres 18 cluster; $old_volume is kept and unchanged since)"
            exit 0
        fi
        printf '%s\n' \
            "Postgres 18 upgrade required: see $RUNBOOK" \
            "  old volume: $old_volume was started after the migration (rollback?): its pg_control no longer matches the marker" \
            "  new volume: $new_volume holds the OLDER, first-migration data" \
            "Refusing to deploy: the site would switch to stale data and lose what was written to 16 since." \
            "Next: export anything written to 18 first, then re-run: scripts/pg18-migrate.sh --force-recreate-18 $*"
        exit 2
    fi
    next="scripts/pg18-migrate.sh $*"
    if [ "$new_version" = 18 ] && [ "$new_rolled" != absent ] && [ "$new_rolled" != __MISSING__ ]; then
        state="was rolled back to Postgres 16 (.oj-pg18-rolled-back); its data is stale"
        next="export anything written to 18 first, then re-run: scripts/pg18-migrate.sh --force-recreate-18 $*"
    elif [ "$new_version" = 18 ]; then
        state="was initialised WITHOUT migrating the old data (no $DONE_MARKER marker), e.g. by a plain docker compose up"
        next="scripts/pg18-migrate.sh --force-recreate-18 $*"
    elif [ "$new_version" = absent ]; then
        state="does not exist"
    else
        state="has no initialised Postgres 18 cluster"
    fi
    if [ "$old_version" != 16 ]; then
        next="see $RUNBOOK (scripts/pg18-migrate.sh only migrates Postgres 16; $old_volume has PG_VERSION=$old_version)"
    fi
    printf '%s\n' \
        "Postgres 18 upgrade required: see $RUNBOOK" \
        "  old volume: $old_volume (Postgres $old_version data, kept)" \
        "  new volume: $new_volume ($state)" \
        "Refusing to deploy: the site would start on an empty or incomplete database." \
        "Next: $next"
    exit 2
fi

if [ "$old_version" = absent ]; then
    echo "pg18-guard: ok (no old volume $old_volume; fresh install or already cleaned up)"
else
    echo "pg18-guard: ok ($old_volume holds no Postgres cluster (no PG_VERSION))"
fi
