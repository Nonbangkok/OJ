# Use an official Node.js runtime as a parent image. We'll use a recent Long-Term Support (LTS) version.
FROM node:26-trixie-slim

# The judge toolchain comes from Debian trixie (g++ 14, Python 3.13).
# Install g++, build tools, the 'time' utility, and Python 3 (stdlib only —
# `python` submissions run via `python3`, resolved from /usr/bin inside
# JUDGE_CONFIG.SANDBOX_PATH; no pip packages are installed).
# Add PostgreSQL 18 repository and install postgresql-client-18
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt/ $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list' \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg \
    && apt-get update \
    && apt-get install -y build-essential time python3 postgresql-client-18 \
    && test "$(command -v python3)" = "/usr/bin/python3"

# Java submissions: OpenJDK 25 (LTS) from Debian trixie, headless JDK
# (javac + java). Its own layer, so the layers above stay cached. The judge
# runs /usr/bin/java by absolute path (time_wrapper execv()s with no PATH
# lookup), so both commands must resolve into the JDK 25 install.
# The man directory works around openjdk's postinst on slim images.
RUN mkdir -p /usr/share/man/man1 \
    && apt-get update \
    && apt-get install -y --no-install-recommends openjdk-25-jdk-headless \
    && rm -rf /var/lib/apt/lists/* \
    && readlink -f /usr/bin/java | grep -q '/java-25-openjdk-' \
    && readlink -f /usr/bin/javac | grep -q '/java-25-openjdk-' \
    && java -version

# sharp's SVG fallback avatars need actual glyphs in the deployed runtime.
# DejaVu covers Latin; Garuda supplies Thai initials instead of missing-glyph boxes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core fonts-tlwg-garuda

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker's layer caching
COPY backend/package*.json ./
COPY backend/.npmrc ./
COPY shared/statement-renderer /usr/src/shared/statement-renderer

# Install app dependencies
# Use `npm ci` for reproducible, lockfile-exact installs (requires package-lock.json).
RUN npm ci --no-audit --install-links

# Copy the rest of your app's source code from the 'backend' directory
COPY backend/. .

# Judged programs run as sandbox uids and may write only inside their own
# workspace (TMPDIR points there): no world write on /tmp, /var/tmp or
# /run/lock, so they can neither fill the disk outside it nor claim a path
# the backend (root, the owner) creates later. Workspaces live in the
# root-owned 1733 submissions root, created here so nobody can claim it.
RUN chmod 1755 /tmp /var/tmp /run/lock \
    && install -d -o root -g root -m 1733 /tmp/oj-submissions

# The trusted Java launcher (scripts/java/OjJavaLauncher.java): root-owned
# and read-only, first on every Java run's classpath.
RUN install -d -o root -g root -m 0755 /opt/oj/java-launcher \
    && javac -proc:none -encoding UTF-8 -d /opt/oj/java-launcher scripts/java/OjJavaLauncher.java \
    && chmod 0644 /opt/oj/java-launcher/*.class \
    && test -f /opt/oj/java-launcher/OjJavaLauncher.class

# Compile the high-precision time wrapper
RUN gcc scripts/time_wrapper.c -o scripts/time_wrapper
RUN gcc -Wall -Wextra -Werror authoring/sandbox.c -o /usr/local/bin/oj-authoring-sandbox

# Render will automatically set the PORT environment variable, so we just need to expose it.
EXPOSE 3000

# Build the app typescript
RUN npm run build

# --- A2 sandbox note: container runtime user ---
# We intentionally KEEP the container running as root for now. Two reasons:
#   1. The judge writes/chmods compiled binaries under WORKDIR/dist/services/
#      submissions at runtime, and the in-process sandbox wrapper
#      (scripts/time_wrapper) drops privileges from root -> nobody (uid 65534)
#      via setgid()/setuid() PER SUBMISSION. That per-process drop only works if
#      the parent (this container) starts as root; running the whole container
#      as `node` would make the wrapper's privilege drop a no-op (an
#      unprivileged user cannot setuid without CAP_SETUID, and docker-compose
#      retains SETUID/SETGID only so the wrapper can perform this drop).
#   2. The g++ compile step and submissions dir need write access to paths that
#      are root-owned in this image.
#
# Defence-in-depth is instead applied at three layers that DON'T require running
# the whole node process as non-root:
#   - per-submission privilege drop to nobody (scripts/time_wrapper.c)
#   - setrlimit() caps on the untrusted child (scripts/time_wrapper.c)
#   - container-level cap_drop: ALL followed by only SETUID/SETGID being added
#     back, plus no-new-privileges and pids/memory limits (docker-compose.yml)
#
# TODO (A2 hardening, follow-up): move judging into a dedicated, network-isolated
# `judge` container that runs as a non-root user, owns its own submissions dir,
# and holds no DB secrets (see SANDBOX.md). Once judging is isolated there, the
# main backend container can adopt `USER node` safely.

# The command to run your app
# CMD [ "node", "server.js" ]
CMD [ "npm", "start" ]
