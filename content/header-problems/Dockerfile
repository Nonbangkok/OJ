# Throwaway build image for the header-problem content harness.
#
# It does three jobs that must all happen in ONE place, because they have to
# agree with each other and with the production judge:
#
#   1. render statement.md -> statement.pdf (wkhtmltopdf + Thai fonts)
#   2. verify the rendered PDF still contains its Thai text (pdftotext)
#   3. compile and RUN grader + solution / slow with the judge's exact flags
#
# Base + pins follow the house pattern of `backend/authoring/Dockerfile`:
# ubuntu:24.04 is the only distribution that still ships wkhtmltopdf as a
# package (Debian removed it; the production judge image is Debian trixie), so
# the renderer pin `wkhtmltopdf=0.12.6-2build2` is copied verbatim from the
# authoring runner that already renders this project's statements.
#
# The judge toolchain, however, must match `backend/Dockerfile`
# (node:26-trixie-slim -> g++ 14.2.0). ubuntu:24.04 defaults to g++ 13, so we
# install g++-14 explicitly, make it the default `g++`, and ASSERT the major
# version at image build time — if that assert ever fails, the harness is no
# longer compiling the way the judge compiles and the build stops here instead
# of silently calibrating time limits against the wrong compiler.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
# wkhtmltopdf is a Qt application; `offscreen` is what the authoring runner
# uses to render without an X server (backend/authoring/process.ts).
ENV QT_QPA_PLATFORM=offscreen
ENV LANG=C.UTF-8

# Pinned exactly: the renderer and both font packages, because the rendered
# PDF must not change under us (all three live in noble/main or
# noble/universe, which are frozen for the release's lifetime).
# Left unpinned: python3, poppler-utils, coreutils, util-linux — they come
# from noble-updates, which rolls, and none of them affects the output bytes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++-14 \
        python3 \
        wkhtmltopdf=0.12.6-2build2 \
        fonts-thai-tlwg=1:0.7.3-1 \
        fonts-dejavu-core=2.37-8 \
        fontconfig \
        poppler-utils \
        coreutils \
        util-linux \
    && update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-14 100 \
    && update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 100 \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Same g++ major version as the judge image (backend/Dockerfile -> Debian
# trixie -> g++ 14). A mismatch invalidates every measured time limit.
RUN test "$(g++ -dumpversion | cut -d. -f1)" = "14" \
    && test -x /usr/bin/wkhtmltopdf \
    && test -x /usr/bin/pdftotext

# Marker the harness scripts look for, so `build.py` / `verify.py` refuse to
# run on a host toolchain by accident.
RUN echo "oj-content-build" > /etc/oj-content-build

WORKDIR /work
