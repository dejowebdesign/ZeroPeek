# ZeroPeek backend image (multi-stage).
# Build context is the repository root so the workspace packages are available.

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

COPY packages/shared packages/shared
COPY packages/backend packages/backend

RUN npm run build -w @zeropeek/shared \
 && npx -w @zeropeek/backend prisma generate \
 && npm run build -w @zeropeek/backend

# ---- runtime stage ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/backend/package.json packages/backend/
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY --from=build /app/packages/backend/prisma packages/backend/prisma
COPY docker/backend-entrypoint.sh /app/docker/backend-entrypoint.sh
RUN chmod +x /app/docker/backend-entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker/backend-entrypoint.sh"]
