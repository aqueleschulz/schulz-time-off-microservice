# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install tools required for native dependencies (C++)
RUN apk add --no-cache python3 make g++

COPY package*.json ./

# Install all dependencies (including devDependencies for the build step)
RUN npm install

COPY . .
RUN npm run build

# Clean devDependencies and reinstall only production ones,
# while keeping the build tools available for native modules
RUN npm prune --production

# Stage 2: Runtime
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy only the necessary files from the builder stage
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/drizzle ./drizzle

# Idempotent setup: Ensure the data directory exists with correct permissions 
# BEFORE switching to the non-root user
RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app
USER node

EXPOSE 3000

# Specify the .js extension explicitly to prevent resolution ambiguities
CMD ["node", "dist/main.js"]