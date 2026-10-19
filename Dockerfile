# One image for the whole site: the Node API, which also serves the built React app.
# Base images are pinned by digest so a rebuild cannot silently change them; Dependabot proposes updates.

# Stage 1: build the React app into static files.
FROM node:24@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0 AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Shown on the privacy page: Steam's terms require saying which country Steam data is stored in, and how to reach us.
# Hosts such as Railway pass service variables of the same name in as build arguments.
ARG DATA_COUNTRY=""
ARG CONTACT_EMAIL=""
# An empty API base makes the app call relative URLs (/api/...), which this same server answers.
ENV VITE_API_BASE="" \
    VITE_DATA_COUNTRY=$DATA_COUNTRY \
    VITE_CONTACT_EMAIL=$CONTACT_EMAIL
RUN npm run build

# Stage 2: install the API's production dependencies. The full Debian image has the compiler better-sqlite3 needs.
FROM node:24@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0 AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# Stage 3: the slim runtime image. Same Debian/glibc base, so the compiled module works. No compilers, no frontend
# toolchain: just Node, the API and the built site.
FROM node:24-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/backlog.db \
    STATIC_DIR=/app/public
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY --from=web /web/dist ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
# The container starts as root only long enough for docker-entrypoint.sh to hand /data to the "node" user (some hosts
# mount volumes owned by root); the app itself always runs as "node".
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
# Node runs the TypeScript source directly (it strips the types), so there is no build step for the API.
CMD ["node", "src/server.ts"]
