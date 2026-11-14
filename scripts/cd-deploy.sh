#!/bin/sh
# cd-deploy.sh <commit-sha>
#
# Continuous-deployment entry point, run on the production server.
#
# Runs are serialized on this host by flock on backups/.cd-deploy.lock (a second
# run exits 1); a host without flock deploys anyway, with a warning.
#
# Phase 1, preflight guards: every refusal happens before anything is deployed,
# so a bad request leaves the server running exactly what it was running.
#
# Guards, in order (cheapest and most local first):
#   13  the working tree has modified TRACKED files (untracked files, such as
#       .env or backups/, are expected and ignored)
#   14  <commit-sha> is not an ancestor of origin/main (after fetch)
#   12  free disk is below CD_MIN_FREE_GB
#   10  a contest is running or finishing (a restart would interrupt judging
#       for people being graded); ALLOW_DURING_CONTEST=1 skips this guard
#   11  submissions are still Compiling/Running after CD_QUEUE_WAIT_SECONDS.
#       The backend turns each of those into a System Error on boot, so the
#       script waits for the queue to drain and aborts if it does not.
#
# Phase 2, deploy (after the guards pass):
#   record      .last-release (line 1 image tag, line 2 commit sha) is written
#               from LIVE state: the tag the backend container runs and the
#               checked-out HEAD. That is the rollback target, whether it was
#               deployed by this script or by hand (tag "local").
#   snapshot    before the deploy, the target's three images get a second tag,
#               :cd-rollback. deploy.sh may rebuild the target's own tag in
#               place (re-deploying the same commit); the snapshot is what
#               rollback restores from. A target that cannot be snapshotted
#               means THIS DEPLOY CANNOT BE ROLLED BACK; it is announced
#               loudly and the deploy goes on (fixing forward may be the only
#               way out). CD_DRY_RUN reports it without deploying.
#   backup      pg_dump -Fc into backups/pre-deploy-<sha>-<ts>.dump, verified
#               with pg_restore -l, pruned to the newest CD_BACKUP_KEEP
#   re-guard    guard 11 again: the dump can take minutes, so a submission that
#               started meanwhile would be killed by the restart. Still before
#               the checkout, so a refusal changes nothing.
#   check out   git checkout --detach <sha>
#   deploy      OJ_IMAGE_TAG=<short-sha> $CD_DEPLOY_CMD
#   verify      loopback /api/health/ready is ready, and the newest
#               schema_migrations row is not behind the migrations shipped in
#               the checkout
#   roll back   on any failure: previous images (from the snapshot) AND the
#               previous working tree, brought up without building, the proxy
#               recreated onto the restored configuration, then fully
#               re-verified (readiness and migrations), then pruned. The
#               database is never restored automatically.
#   prune       old oj-* image tags, by name, keeping this and the previous
#               release (and :local and :cd-rollback) -- or, after a rollback,
#               keeping the previous release only, so the failed release's
#               images do not pile up on the disk the disk guard protects
#
# Other exit codes: 0 ok, 1 usage error, another run holds the host lock, or the
# database could not be queried (fails closed), 20 backup failed, 21 deploy failed and was
# rolled back, 22 deploy failed and the rollback ALSO failed (or there was no
# rollback target): the site is down or on a broken release and a person must
# act; the message says what.
#
# Environment:
#   ALLOW_DURING_CONTEST=1     operator escape hatch for the contest guard
#   CD_MIN_FREE_GB             minimum free disk in GB (default 5)
#   CD_QUEUE_WAIT_SECONDS      judge-queue drain window (default 300)
#   CD_DRY_RUN=1               run the guards, record and snapshot the rollback
#                              target, report whether a rollback would be
#                              possible, then exit 0 without deploying
#   CD_REPO_DIR                checkout to operate on (default: this repo)
#   CD_DOCKER_ROOT_DIR         Docker data root to check for free disk (default:
#                              `docker info`; unresolvable -> exit 1)
#   CD_DB_CONTAINER           database container (default: compose service
#                              "database" of the checkout)
#   CD_DB_USER, CD_DB_NAME     psql credentials (default: $POSTGRES_USER /
#                              $POSTGRES_DB from the checkout's .env)
#   CD_BACKUP_KEEP             backups to retain, at least 1 (default 3)
#   CD_BACKUP_TIMEOUT_SECONDS  wall-clock cap on pg_dump, at least 1; a timeout
#                              is a backup failure, exit 20 (default 1800)
#   CD_DEPLOY_CMD              deploy command, run in the checkout with
#                              OJ_IMAGE_TAG set (default ./deploy.sh)
#   CD_COMPOSE_FILES           compose -f arguments used for rollback (default
#                              "-f docker-compose.yml -f docker-compose.production.yml",
#                              the same pair deploy.sh uses)
#   CD_IMAGE_PREFIX            image repository prefix (default oj, giving
#                              oj-backend, oj-frontend, oj-authoring-runner)
#   CD_HEALTH_URL              readiness URL (default: https loopback to the
#                              nginx proxy, /api/health/ready)
#   CD_HEALTH_WAIT_SECONDS     how long readiness may take (default 60)

set -eu

# A dropped SSH session sends SIGHUP to this script (with a pty) or closes its
# output pipe (without one: the next write raises SIGPIPE); ignore both so a
# disconnect can never interrupt the run between the deploy and its rollback.
# Children inherit the ignore. Set before anything mutates state.
trap '' HUP PIPE

# A pg_dump of this database holds every password hash and session, and the run
# log is an operational record: everything this script creates (the backup
# directory, the dumps, the run logs, .last-release, the lock file) is for this
# user only, whatever the server's umask is. Set before anything is created.
umask 077

EXIT_CONTEST=10
EXIT_QUEUE=11
EXIT_DISK=12
EXIT_DIRTY=13
EXIT_SHA=14
EXIT_BACKUP=20
EXIT_ROLLED_BACK=21
EXIT_ROLLBACK_FAILED=22

# Mirrors CONTEST_STATUS / SUBMISSION_STATUS in backend/constants/index.ts.
CONTEST_BLOCKING_STATUSES="'running','finishing'"
SUBMISSION_IN_FLIGHT_STATUSES="'Compiling','Running'"

QUEUE_POLL_SECONDS=2
HEALTH_POLL_SECONDS=2
# Second tag on the rollback target's images; see "snapshot" in the header.
SNAPSHOT_TAG=cd-rollback

# deploy.sh is bound to this host (certificate, tunnel); the loopback probe
# resolves it to 127.0.0.1 the same way deploy.sh does.
PUBLIC_HOST=nonbangkokgrader.com
IMAGE_SERVICES="backend frontend authoring-runner"
# Stock nginx with the release's config bind-mounted: its compose spec never
# changes, so `up -d` alone never moves it between releases (see restore_proxy).
PROXY_SERVICE=nginx-proxy

log() {
    # A dead console (EPIPE) must not abort the run under set -e -- and must not
    # corrupt the run either. The subshell is what makes the second part true: a
    # printf that fails on a closed pipe leaves the line sitting in this shell's
    # stdio buffer, and every command substitution forked afterwards inherits a
    # copy and flushes it into its OWN output. That turned `df -Pk | awk` into
    # two lines and failed the disk guard with "could not read free disk space"
    # (exit 1) on a console that had gone away. A subshell owns the buffer and
    # throws it away when it exits.
    (printf '%s cd-deploy: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*") || true
}

refuse() {
    code=$1
    shift
    log "refusing to deploy: $*"
    exit "$code"
}

die() {
    log "error: $*"
    exit 1
}

# Reads KEY from the checkout's .env without sourcing it.
env_file_value() {
    [ -f "$REPO_DIR/.env" ] || return 0
    sed -n "s/^$1=//p" "$REPO_DIR/.env" | tail -n 1
}

# Prints the database container, by NAME (an ID goes stale when a deploy
# recreates the service). CD_DB_CONTAINER overrides. Empty when not found.
find_db_container() {
    if [ -n "${CD_DB_CONTAINER:-}" ]; then
        printf '%s' "$CD_DB_CONTAINER"
        return 0
    fi
    name=$(cd "$REPO_DIR" && docker compose ps --format '{{.Name}}' database 2>/dev/null | head -n 1) || name=
    [ -n "$name" ] || name=$(cd "$REPO_DIR" && docker compose ps -q database 2>/dev/null | head -n 1) || name=
    printf '%s' "$name"
}

resolve_database() {
    DB_USER=${CD_DB_USER:-${POSTGRES_USER:-$(env_file_value POSTGRES_USER)}}
    DB_NAME=${CD_DB_NAME:-${POSTGRES_DB:-$(env_file_value POSTGRES_DB)}}
    DB_CONTAINER=$(find_db_container)
    [ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || die "database user/name unknown (set CD_DB_USER and CD_DB_NAME or POSTGRES_USER/POSTGRES_DB in .env)"
    [ -n "$DB_CONTAINER" ] || die "database container not found (is the compose stack up? or set CD_DB_CONTAINER)"
}

# db_scalar <sql>: prints the single value the query returns; dies on failure.
db_scalar() {
    out=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -tA -v ON_ERROR_STOP=1 -c "$1") ||
        die "database query failed in container $DB_CONTAINER: $1"
    printf '%s' "$out"
}

# Serializes runs on this host. The :cd-rollback snapshot and the checkout are
# global state, and GitHub's concurrency group does not cover a remote process
# that outlives a cancelled job, so an orphaned run can overlap an operator's.
# fd 9 stays open for the whole run; the kernel releases the lock when the
# process dies, however it dies. A host without flock still deploys: losing
# every deploy to a missing tool would be worse than the race it prevents.
acquire_lock() {
    if ! command -v flock >/dev/null 2>&1; then
        log "WARNING: flock is not installed; concurrent cd-deploy runs are not serialized"
        return 0
    fi
    [ -d "$BACKUP_DIR" ] || return 0
    LOCK_FILE=$BACKUP_DIR/.cd-deploy.lock
    exec 9>"$LOCK_FILE"
    flock -n 9 || die "another cd-deploy is running on this host (lock $LOCK_FILE)"
}

guard_clean_tree() {
    dirty=$(git -C "$REPO_DIR" status --porcelain --untracked-files=no) || die "git status failed in $REPO_DIR"
    if [ -n "$dirty" ]; then
        count=$(printf '%s\n' "$dirty" | wc -l | tr -d ' ')
        first=$(printf '%s\n' "$dirty" | head -n 1)
        refuse "$EXIT_DIRTY" "$count tracked file(s) modified in $REPO_DIR (first: $first)"
    fi
}

guard_sha_on_main() {
    git -C "$REPO_DIR" fetch --quiet origin main || die "git fetch origin main failed"
    if ! git -C "$REPO_DIR" merge-base --is-ancestor "$SHA^{commit}" origin/main 2>/dev/null; then
        refuse "$EXIT_SHA" "$SHA is not an ancestor of origin/main"
    fi
}

# require_uint <variable name> <value>: a bad value is an operator error, so it
# exits 1 instead of silently falling back to a default.
require_uint() {
    case $2 in '' | *[!0-9]*) die "$1 must be a non-negative integer, got '$2'" ;; esac
}

# note_free_gb <path>: folds the free space (whole GB) of the filesystem holding
# <path> into SHORT_GB / SHORT_PATH. No subshell, so die really exits.
note_free_gb() {
    kb=$(df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}') || kb=
    case $kb in '' | *[!0-9]*) die "could not read free disk space for $1" ;; esac
    gb=$((kb / 1024 / 1024))
    if [ -z "$SHORT_GB" ] || [ "$gb" -lt "$SHORT_GB" ]; then
        SHORT_GB=$gb
        SHORT_PATH=$1
    fi
}

guard_disk() {
    min_gb=${CD_MIN_FREE_GB-5}
    require_uint CD_MIN_FREE_GB "$min_gb"
    docker_root=${CD_DOCKER_ROOT_DIR-}
    if [ -z "$docker_root" ]; then
        docker_root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null) || docker_root=
    fi
    [ -n "$docker_root" ] || die "could not resolve Docker's data root (docker info); set CD_DOCKER_ROOT_DIR"
    SHORT_GB=
    SHORT_PATH=
    # Everything a deploy writes to: the checkout and Docker's data root (image
    # builds), and the backup directory when it is on another filesystem.
    note_free_gb "$REPO_DIR"
    note_free_gb "$docker_root"
    if [ -d "$BACKUP_DIR" ]; then note_free_gb "$BACKUP_DIR"; fi
    if [ "$SHORT_GB" -lt "$min_gb" ]; then
        refuse "$EXIT_DISK" "free disk is ${SHORT_GB} GB on $SHORT_PATH, below the required ${min_gb} GB (CD_MIN_FREE_GB)"
    fi
}

guard_contest() {
    if [ "${ALLOW_DURING_CONTEST:-}" = 1 ]; then
        log "contest guard skipped (ALLOW_DURING_CONTEST=1)"
        return 0
    fi
    count=$(db_scalar "SELECT count(*) FROM contests WHERE status IN ($CONTEST_BLOCKING_STATUSES)")
    if [ "$count" != 0 ]; then
        refuse "$EXIT_CONTEST" "$count contest(s) running or finishing; a restart would interrupt judging"
    fi
}

guard_judge_queue() {
    wait_s=${CD_QUEUE_WAIT_SECONDS-300}
    require_uint CD_QUEUE_WAIT_SECONDS "$wait_s"
    waited=0
    while :; do
        count=$(db_scalar "SELECT count(*) FROM submissions WHERE overall_status IN ($SUBMISSION_IN_FLIGHT_STATUSES)")
        # Contest submissions share the judge queue. The table is optional, and
        # Postgres resolves table names at parse time (a CASE would not help),
        # so check for it first and only then query it. Assigned first, never
        # inlined into the `if`: a command substitution in a condition
        # suppresses `set -e`, so a failed query would read as "no table" and
        # skip the count -- fail-open in a guard that must fail closed.
        has_contest_submissions=$(db_scalar "SELECT to_regclass('public.contest_submissions') IS NOT NULL")
        if [ "$has_contest_submissions" = t ]; then
            contest_count=$(db_scalar "SELECT count(*) FROM contest_submissions WHERE overall_status IN ($SUBMISSION_IN_FLIGHT_STATUSES)")
            count=$((count + contest_count))
        fi
        [ "$count" = 0 ] && return 0
        if [ "$waited" -ge "$wait_s" ]; then
            refuse "$EXIT_QUEUE" "$count submission(s) still compiling or running after waiting ${wait_s}s; a restart would turn them into System Errors"
        fi
        log "judge queue busy: $count submission(s) in flight, waited ${waited}s of ${wait_s}s"
        sleep "$QUEUE_POLL_SECONDS"
        waited=$((waited + QUEUE_POLL_SECONDS))
    done
}

preflight() {
    require_uint CD_BACKUP_KEEP "$BACKUP_KEEP"
    [ "$BACKUP_KEEP" -ge 1 ] || die "CD_BACKUP_KEEP must be at least 1, got '$BACKUP_KEEP'"
    require_uint CD_BACKUP_TIMEOUT_SECONDS "$BACKUP_TIMEOUT"
    [ "$BACKUP_TIMEOUT" -ge 1 ] || die "CD_BACKUP_TIMEOUT_SECONDS must be at least 1, got '$BACKUP_TIMEOUT'"
    guard_clean_tree
    guard_sha_on_main
    guard_disk
    resolve_database
    guard_contest
    guard_judge_queue
    log "preflight ok for $SHA"
}

# ---------------------------------------------------------------------------
# Phase 2: backup, deploy, verify, roll back
# ---------------------------------------------------------------------------

image_repo() {
    printf '%s-%s' "$IMAGE_PREFIX" "$1"
}

# compose <args>: docker compose in the checkout with the production files.
compose() {
    # docker compose reads OJ_IMAGE_TAG from the ENVIRONMENT. POSIX leaves it
    # unspecified whether an assignment prefix on a FUNCTION call ("OJ_IMAGE_TAG=x
    # compose up") gains the export attribute, so export it here, where no caller
    # can get it wrong: without the export, compose would silently fall back to
    # the ":local" default and a rollback would bring up the wrong images.
    if [ -n "${OJ_IMAGE_TAG:-}" ]; then
        export OJ_IMAGE_TAG
    fi
    # CD_COMPOSE_FILES is a list of arguments on purpose.
    # shellcheck disable=SC2086
    (cd "$REPO_DIR" && docker compose $COMPOSE_FILES "$@")
}

backup_database() {
    ts=$(date '+%Y%m%dT%H%M%S')
    BACKUP_FILE="$BACKUP_DIR/pre-deploy-$SHORT_SHA-$ts.dump"
    log "backing up $DB_NAME to $BACKUP_FILE"
    mkdir -p "$BACKUP_DIR" || refuse "$EXIT_BACKUP" "cannot create backup directory $BACKUP_DIR"
    if ! docker exec "$DB_CONTAINER" timeout "$BACKUP_TIMEOUT" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc >"$BACKUP_FILE"; then
        rm -f "$BACKUP_FILE"
        refuse "$EXIT_BACKUP" "pg_dump failed or exceeded ${BACKUP_TIMEOUT}s (CD_BACKUP_TIMEOUT_SECONDS)"
    fi
    if ! docker exec -i "$DB_CONTAINER" pg_restore -l <"$BACKUP_FILE" >/dev/null; then
        rm -f "$BACKUP_FILE"
        refuse "$EXIT_BACKUP" "the dump is not readable (pg_restore -l failed)"
    fi
    log "backup verified: $(wc -c <"$BACKUP_FILE" | tr -d ' ') bytes"
    prune_backups
}

# Keeps the newest CD_BACKUP_KEEP dumps. Ordered by the timestamp at the end of
# the name; the sha prefix would sort unrelated to age.
prune_backups() {
    for f in "$BACKUP_DIR"/pre-deploy-*.dump; do
        [ -e "$f" ] || continue
        printf '%s %s\n' "$(basename "$f" .dump | sed 's/.*-//')" "$f"
    done | sort -r | tail -n +"$((BACKUP_KEEP + 1))" | while read -r _ f; do
        rm -f "$f"
        log "pruned old backup $f"
    done
}

# The tag the backend container is running (empty when nothing runs).
running_tag() {
    cid=$(compose ps -q backend 2>/dev/null | head -n 1) || cid=
    [ -n "$cid" ] || return 0
    image=$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null) || return 0
    printf '%s' "${image##*:}"
}

# Records the running release in .last-release and sets PREV_TAG / PREV_SHA
# from live state: the backend container's image tag and the checked-out HEAD.
# Nothing running means no rollback target. A hand-built release has tag
# "local"; that works as a target because a CD deploy tags by sha and never
# rebuilds :local.
load_rollback_target() {
    PREV_TAG=$(running_tag)
    PREV_SHA=
    if [ -z "$PREV_TAG" ]; then
        log "WARNING: no rollback target (no running $(image_repo backend) container found); a failed deploy cannot be rolled back"
        return 0
    fi
    PREV_SHA=$(git -C "$REPO_DIR" rev-parse HEAD) || die "cannot read HEAD of $REPO_DIR"
    printf '%s\n%s\n' "$PREV_TAG" "$PREV_SHA" >"$LAST_RELEASE"
    log "rollback target: tag $PREV_TAG at $PREV_SHA (recorded in $LAST_RELEASE)"
}

# Gives the target's images a second tag so deploy.sh rebuilding the target's
# own tag in place (same commit deployed again) cannot destroy them. SNAPSHOT_OK
# is 1 only when all three were tagged by THIS run; a stale snapshot from an
# earlier deploy is removed first and never trusted.
snapshot_rollback_target() {
    SNAPSHOT_OK=0
    SNAPSHOT_MISSING=
    # shellcheck disable=SC2086 # IMAGE_SERVICES is a word list on purpose
    for svc in $IMAGE_SERVICES; do
        docker rmi "$(image_repo "$svc"):$SNAPSHOT_TAG" >/dev/null 2>&1 || true
    done
    [ -n "$PREV_TAG" ] || return 0
    # shellcheck disable=SC2086 # IMAGE_SERVICES is a word list on purpose
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker tag "$repo:$PREV_TAG" "$repo:$SNAPSHOT_TAG" >/dev/null 2>&1 ||
            SNAPSHOT_MISSING="$SNAPSHOT_MISSING $repo:$PREV_TAG"
    done
    if [ -z "$SNAPSHOT_MISSING" ]; then
        SNAPSHOT_OK=1
    else
        # Not a soft warning: without all three images there is nothing to go
        # back to, and the line above has just named a rollback target.
        log "WARNING: THIS DEPLOY CANNOT BE ROLLED BACK. The rollback target's image(s) do not exist:$SNAPSHOT_MISSING"
        log "WARNING: a failed deploy will end at exit 22 (no automatic rollback); you would have to fix forward or rebuild by hand."
        log "WARNING: to make the next deploy rollbackable, tag the running images as '$PREV_TAG' (see the CD runbook's prerequisites)."
    fi
}

probe_health() {
    curl -fsS --max-time 5 -o /dev/null --resolve "$PUBLIC_HOST:$HTTPS_PORT:127.0.0.1" "$HEALTH_URL" 2>/dev/null
}

wait_healthy() {
    waited=0
    until probe_health; do
        [ "$waited" -lt "$HEALTH_WAIT" ] || return 1
        sleep "$HEALTH_POLL_SECONDS"
        waited=$((waited + HEALTH_POLL_SECONDS))
    done
}

# Fails (prints why) unless the newest applied migration is at least the newest
# one shipped in the checkout. Ahead is fine: redeploying an older commit runs
# against a newer schema by design. Versions look like 0024_header_problems,
# files like 0024HeaderProblems.ts; the four-digit prefix is the comparable part.
# Prints the highest four-digit prefix among the checkout's migration files, or
# nothing when the directory is missing or holds none. Globbed, not `ls | sed`:
# parsing ls output is fragile and a shellcheck finding (SC2012). A function of
# its own because bash 3.2 cannot parse a `case` inside a `$(...)`.
newest_shipped_migration() {
    for f in "$REPO_DIR"/backend/migrations/*.ts; do
        base=${f##*/}
        case $base in
            [0-9][0-9][0-9][0-9]*) printf '%.4s\n' "$base" ;;
        esac
    done | sort | tail -n 1
}

check_migrations() {
    # The deploy may have recreated the database service.
    DB_CONTAINER=$(find_db_container)
    [ -n "$DB_CONTAINER" ] || { log "database container not found after the deploy"; return 1; }
    shipped=$(newest_shipped_migration)
    [ -n "$shipped" ] || { log "no migration files found in $REPO_DIR/backend/migrations"; return 1; }
    applied=$(db_scalar "SELECT coalesce(max(substr(version, 1, 4)), '') FROM schema_migrations") || return 1
    lowest=$(printf '%s\n%s\n' "$applied" "$shipped" | sort | head -n 1)
    if [ "$applied" != "$shipped" ] && [ "$lowest" = "$applied" ]; then
        log "newest applied migration is '${applied:-none}' but this release ships $shipped"
        return 1
    fi
}

# verify_release <check migrations: 1|0>
verify_release() {
    wait_healthy || { log "$HEALTH_URL did not become ready within ${HEALTH_WAIT}s"; return 1; }
    [ "$1" = 1 ] && { check_migrations || return 1; }
    return 0
}

# Prints what the operator must do and exits 22. The message is the mitigation.
rollback_failed() {
    reason=$1
    log "ROLLBACK FAILED: $reason"
    log "The deploy of $SHA failed AND the previous release could not be restored."
    log "State: the checkout is at $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown); the site may be down or on the failed release."
    log "The database was NOT restored. Pre-deploy backup: ${BACKUP_FILE:-none}"
    log "Full log of this run on the server: ${LOG_FILE:-none}"
    if [ -n "$PREV_TAG" ]; then
        log "Caveat: tag '$PREV_TAG' images are only known to match $PREV_SHA if nobody checked out a different commit after building them (true for ':local' built by hand)."
        log "To restore by hand: cd $REPO_DIR && git checkout --detach $PREV_SHA && OJ_IMAGE_TAG=$PREV_TAG docker compose $COMPOSE_FILES up -d --no-build"
        log "Then recreate the proxy onto that release's configuration ('up -d' alone leaves it serving the failed one):"
        log "  cd $REPO_DIR && docker compose $COMPOSE_FILES up -d --no-build --no-deps --force-recreate $PROXY_SERVICE"
    else
        log "There was no rollback target. Fix forward, or restore a known-good commit with ./deploy.sh."
    fi
    exit "$EXIT_ROLLBACK_FAILED"
}

# Brings the proxy onto the configuration of the tree that is checked out now.
# `up -d` cannot: the proxy's compose spec is identical between releases (stock
# nginx with ./nginx-proxy/*.conf bind-mounted), so compose does not recreate it
# and the running master keeps the FAILED release's configuration in memory.
#
# Recreated rather than reloaded, on purpose: that configuration is bind-mounted
# as a single FILE, and a checkout that changes it gives the path a new inode
# while the running container's mount still points at the one the checkout
# replaced. `nginx -t` inside that container was observed failing with ENOENT
# after a checkout, so NO reload can be relied on in exactly the case that
# matters (a configuration-caused failure). A new container reads the restored
# file by construction. The cost is a few seconds of proxy downtime during a
# rollback, when the site is already down or broken. --no-deps keeps it to the
# proxy: the application containers were just brought up with the previous images.
#
# A non-zero return fails the whole rollback loudly (exit 22) instead of
# reporting OK on a half state; a proxy that comes back with a broken
# configuration is caught right after, by the verification through it.
#
# Nothing running needs nothing: `up -d` has just created the container, and a
# fresh one reads the restored configuration itself. A checkout whose compose
# files define no proxy at all lands there too.
restore_proxy() {
    proxy_cid=$(compose ps -q "$PROXY_SERVICE" 2>/dev/null | head -n 1) || proxy_cid=
    if [ -z "$proxy_cid" ]; then
        log "no running $PROXY_SERVICE container: nothing to restore (a new one reads the restored configuration)"
        return 0
    fi
    compose up -d --no-build --no-deps --force-recreate "$PROXY_SERVICE" || return 1
    log "$PROXY_SERVICE recreated onto the restored configuration"
}

rollback() {
    [ -n "$PREV_TAG" ] || rollback_failed "no rollback target: no running release was found before the deploy"
    [ "$SNAPSHOT_OK" = 1 ] || rollback_failed "rollback target is missing, image(s) not found:$SNAPSHOT_MISSING"
    log "rolling back to tag $PREV_TAG ($PREV_SHA)"
    # Retag BEFORE the checkout. Either order leaves a mixture if it fails
    # half-way, but once this loop has succeeded ":$PREV_TAG" IS the snapshot,
    # so the by-hand command the exit-22 banner prints
    # (OJ_IMAGE_TAG=$PREV_TAG ... up -d --no-build) is always correct. The
    # other order can leave that command bringing up a mixture, silently.
    # shellcheck disable=SC2086 # IMAGE_SERVICES is a word list on purpose
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker tag "$repo:$SNAPSHOT_TAG" "$repo:$PREV_TAG" || rollback_failed "restoring $repo:$PREV_TAG from the snapshot failed"
    done
    git -C "$REPO_DIR" checkout --quiet --detach "$PREV_SHA" || rollback_failed "git checkout $PREV_SHA failed"
    # Exported explicitly: an assignment prefix on a function call need not
    # export (compose() exports it again for the same reason).
    OJ_IMAGE_TAG=$PREV_TAG
    export OJ_IMAGE_TAG
    compose up -d --no-build --remove-orphans || rollback_failed "docker compose up with tag $PREV_TAG failed"
    restore_proxy || rollback_failed "the previous release is up but $PROXY_SERVICE could not be restored, so it may still serve the failed release's configuration"
    # Full verification: with the old tree back, "migrations not behind" holds
    # by construction, and readiness alone once let a broken build pass.
    verify_release 1 || rollback_failed "the previous release did not verify (readiness or migrations)"
    # The failed release's images are dead weight on a disk the disk guard
    # protects; a few failed deploys would otherwise walk the host into exit 12.
    prune_images "$PREV_TAG"
    log "ROLLBACK OK: tag $PREV_TAG at $PREV_SHA is running again (the database was not restored)"
    log "Full log of this run on the server: ${LOG_FILE:-none}"
    exit "$EXIT_ROLLED_BACK"
}

# prune_images <tag to keep>...: deletes every other oj-* tag by name, plus
# always keeping :local (manual deploys) and :cd-rollback (the snapshot). On
# the success path the new and previous releases are kept; on the rollback path
# the new release's images are exactly what should go. Failures, such as an
# image still in use, are not fatal. Never a blanket prune: other containers
# share this daemon.
prune_images() {
    # Space-delimited so an empty PREV_TAG argument cannot match a real tag.
    keep=" $* local $SNAPSHOT_TAG "
    # shellcheck disable=SC2086 # IMAGE_SERVICES is a word list on purpose
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker image ls --format '{{.Tag}}' "$repo" | sort -u | while read -r tag; do
            case $tag in '<none>' | '') continue ;; esac
            case $keep in *" $tag "*) continue ;; esac
            if docker rmi "$repo:$tag" >/dev/null 2>&1; then log "pruned image $repo:$tag"; fi
        done
    done
    return 0
}

deploy() {
    backup_database
    # The dump can take minutes, and a submission that started during it would
    # be turned into a System Error by the restart: re-check the queue to close
    # that window. Still BEFORE the checkout, so a refusal here (exit 11) still
    # leaves the working tree exactly as it was.
    guard_judge_queue

    log "checking out $SHA"
    git -C "$REPO_DIR" checkout --quiet --detach "$SHA" || die "git checkout $SHA failed (nothing was deployed)"

    log "deploying with OJ_IMAGE_TAG=$NEW_TAG: $DEPLOY_CMD"
    if ! (cd "$REPO_DIR" && OJ_IMAGE_TAG=$NEW_TAG sh -c "$DEPLOY_CMD"); then
        log "deploy command failed"
        log "DEPLOY FAILED for $SHA"
        rollback
    fi
    if ! verify_release 1; then
        log "DEPLOY FAILED for $SHA (verification)"
        rollback
    fi

    printf '%s\n%s\n' "$NEW_TAG" "$SHA" >"$LAST_RELEASE"
    prune_images "$NEW_TAG" "$PREV_TAG"
    log "DEPLOY OK: $SHA is live as tag $NEW_TAG"
}

# The run log is the authoritative record, and the console is a best-effort
# copy of it: this script's own stdout/stderr (and its children's) go straight
# to backups/cd-deploy-<sha>-<ts>.log (next to the dumps, ignored by version
# control) through a plain file descriptor, never a pipe. A background
# forwarder copies the log to the original stdout (the SSH session). If that
# reader goes away the forwarder stops on its failed write and nothing else
# notices, so a dropped session can neither kill the script (SIGPIPE is ignored
# too) nor lose the verdict. The path is the first line of output. If the
# backup directory cannot be created the run goes on printing to stdout (the
# backup step then fails with its own message); a log that cannot be written is
# a hard error.
start_run_log() {
    LOG_FILE=
    mkdir -p "$BACKUP_DIR" 2>/dev/null || return 0
    # Markers of runs that died abruptly (SIGKILL, OOM) never got cleaned up.
    for marker in "$BACKUP_DIR"/.cd-deploy-*.done; do
        [ -e "$marker" ] || continue
        marker_pid=${marker##*-}
        marker_pid=${marker_pid%.done}
        kill -0 "$marker_pid" 2>/dev/null || rm -f "$marker"
    done
    stamp=$(date '+%Y%m%dT%H%M%S')
    name=$(printf '%.12s' "$SHA" | tr -c '0-9a-zA-Z' '_')
    LOG_FILE=$BACKUP_DIR/cd-deploy-$name-$stamp.log
    FWD_DONE=$BACKUP_DIR/.cd-deploy-$$.done
    # The one place a log failure (full disk, unwritable file) is loud.
    if ! printf '%s cd-deploy: log file: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$LOG_FILE" >"$LOG_FILE"; then
        bad_log=$LOG_FILE
        LOG_FILE=
        die "cannot write the run log $bad_log"
    fi
    rm -f "$FWD_DONE"
    # fd 3 is the original stdout and exists only inside the forwarder.
    forward_log "$$" 3>&1 >/dev/null 2>&1 &
    FWD_PID=$!
    trap finish_run_log EXIT
    exec >>"$LOG_FILE" 2>&1
}

# forward_log <script pid>: copies new bytes of the log to fd 3 until the script
# is done, the script is gone (killed abruptly: no orphan is left polling), or
# fd 3 dies.
forward_log() {
    parent=$1
    off=1
    while :; do
        final=0
        if [ -e "$FWD_DONE" ]; then final=1; fi
        if ! kill -0 "$parent" 2>/dev/null; then final=1; fi
        size=$(wc -c <"$LOG_FILE" | tr -d ' ')
        if [ "$size" -ge "$off" ]; then
            tail -c +"$off" "$LOG_FILE" | head -c "$((size - off + 1))" >&3 || break
            off=$((size + 1))
        fi
        if [ "$final" = 1 ]; then break; fi
        sleep 0.2 2>/dev/null || sleep 1
    done
    rm -f "$FWD_DONE"
}

# EXIT trap: every line is already in the log (it is written directly), so this
# only lets the forwarder deliver the tail to the console. The wait is bounded
# (about 10s) so a stalled reader cannot hold the exit; the forwarder is then
# killed. The script's exit status is untouched.
# shellcheck disable=SC2329 # invoked by `trap finish_run_log EXIT`, not by name
finish_run_log() {
    : >"$FWD_DONE" 2>/dev/null || true
    waited=0
    while kill -0 "$FWD_PID" 2>/dev/null && [ "$waited" -lt 100 ]; do
        sleep 0.1 2>/dev/null || sleep 1
        waited=$((waited + 1))
    done
    kill "$FWD_PID" 2>/dev/null || true
    wait "$FWD_PID" 2>/dev/null || true
    rm -f "$FWD_DONE"
}

main() {
    [ $# -eq 1 ] || die "usage: cd-deploy.sh <commit-sha>"
    SHA=$1
    REPO_DIR=${CD_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
    BACKUP_DIR=$REPO_DIR/backups
    # In the checkout root; git-ignored, so it never dirties the tree.
    LAST_RELEASE=$REPO_DIR/.last-release
    BACKUP_KEEP=${CD_BACKUP_KEEP-3}
    BACKUP_TIMEOUT=${CD_BACKUP_TIMEOUT_SECONDS-1800}
    DEPLOY_CMD=${CD_DEPLOY_CMD:-./deploy.sh}
    COMPOSE_FILES=${CD_COMPOSE_FILES:--f docker-compose.yml -f docker-compose.production.yml}
    IMAGE_PREFIX=${CD_IMAGE_PREFIX:-oj}
    HEALTH_WAIT=${CD_HEALTH_WAIT_SECONDS-60}
    require_uint CD_HEALTH_WAIT_SECONDS "$HEALTH_WAIT"
    HTTPS_PORT=${HTTPS_PORT:-$(env_file_value HTTPS_PORT)}
    HTTPS_PORT=${HTTPS_PORT:-443}
    HEALTH_URL=${CD_HEALTH_URL:-https://$PUBLIC_HOST:$HTTPS_PORT/api/health/ready}

    start_run_log
    acquire_lock

    preflight

    SHORT_SHA=$(git -C "$REPO_DIR" rev-parse --short=12 "$SHA^{commit}") || die "cannot resolve $SHA"
    NEW_TAG=$SHORT_SHA
    BACKUP_FILE=

    # Before the dry-run exit on purpose: whether a rollback is possible at all
    # is only knowable by recording the live release and trying to tag its
    # images, so a dry run that skipped this could not answer the one question
    # an operator asks before the first deploy.
    load_rollback_target
    snapshot_rollback_target

    if [ "${CD_DRY_RUN:-}" = 1 ]; then
        log "dry run: guards passed, not deploying"
        if [ "$SNAPSHOT_OK" = 1 ]; then
            log "dry run: a failed deploy COULD be rolled back, to tag $PREV_TAG at $PREV_SHA"
        elif [ -n "$PREV_TAG" ]; then
            log "dry run: a deploy right now COULD NOT BE ROLLED BACK, image(s) not found:$SNAPSHOT_MISSING"
        else
            log "dry run: a deploy right now COULD NOT BE ROLLED BACK, no running release was found"
        fi
        log "dry run: the only state created is the :$SNAPSHOT_TAG image tag(s) and $LAST_RELEASE; no container, image or checkout was changed"
        exit 0
    fi

    deploy
}

main "$@"
