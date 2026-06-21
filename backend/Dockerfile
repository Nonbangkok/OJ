# Use an official Node.js runtime as a parent image. We'll use a recent Long-Term Support (LTS) version.
FROM node:20-slim

# Install g++, build tools, and the 'time' utility
# Add PostgreSQL 16 repository and install postgresql-client-16
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt/ bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list' \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg \
    && apt-get update \
    && apt-get install -y build-essential time postgresql-client-16

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker's layer caching
COPY package*.json ./

# Install app dependencies
# Use `npm ci` for reproducible, lockfile-exact installs (requires package-lock.json).
RUN npm ci

# Copy the rest of your app's source code from the 'backend' directory
COPY . .

# Compile the high-precision time wrapper
RUN gcc scripts/time_wrapper.c -o scripts/time_wrapper

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
#      drops ALL capabilities for this service).
#   2. The g++ compile step and submissions dir need write access to paths that
#      are root-owned in this image.
#
# Defence-in-depth is instead applied at three layers that DON'T require running
# the whole node process as non-root:
#   - per-submission privilege drop to nobody (scripts/time_wrapper.c)
#   - setrlimit() caps on the untrusted child (scripts/time_wrapper.c)
#   - container-level cap_drop: ALL + no-new-privileges + pids/mem limits
#     (docker-compose.yml)
#
# TODO (A2 hardening, follow-up): move judging into a dedicated, network-isolated
# `judge` container that runs as a non-root user, owns its own submissions dir,
# and holds no DB secrets (see SANDBOX.md). Once judging is isolated there, the
# main backend container can adopt `USER node` safely.

# The command to run your app
# CMD [ "node", "server.js" ]
CMD [ "npm", "start" ]