# Stage 1: full Debian image with the toolchain needed to compile native modules (better-sqlite3)
FROM node:24 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: slim runtime image. Same Debian/glibc base, so the compiled binary is compatible.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/backlog.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Pre-create the data dir owned by the unprivileged user so a fresh named volume inherits that ownership.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
