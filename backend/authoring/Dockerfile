FROM node:20-slim AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci --no-audit
COPY . .
RUN npm run build

# Match the approved PDF demo's Qt/FreeType environment, while retaining Node 20.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends g++ util-linux \
    wkhtmltopdf=0.12.6-2build2 fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /runner
COPY --from=build /build/node_modules/zod ./node_modules/zod
COPY --from=build /build/node_modules/htmlparser2 ./node_modules/htmlparser2
COPY --from=build /build/node_modules/domhandler ./node_modules/domhandler
COPY --from=build /build/node_modules/domutils ./node_modules/domutils
COPY --from=build /build/node_modules/dom-serializer ./node_modules/dom-serializer
COPY --from=build /build/node_modules/domelementtype ./node_modules/domelementtype
COPY --from=build /build/node_modules/entities ./node_modules/entities
COPY --from=build /build/dist/authoring ./authoring
COPY --from=build /build/dist/constants ./constants
COPY --from=build /build/authoring/templates ./authoring/templates
COPY --from=build /build/authoring/templates/red-gate-v1/fonts /usr/share/fonts/truetype/authoring
RUN chmod -R a+rX /runner/authoring/templates /usr/share/fonts/truetype/authoring && fc-cache -f
COPY --from=build /build/dist/utils/compileGuard.js ./utils/compileGuard.js
COPY --from=build /build/dist/utils/outputComparison.js ./utils/outputComparison.js
COPY --from=build /build/authoring/sandbox.c ./sandbox.c
RUN gcc -Wall -Wextra -Werror sandbox.c -o /usr/local/bin/oj-authoring-sandbox && rm sandbox.c
# The supervisor owns the spool; only the compiler drops to uid/gid 65534.
# No database client, server app, credentials, or Docker socket enter this image.
CMD ["sh", "-c", "mkdir -p /jobs && chmod 700 /jobs && exec flock -n -F /jobs/runner.lock node authoring/runner.js"]
