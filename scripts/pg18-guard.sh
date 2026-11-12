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
#   0  fresh install (no old 16 volume), or the 18 volume holds a completed cluster
#   1  the guard could not inspect the volumes (fails closed)
#   2  migration required: run scripts/pg18-migrate.sh (see the runbook)
#   3  the 18 volume holds a pre-18 data directory at its root
#
# The project name is resolved the way docker compose resolves it:
# `docker compose <args> config --format json` -> top-level "name".
# OJ_PG_GUARD_PROJECT overrides it (tests only). Volumes are only read, through
# a read-only mount; nothing is ever written or removed.
set -eu

RUNBOOK=docs/runbooks/postgres-18-upgrade.md
MARKER=.oj-pg18-migration-incomplete
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

volume_exists() {
    docker volume inspect "$1" >/dev/null 2>&1
}

# Prints the trimmed contents of <path> inside volume <vol>, or __MISSING__.
# Any Docker failure aborts the guard (fail closed) instead of reading as "missing".
volume_file() {
    out=$(docker run --rm --network none -v "$1:/v:ro" "$HELPER_IMAGE" \
        sh -c 'if [ -f "/v/$1" ]; then cat "/v/$1"; else echo __MISSING__; fi' sh "$2") ||
        die "could not read $2 from volume $1"
    printf '%s' "$out" | tr -d '[:space:]'
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
if volume_exists "$new_volume"; then
    new_root=$(volume_file "$new_volume" PG_VERSION)
    new_version=$(volume_file "$new_volume" 18/docker/PG_VERSION)
    new_marker=$(volume_file "$new_volume" "$MARKER")
fi

if [ "$new_root" != absent ] && [ "$new_root" != __MISSING__ ]; then
    printf '%s\n' \
        "Postgres 18 volume holds a Postgres $new_root data directory at its root: see $RUNBOOK" \
        "  new volume: $new_volume (expected the cluster at 18/docker/, found PG_VERSION=$new_root at /)" \
        "  old volume: $old_volume" \
        "Refusing to deploy. Do not delete either volume; follow the runbook."
    exit 3
fi

if [ "$old_version" = 16 ]; then
    if [ "$new_version" != 18 ] || [ "$new_marker" != __MISSING__ ]; then
        if [ "$new_version" = 18 ]; then
            state="has an 18 cluster from an interrupted migration ($MARKER present)"
        elif [ "$new_version" = absent ]; then
            state="does not exist"
        else
            state="has no initialised Postgres 18 cluster"
        fi
        printf '%s\n' \
            "Postgres 18 upgrade required: see $RUNBOOK" \
            "  old volume: $old_volume (Postgres 16 data, kept untouched)" \
            "  new volume: $new_volume ($state)" \
            "Refusing to deploy: the site would start on an empty or incomplete database."
        exit 2
    fi
    echo "pg18-guard: ok ($new_volume holds the migrated Postgres 18 cluster; $old_volume is kept)"
    exit 0
fi

if [ "$old_version" = absent ]; then
    echo "pg18-guard: ok (no Postgres 16 volume $old_volume; fresh install or already cleaned up)"
else
    echo "pg18-guard: ok ($old_volume has PG_VERSION=$old_version, not a Postgres 16 cluster)"
fi
