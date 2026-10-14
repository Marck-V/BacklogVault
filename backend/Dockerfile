# Stage 1: full Debian image with the toolchain needed to compile native modules (better-sqlite3)
FROM node:24@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: slim runtime image. Same Debian/glibc base, so the compiled binary is compatible.
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/backlog.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
# Pre-create the data dir owned by the unprivileged user so a fresh named volume inherits that ownership.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
