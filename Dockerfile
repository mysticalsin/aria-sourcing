# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS development
ENV NODE_ENV=development
COPY --chown=node:node . .
RUN mkdir -p /app/config /app/.next && chown node:node /app/config /app/.next
USER node
EXPOSE 3000
CMD ["node", "scripts/container-runtime.mjs", "--development"]

FROM dependencies AS builder
ARG NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG ARIA_RELEASE_SHA
ENV NODE_ENV=production \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY . .
RUN ARIA_RELEASE_SHA="$ARIA_RELEASE_SHA" node scripts/build-container-metadata.mjs \
    && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/build-metadata.json ./build-metadata.json
COPY --chown=node:node scripts/container-runtime.mjs ./scripts/container-runtime.mjs
RUN mkdir -p /app/config && chown node:node /app/config
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "scripts/container-runtime.mjs"]
