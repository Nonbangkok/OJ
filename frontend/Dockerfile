# Stage 1: Build the React application
FROM node:26-alpine AS build

# Set the working directory
WORKDIR /app/frontend

# Copy package.json and package-lock.json
COPY frontend/package*.json ./
COPY frontend/.npmrc ./
COPY shared/statement-renderer /app/shared/statement-renderer

# Install dependencies
# Use `npm ci` for reproducible, lockfile-exact installs (requires package-lock.json).
RUN npm ci --no-audit --install-links

# Copy the rest of the application source code
COPY frontend/. ./

# Build the application for production
ARG REACT_APP_API_URL
ARG REACT_APP_LARGE_UPLOAD_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_LARGE_UPLOAD_API_URL=$REACT_APP_LARGE_UPLOAD_API_URL
# vite.config.mts maps these build args into the bundle; `npm run build` fails on inline scripts (CSP).
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:1.30-alpine

# Copy the build output from the build stage
COPY --from=build /app/frontend/build /usr/share/nginx/html

# Copy the custom Nginx configuration
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"] 
