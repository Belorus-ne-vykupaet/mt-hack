FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_DATA_SOURCE=mock
ARG VITE_OFFICIAL_MODE=false
ARG VITE_API_URL=/api/v1
ARG VITE_WS_URL
ARG VITE_MAP_DARK_STYLE_URL=https://tiles.openfreemap.org/styles/dark
ARG VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/positron
ENV VITE_DATA_SOURCE=$VITE_DATA_SOURCE VITE_OFFICIAL_MODE=$VITE_OFFICIAL_MODE VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL VITE_MAP_DARK_STYLE_URL=$VITE_MAP_DARK_STYLE_URL
RUN pnpm build
FROM nginx:1.28-alpine
COPY --from=build /app/dist /usr/share/nginx/html
ARG NGINX_CONF=nginx.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
EXPOSE 80
