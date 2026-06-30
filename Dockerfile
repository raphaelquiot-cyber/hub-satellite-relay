# ── Stage 1 : build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2 : production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
# Valeur par défaut — écrasée par EasyPanel via "App Port" ou variable d'env runtime
ENV PORT=4000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 4000

# Le HEALTHCHECK utilise $PORT (expansion shell) pour suivre la valeur runtime,
# qu'elle vienne de ce défaut ou d'EasyPanel.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4000}/ | grep -q '"status":"ok"' || exit 1

CMD ["node", "dist/server.js"]
