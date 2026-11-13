#!/usr/bin/env bash
# Driver for the header-problem content harness.
#
# Everything (statement render, compile, run, PDF text extraction) happens
# inside the throwaway `oj-content-build` image so that the measured timings
# come from the judge's compiler, not the host's. The host only needs Docker.
#
#   ./run.sh build  [--all | <problem-id> ...]
#   ./run.sh verify [--all | <problem-id> ...] [--measure]
#   ./run.sh shell                      # interactive poke-around
#   ./run.sh -- <command> [args...]     # anything else, inside the image
#
# Env:
#   OJ_CONTENT_IMAGE    image name/tag (default: oj-content-build)
#   OJ_CONTENT_REBUILD  =1 to force `docker build` even if the image exists
#
# This never touches the user's running compose project.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${OJ_CONTENT_IMAGE:-oj-content-build}"

if [ "${OJ_CONTENT_REBUILD:-0}" = "1" ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> building $IMAGE" >&2
  docker build -t "$IMAGE" "$HERE" >&2
fi

if [ "$#" -eq 0 ]; then
  echo "usage: ./run.sh {build|verify|shell|-- <command>} [args...]" >&2
  exit 2
fi

sub="$1"; shift
case "$sub" in
  build)  cmd=(python3 build.py "$@") ;;
  verify) cmd=(python3 verify.py "$@") ;;
  shell)  cmd=(bash) ;;
  --)     cmd=("$@") ;;
  *)
    echo "unknown subcommand '$sub' (expected build|verify|shell|--)" >&2
    exit 2
    ;;
esac

# --user keeps dist/ owned by the invoking user on the host; HOME and
# XDG_CACHE_HOME must then point somewhere writable for Qt/fontconfig.
exec docker run --rm -i \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e XDG_CACHE_HOME=/tmp \
  -e XDG_RUNTIME_DIR=/tmp \
  -v "$HERE:/work" \
  -w /work \
  "$IMAGE" "${cmd[@]}"
