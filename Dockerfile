# Stage 1: builder — compile TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY services/notification/package.json ./services/notification/
COPY .husky/install.mjs ./.husky/install.mjs
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/platform/package.json ./packages/platform/
RUN npm ci

COPY tsconfig.json ./
COPY knexfile.ts ./
COPY packages ./packages
COPY src ./src

RUN npm run build

# Stage 2: production — minimal runtime image
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY services/notification/package.json ./services/notification/
COPY .husky/install.mjs ./.husky/install.mjs
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/platform/package.json ./packages/platform/
RUN npm ci --omit=dev

COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/platform/dist ./packages/platform/dist
COPY --from=builder /app/dist ./dist
COPY swagger.yaml ./
COPY knexfile.ts ./
COPY public ./public
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production

USER node

EXPOSE 3000

ENTRYPOINT ["sh", "docker-entrypoint.sh"]
