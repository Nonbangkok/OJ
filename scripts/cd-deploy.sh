#!/bin/sh
# cd-deploy.sh <commit-sha>
#
# Continuous-deployment entry point, run on the production server. This part
# holds the preflight guards: every refusal happens before anything is
# changed, so a bad request leaves the server exactly as it was.
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
# Other exit codes: 0 ok, 1 usage error or the database could not be queried
# (fails closed).
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

set -eu

EXIT_CONTEST=10
EXIT_QUEUE=11
EXIT_DISK=12
EXIT_DIRTY=13
EXIT_SHA=14

# Mirrors CONTEST_STATUS / SUBMISSION_STATUS in backend/constants/index.ts.
CONTEST_BLOCKING_STATUSES="'running','finishing'"
SUBMISSION_IN_FLIGHT_STATUSES="'Compiling','Running'"

QUEUE_POLL_SECONDS=2

log() {
    printf '%s cd-deploy: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*"
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

resolve_database() {
    DB_USER=${CD_DB_USER:-${POSTGRES_USER:-$(env_file_value POSTGRES_USER)}}
    DB_NAME=${CD_DB_NAME:-${POSTGRES_DB:-$(env_file_value POSTGRES_DB)}}
    DB_CONTAINER=${CD_DB_CONTAINER:-$(cd "$REPO_DIR" && docker compose ps -q database 2>/dev/null | head -n 1)}
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
    # builds). Task 3 adds the backup directory with one more call here.
    note_free_gb "$REPO_DIR"
    note_free_gb "$docker_root"
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
    guard_clean_tree
    guard_sha_on_main
    guard_disk
    resolve_database
    guard_contest
    guard_judge_queue
    log "preflight ok for $SHA"
}

main() {
    [ $# -eq 1 ] || die "usage: cd-deploy.sh <commit-sha>"
    SHA=$1
    REPO_DIR=${CD_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}

    preflight

    if [ "${CD_DRY_RUN:-}" = 1 ]; then
        log "dry run: guards passed, not deploying"
        exit 0
    fi
}

main "$@"
