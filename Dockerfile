# syntax=docker/dockerfile:1

FROM oven/bun:1-slim AS build
WORKDIR /app

# Dependencies and the model change rarely but are expensive: install and
# download before any source is copied so edits never invalidate them.
# Cache mounts keep Bun's package cache and the model files warm across
# builds, so even a lockfile or script change does not re-fetch everything.
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/bun-cache,sharing=locked \
    BUN_INSTALL_CACHE_DIR=/bun-cache bun install --frozen-lockfile

# Bundle the local decision model (Laya multilingual, fp16 ONNX) in the image.
COPY scripts/laya-pull.ts ./scripts/laya-pull.ts
RUN --mount=type=cache,target=/laya-cache,sharing=locked \
    LAYA_MODEL_DIR=/laya-cache bun run laya:pull \
    && mkdir -p /app/models \
    && cp -a /laya-cache /app/models/laya

COPY tsconfig.json ./
# The web build imports shared code from src/ (e.g. the markdown renderer).
COPY src ./src
COPY web ./web
RUN bun run build:web

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/bun-cache,sharing=locked \
    BUN_INSTALL_CACHE_DIR=/bun-cache bun install --frozen-lockfile --production

# Heaviest, most stable layers first; src changes most often, so it goes last
# and only rebuilds the final (cheap) layer.
COPY tsconfig.json ./
COPY --from=build /app/models ./models
COPY --from=build /app/web/dist ./web/dist
COPY src ./src

ENV PORT=8080 \
    DB_PATH=/app/data/app.db \
    WEB_DIST=/app/web/dist \
    LAYA_MODEL_DIR=/app/models/laya

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/webhook').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "src/index.ts"]
