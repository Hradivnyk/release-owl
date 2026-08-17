# Stage 1: builder — compile TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY .husky/install.mjs ./.husky/install.mjs
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/platform/package.json ./packages/platform/
COPY services/notification/package.json ./services/notification/
RUN npm ci

COPY packages ./packages
COPY services/notification ./services/notification

RUN npm run build:packages && npx tsc -p services/notification/tsconfig.json

# Stage 2: production — minimal runtime image
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY .husky/install.mjs ./.husky/install.mjs
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/platform/package.json ./packages/platform/
COPY services/notification/package.json ./services/notification/
RUN npm ci --omit=dev

COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/platform/dist ./packages/platform/dist
COPY --from=builder /app/services/notification/dist ./services/notification/dist

ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser

CMD ["node", "services/notification/dist/index.js"]
