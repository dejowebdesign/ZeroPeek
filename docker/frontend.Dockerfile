# ZeroPeek frontend image (multi-stage): build the Vite bundle, serve it with Caddy.

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

COPY packages/shared packages/shared
COPY packages/frontend packages/frontend

RUN npm run build -w @zeropeek/shared \
 && npm run build -w @zeropeek/frontend

# ---- runtime stage ----
FROM caddy:2-alpine AS runtime
COPY --from=build /app/packages/frontend/dist /srv
COPY docker/Caddyfile.frontend /etc/caddy/Caddyfile
EXPOSE 80
