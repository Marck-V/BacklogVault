# Stage 1: build the static bundle
# Base images are pinned by digest so a rebuild cannot silently change them; Dependabot proposes updates.
FROM node:24@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Empty values make the app call relative URLs (/api/..., /export/...), which nginx proxies to the other services.
ARG VITE_API_BASE=""
ARG VITE_EXPORT_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_EXPORT_BASE=$VITE_EXPORT_BASE
RUN npm run build

# Stage 2: serve the bundle with nginx; no Node in the final image
FROM nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
