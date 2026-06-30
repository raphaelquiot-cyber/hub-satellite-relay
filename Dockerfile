# ── Stage 1 : build ──────────────────────────────────────────────────────────
# Installe TOUTES les dépendances (y compris devDeps) et compile le TypeScript.
FROM node:20-alpine AS builder

WORKDIR /app

# Copier les manifestes en premier — invalide le cache uniquement si les dépendances changent
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2 : production ──────────────────────────────────────────────────────
# Image finale légère : dépendances prod uniquement + code compilé.
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Dépendances de production seulement (ws + rien d'autre)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code compilé depuis le stage build
COPY --from=builder /app/dist ./dist

EXPOSE 4000

# Health-check sur l'endpoint HTTP minimal du relais
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/ | grep -q '"status":"ok"' || exit 1

CMD ["node", "dist/server.js"]
