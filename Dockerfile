# syntax=docker/dockerfile:1
#
# Dev-oriented image for Aria Sourcing. Runs `next dev` INSIDE the container so the
# `.next` build dir lives on the container filesystem (a volume in compose), not on
# the OneDrive-synced host checkout — which corrupts `.next` mid-write. Source is
# bind-mounted at runtime (see docker-compose.yml) for hot reload.
FROM node:20-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=development

# Install dependencies first for layer caching. `npm ci` needs the lockfile.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the source as a fallback for `docker run` without a bind mount; in compose
# the bind mount + anonymous volumes (node_modules, .next) shadow this at runtime.
COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
