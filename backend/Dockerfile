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
RUN npm install

# Copy the rest of your app's source code from the 'backend' directory
COPY . .

# Render will automatically set the PORT environment variable, so we just need to expose it.
EXPOSE 3000

# The command to run your app
CMD [ "node", "server.js" ] 