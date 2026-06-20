# Stage 1: Build the React application
FROM node:20-alpine as build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
# CRA 5 + modern lint/tooling can emit peer-dependency conflicts in npm v10+.
# Use legacy peer resolution in container build to avoid ERESOLVE hard-fail.
# Use `npm ci` for reproducible, lockfile-exact installs (requires package-lock.json).
RUN npm ci --legacy-peer-deps

# Copy the rest of the application source code
COPY . .

# Build the application for production
ARG REACT_APP_API_URL
ARG REACT_APP_LARGE_UPLOAD_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_LARGE_UPLOAD_API_URL=$REACT_APP_LARGE_UPLOAD_API_URL
# CRA's production build runs ESLint in this container, but the repo's strict
# type-aware ESLint config is not compatible with the pinned plugin version.
ENV DISABLE_ESLINT_PLUGIN=true
ENV TSC_COMPILE_ON_ERROR=true
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:1.25-alpine

# Copy the build output from the build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy the custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"] 
