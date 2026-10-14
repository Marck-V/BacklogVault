# Stage 1: build the static bundle
# Base images are pinned by digest so a rebuild cannot silently change them; Dependabot proposes updates.
FROM node:24@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Empty values make the app call relative URLs (/api/...), which Caddy proxies to the API.
ARG VITE_API_BASE=""
# Named on the privacy page: Steam's terms require saying which country Steam data is stored in, and how to reach us
ARG VITE_DATA_COUNTRY=""
ARG VITE_CONTACT_EMAIL=""
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_DATA_COUNTRY=$VITE_DATA_COUNTRY \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL
RUN npm run build

# Stage 2: serve the bundle with Caddy (v2.11.7); no Node in the final image. Caddy also handles HTTPS on the server.
FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80 443
