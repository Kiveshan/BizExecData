# syntax=docker/dockerfile:1.7
#
# Built once in CI and promoted unchanged from staging to production.
# Everything that used to happen on the Elastic Beanstalk instance at deploy
# time (npm install, native bcrypt build, prisma generate) happens here.

ARG NODE_VERSION=24

# ─── build ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

# Toolchain is only used if no prebuilt bcrypt binary matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src/config/databaseUrl.js ./src/config/databaseUrl.js
RUN npx prisma generate

COPY server.js ./
COPY scripts ./scripts
COPY src ./src
COPY views ./views
COPY public ./public

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

# Prisma detects the OpenSSL version at runtime; the slim image ships without it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    DB_SSL_CA_PATH=/app/certs/rds-global-bundle.pem

# AWS's published CA bundle, so the app verifies the RDS TLS certificate.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem

COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 3000

# The same image runs migrations as a one-off ECS task:
#   command override: ["npx", "prisma", "migrate", "deploy"]
CMD ["node", "server.js"]
