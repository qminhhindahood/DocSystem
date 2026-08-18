# ---- deps ----
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder ----
# BACKEND_API_URL is consumed at RUNTIME by the server-side proxy route
# (frontend/app/api/proxy/[...path]/route.ts), so it is NOT baked into the
# build. It is provided as an env var at container start. No NEXT_PUBLIC_*
# vars exist in this codebase, so no build-time secrets are required.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner ----
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runner
WORKDIR /app
ENV NODE_ENV=production
# Allow runtime injection of the backend URL (server-side proxy only).
ENV BACKEND_API_URL=http://backend:3001
RUN addgroup -S nodejs \
    && adduser -S nextjs -G nodejs \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
