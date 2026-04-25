# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

LABEL maintainer="Senior Software Engineer"
ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package*.json ./

RUN npm install --omit=dev

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app
USER node

EXPOSE 3000

CMD ["node", "dist/main"]