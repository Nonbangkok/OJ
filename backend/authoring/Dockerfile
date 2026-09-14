FROM node:20-slim AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends g++ util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY --from=build /build/node_modules/zod ./node_modules/zod
COPY --from=build /build/dist/authoring ./authoring
COPY --from=build /build/dist/utils/compileGuard.js ./utils/compileGuard.js
# The supervisor owns the spool; only the compiler drops to uid/gid 65534.
# No database client, server app, credentials, or Docker socket enter this image.
CMD ["sh", "-c", "mkdir -p /jobs && chmod 700 /jobs && exec flock -n -F /jobs/runner.lock node authoring/runner.js"]
