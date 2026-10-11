# Stage 1: build the static bundle
FROM node:24 AS build
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
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
