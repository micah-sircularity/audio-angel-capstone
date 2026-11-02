FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 STATIC_DIR=/app/web
COPY --from=build /app/apps/server/dist ./server
COPY --from=build /app/apps/app/dist ./web
EXPOSE 3101
CMD ["node", "server/index.js"]
