#!/bin/sh
# refresh-proxy.sh [compose args...]
#
# Makes the running nginx-proxy serve the proxy configuration that is on disk
# now. deploy.sh calls it after `docker compose up`, which leaves the proxy
# container alone because its compose spec does not change between releases.
#
# Why not just `nginx -s reload`: the configuration is bind-mounted as a single
# FILE, and `git checkout` replaces a changed file with a new inode. A running
# container stays attached to the old inode, so on Linux a reload silently
# re-reads the STALE configuration and the deploy reports success while the
# proxy keeps serving the previous release's rules.
#
# So: if what the container sees differs from the file on disk, recreate the
# proxy (a new container mounts the current file); otherwise keep the graceful
# reload, which drops no connections and also picks up renewed certificates
# (/etc/letsencrypt is a directory mount, which does see new files).
#
# Exit codes: 0 the proxy serves the on-disk configuration; 1 the proxy is not
# running, the mounted file cannot be found, or nginx rejects the configuration.
set -eu

SERVICE=nginx-proxy
TARGET=/etc/nginx/conf.d/default.conf

die() {
    echo "refresh-proxy: $*" >&2
    exit 1
}

# The host file compose mounts at $TARGET, resolved the way compose resolves it
# (absolute, after interpolation), so this works for any compose file set.
source=$(docker compose "$@" config --format json | python3 -c '
import json, sys
service = json.load(sys.stdin)["services"].get(sys.argv[1]) or {}
for volume in service.get("volumes") or []:
    if isinstance(volume, dict) and volume.get("target") == sys.argv[2]:
        print(volume.get("source") or "")
        break
' "$SERVICE" "$TARGET") || die "could not read the compose configuration"
[ -n "$source" ] || die "$SERVICE has no bind mount at $TARGET"
[ -f "$source" ] || die "the mounted configuration $source does not exist"

cid=$(docker compose "$@" ps -q "$SERVICE")
[ -n "$cid" ] || die "$SERVICE is not running"

# A failed `cat` (the old file is gone) feeds cmp nothing, so it reads as a
# difference and takes the recreate path, which is the right answer.
if docker exec "$cid" cat "$TARGET" 2>/dev/null | cmp -s - "$source"; then
    docker exec "$cid" nginx -t
    docker exec "$cid" nginx -s reload
    echo "refresh-proxy: $SERVICE configuration unchanged, reloaded"
else
    echo "refresh-proxy: $SERVICE configuration changed on disk; recreating the container (a reload would keep the stale file)"
    docker compose "$@" up -d --no-deps --force-recreate "$SERVICE"
    cid=$(docker compose "$@" ps -q "$SERVICE")
    [ -n "$cid" ] || die "$SERVICE did not come back after the recreate"
    docker exec "$cid" nginx -t
fi
