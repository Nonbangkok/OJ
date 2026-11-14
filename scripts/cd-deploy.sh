#!/bin/sh
# cd-deploy.sh <commit-sha>
#
# Continuous-deployment entry point, run on the production server.
#
# Phase 1, preflight guards: every refusal happens before anything is changed,
# so a bad request leaves the server exactly as it was.
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
#   backup      pg_dump -Fc into backups/pre-deploy-<sha>-<ts>.dump, verified
#               with pg_restore -l, pruned to the newest CD_BACKUP_KEEP
#   record      .last-release (line 1 image tag, line 2 commit sha) is written
#               from LIVE state: the tag the backend container runs and the
#               checked-out HEAD. That is the rollback target, whether it was
#               deployed by this script or by hand (tag "local").
#   snapshot    right before the deploy command, the target's three images get
#               a second tag, :cd-rollback. deploy.sh may rebuild the target's
#               own tag in place (re-deploying the same commit); the snapshot
#               is what rollback restores from.
#   check out   git checkout --detach <sha>
#   deploy      OJ_IMAGE_TAG=<short-sha> $CD_DEPLOY_CMD
#   verify      loopback /api/health/ready is ready, and the newest
#               schema_migrations row is not behind the migrations shipped in
#               the checkout
#   roll back   on any failure: previous working tree AND previous images
#               (from the snapshot), brought up without building, then fully
#               re-verified (readiness and migrations). The database is
#               never restored automatically.
#   prune       old oj-* image tags, by name, keeping this and the previous
#               release (and :local and :cd-rollback)
#
# Other exit codes: 0 ok, 1 usage error or the database could not be queried
# (fails closed), 20 backup failed (nothing changed), 21 deploy failed and was
# rolled back, 22 deploy failed and the rollback ALSO failed (or there was no
# rollback target): the site is down or on a broken release and a person must
# act; the message says what.
#
# Environment:
#   ALLOW_DURING_CONTEST=1     operator escape hatch for the contest guard
#   CD_MIN_FREE_GB             minimum free disk in GB (default 5)
#   CD_QUEUE_WAIT_SECONDS      judge-queue drain window (default 300)
#   CD_DRY_RUN=1               run the guards, then exit 0 without deploying
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

log() {
    # A dead console (EPIPE) must not abort the run under set -e.
    printf '%s cd-deploy: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" || true
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
        # so check for it first and only then query it.
        if [ "$(db_scalar "SELECT to_regclass('public.contest_submissions') IS NOT NULL")" = t ]; then
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
    for svc in $IMAGE_SERVICES; do
        docker rmi "$(image_repo "$svc"):$SNAPSHOT_TAG" >/dev/null 2>&1 || true
    done
    [ -n "$PREV_TAG" ] || return 0
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker tag "$repo:$PREV_TAG" "$repo:$SNAPSHOT_TAG" >/dev/null 2>&1 ||
            SNAPSHOT_MISSING="$SNAPSHOT_MISSING $repo:$PREV_TAG"
    done
    if [ -z "$SNAPSHOT_MISSING" ]; then
        SNAPSHOT_OK=1
    else
        log "WARNING: cannot snapshot the rollback target, image(s) not found:$SNAPSHOT_MISSING"
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
check_migrations() {
    # The deploy may have recreated the database service.
    DB_CONTAINER=$(find_db_container)
    [ -n "$DB_CONTAINER" ] || { log "database container not found after the deploy"; return 1; }
    shipped=$(ls "$REPO_DIR/backend/migrations" 2>/dev/null | sed -n 's/^\([0-9]\{4\}\).*\.ts$/\1/p' | sort | tail -n 1)
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
    else
        log "There was no rollback target. Fix forward, or restore a known-good commit with ./deploy.sh."
    fi
    exit "$EXIT_ROLLBACK_FAILED"
}

rollback() {
    [ -n "$PREV_TAG" ] || rollback_failed "no rollback target: no running release was found before the deploy"
    [ "$SNAPSHOT_OK" = 1 ] || rollback_failed "rollback target is missing, image(s) not found:$SNAPSHOT_MISSING"
    log "rolling back to tag $PREV_TAG ($PREV_SHA)"
    git -C "$REPO_DIR" checkout --quiet --detach "$PREV_SHA" || rollback_failed "git checkout $PREV_SHA failed"
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker tag "$repo:$SNAPSHOT_TAG" "$repo:$PREV_TAG" || rollback_failed "restoring $repo:$PREV_TAG from the snapshot failed"
    done
    OJ_IMAGE_TAG=$PREV_TAG compose up -d --no-build --remove-orphans || rollback_failed "docker compose up with tag $PREV_TAG failed"
    # Full verification: with the old tree back, "migrations not behind" holds
    # by construction, and readiness alone once let a broken build pass.
    verify_release 1 || rollback_failed "the previous release did not verify (readiness or migrations)"
    log "ROLLBACK OK: tag $PREV_TAG at $PREV_SHA is running again (the database was not restored)"
    log "Full log of this run on the server: ${LOG_FILE:-none}"
    exit "$EXIT_ROLLED_BACK"
}

# Deletes oj-* image tags older than the two releases kept (this and the
# previous one) by name, plus :local which manual deploys use. Failures, such as
# an image still in use, are not fatal. Never a blanket prune: other containers
# share this daemon.
prune_images() {
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker image ls --format '{{.Tag}}' "$repo" | sort -u | while read -r tag; do
            case $tag in "$NEW_TAG" | "$PREV_TAG" | local | "$SNAPSHOT_TAG" | '<none>') continue ;; esac
            if docker rmi "$repo:$tag" >/dev/null 2>&1; then log "pruned image $repo:$tag"; fi
        done
    done
    return 0
}

deploy() {
    SHORT_SHA=$(git -C "$REPO_DIR" rev-parse --short=12 "$SHA^{commit}") || die "cannot resolve $SHA"
    NEW_TAG=$SHORT_SHA
    BACKUP_FILE=
    backup_database
    load_rollback_target

    log "checking out $SHA"
    git -C "$REPO_DIR" checkout --quiet --detach "$SHA" || die "git checkout $SHA failed (nothing was deployed)"

    snapshot_rollback_target
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
    prune_images
    log "DEPLOY OK: $SHA is live as tag $NEW_TAG"
}

# The run log is the authoritative record, and the console is a best-effort
# copy of it: this script's own stdout/stderr (and its children's) go straight
# to backups/cd-deploy-<sha>-<ts>.log (next to the dumps, ignored by version
# control) through a plain file descriptor, never a pipe. A background
# forwarder copies the log to the original stdout (the SSH session). If that
# reader goes away the forwarder stops on its failed write and nothing else
# notices, so a dropped session can neither kill the script (SIGPIPE is ignored
# too) nor lose the verdict. The path is the first line of output. Best effort:
# if the log cannot be created the run goes on printing to stdout.
start_run_log() {
    LOG_FILE=
    mkdir -p "$BACKUP_DIR" 2>/dev/null || return 0
    stamp=$(date '+%Y%m%dT%H%M%S')
    name=$(printf '%.12s' "$SHA" | tr -c '0-9a-zA-Z' '_')
    LOG_FILE=$BACKUP_DIR/cd-deploy-$name-$stamp.log
    FWD_DONE=$BACKUP_DIR/.cd-deploy-$$.done
    if ! : >"$LOG_FILE" 2>/dev/null; then
        LOG_FILE=
        return 0
    fi
    rm -f "$FWD_DONE"
    # fd 3 is the original stdout and exists only inside the forwarder.
    forward_log 3>&1 >/dev/null 2>&1 &
    FWD_PID=$!
    trap finish_run_log EXIT
    exec >>"$LOG_FILE" 2>&1
    log "log file: $LOG_FILE"
}

# Copies new bytes of the log to fd 3 until the script is done (or fd 3 dies).
forward_log() {
    off=1
    while :; do
        final=0
        if [ -e "$FWD_DONE" ]; then final=1; fi
        size=$(wc -c <"$LOG_FILE" | tr -d ' ')
        if [ "$size" -ge "$off" ]; then
            tail -c +"$off" "$LOG_FILE" | head -c "$((size - off + 1))" >&3 || exit 0
            off=$((size + 1))
        fi
        if [ "$final" = 1 ]; then exit 0; fi
        sleep 0.2 2>/dev/null || sleep 1
    done
}

# EXIT trap: every line is already in the log (it is written directly), so this
# only lets the forwarder deliver the tail to the console and reaps it. The
# script's exit status is untouched.
finish_run_log() {
    : >"$FWD_DONE" 2>/dev/null || true
    wait "$FWD_PID" 2>/dev/null || true
    rm -f "$FWD_DONE"
}

main() {
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
        # so check for it first and only then query it.
        if [ "$(db_scalar "SELECT to_regclass('public.contest_submissions') IS NOT NULL")" = t ]; then
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
    for svc in $IMAGE_SERVICES; do
        docker rmi "$(image_repo "$svc"):$SNAPSHOT_TAG" >/dev/null 2>&1 || true
    done
    [ -n "$PREV_TAG" ] || return 0
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker tag "$repo:$PREV_TAG" "$repo:$SNAPSHOT_TAG" >/dev/null 2>&1 ||
            SNAPSHOT_MISSING="$SNAPSHOT_MISSING $repo:$PREV_TAG"
    done
    if [ -z "$SNAPSHOT_MISSING" ]; then
        SNAPSHOT_OK=1
    else
        log "WARNING: cannot snapshot the rollback target, image(s) not found:$SNAPSHOT_MISSING"
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
check_migrations() {
    # The deploy may have recreated the database service.
    DB_CONTAINER=$(find_db_container)
    [ -n "$DB_CONTAINER" ] || { log "database container not found after the deploy"; return 1; }
    shipped=$(ls "$REPO_DIR/backend/migrations" 2>/dev/null | sed -n 's/^\([0-9]\{4\}\).*\.ts$/\1/p' | sort | tail -n 1)
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
    else
        log "There was no rollback target. Fix forward, or restore a known-good commit with ./deploy.sh."
    fi
    exit "$EXIT_ROLLBACK_FAILED"
}

rollback() {
    [ -n "$PREV_TAG" ] || rollback_failed "no rollback target: no running release was found before the deploy"
    [ "$SNAPSHOT_OK" = 1 ] || rollback_failed "rollback target is missing, image(s) not found:$SNAPSHOT_MISSING"
    log "rolling back to tag $PREV_TAG ($PREV_SHA)"
    git -C "$REPO_DIR" checkout --quiet --detach "$PREV_SHA" || rollback_failed "git checkout $PREV_SHA failed"
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker tag "$repo:$SNAPSHOT_TAG" "$repo:$PREV_TAG" || rollback_failed "restoring $repo:$PREV_TAG from the snapshot failed"
    done
    OJ_IMAGE_TAG=$PREV_TAG compose up -d --no-build --remove-orphans || rollback_failed "docker compose up with tag $PREV_TAG failed"
    # Full verification: with the old tree back, "migrations not behind" holds
    # by construction, and readiness alone once let a broken build pass.
    verify_release 1 || rollback_failed "the previous release did not verify (readiness or migrations)"
    log "ROLLBACK OK: tag $PREV_TAG at $PREV_SHA is running again (the database was not restored)"
    log "Full log of this run on the server: ${LOG_FILE:-none}"
    exit "$EXIT_ROLLED_BACK"
}

# Deletes oj-* image tags older than the two releases kept (this and the
# previous one) by name, plus :local which manual deploys use. Failures, such as
# an image still in use, are not fatal. Never a blanket prune: other containers
# share this daemon.
prune_images() {
    for svc in $IMAGE_SERVICES; do
        repo=$(image_repo "$svc")
        docker image ls --format '{{.Tag}}' "$repo" | sort -u | while read -r tag; do
            case $tag in "$NEW_TAG" | "$PREV_TAG" | local | "$SNAPSHOT_TAG" | '<none>') continue ;; esac
            if docker rmi "$repo:$tag" >/dev/null 2>&1; then log "pruned image $repo:$tag"; fi
        done
    done
    return 0
}

deploy() {
    SHORT_SHA=$(git -C "$REPO_DIR" rev-parse --short=12 "$SHA^{commit}") || die "cannot resolve $SHA"
    NEW_TAG=$SHORT_SHA
    BACKUP_FILE=
    backup_database
    load_rollback_target

    log "checking out $SHA"
    git -C "$REPO_DIR" checkout --quiet --detach "$SHA" || die "git checkout $SHA failed (nothing was deployed)"

    snapshot_rollback_target
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
    prune_images
    log "DEPLOY OK: $SHA is live as tag $NEW_TAG"
}

# Copies everything this run prints to backups/cd-deploy-<sha>-<ts>.log (next
# to the dumps, git-ignored), so the outcome can be read on the server when the
# SSH session dies and the exit code is lost. The path is the first line of
# output. Best effort: if the log cannot be created the run goes on without it.
start_run_log() {
    LOG_FILE=
    mkdir -p "$BACKUP_DIR" 2>/dev/null || return 0
    stamp=$(date '+%Y%m%dT%H%M%S')
    name=$(printf '%.12s' "$SHA" | tr -c '0-9a-zA-Z' '_')
    LOG_FILE=$BACKUP_DIR/cd-deploy-$name-$stamp.log
    fifo=$BACKUP_DIR/.cd-deploy-$$.fifo
    if mkfifo "$fifo" 2>/dev/null && : >"$LOG_FILE" 2>/dev/null; then
        tee -a "$LOG_FILE" <"$fifo" &
        exec >"$fifo" 2>&1
        rm -f "$fifo"
        log "log file: $LOG_FILE"
    else
        rm -f "$fifo"
        LOG_FILE=
    fi
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

    preflight

    if [ "${CD_DRY_RUN:-}" = 1 ]; then
        log "dry run: guards passed, not deploying"
        exit 0
    fi

    deploy
}

main "$@"
