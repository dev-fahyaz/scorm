FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY rollup.config.js tsconfig.json tsconfig.types.json index.d.ts ./
RUN npm run build

COPY player/package.json player/package-lock.json ./player/
RUN npm ci --prefix player

COPY player ./player
RUN npm run build --prefix player

FROM node:22-slim
ENV NODE_ENV=production \
    PLAYER_PORT=4173
WORKDIR /app/player

COPY player/package.json player/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY player/server ./server
COPY player/sample ./sample
COPY --from=builder /app/player/dist ./dist

EXPOSE 4173
VOLUME /app/player/data
CMD ["npx", "tsx", "server/index.ts"]
