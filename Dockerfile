# syntax=docker/dockerfile:1

FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json ./
RUN bun install
COPY tsconfig.json ./
COPY web ./web
RUN bun run build:web

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN bun install --production
COPY tsconfig.json ./
COPY src ./src
COPY --from=build /app/web/dist ./web/dist

ENV PORT=8080 \
    DB_PATH=/app/data/app.db \
    WEB_DIST=/app/web/dist

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/webhook').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "src/index.ts"]
