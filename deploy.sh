#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

docker compose config --quiet
docker compose build
docker compose up -d --remove-orphans

deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
    unhealthy=$(docker compose ps --format json | python3 -c '
import json, sys
rows = [json.loads(line) for line in sys.stdin if line.strip()]
bad = [row["Name"] for row in rows if row.get("State") != "running" or row.get("Health") not in ("", "healthy")]
print(" ".join(bad))
')
    if [[ -z "$unhealthy" ]]; then
        curl -fsS -H 'Host: nonbangkokgrader.com' http://127.0.0.1/ >/dev/null
        echo "OJ deployment healthy"
        exit 0
    fi
    sleep 5
done

echo "OJ deployment did not become healthy before timeout" >&2
docker compose ps
exit 1
