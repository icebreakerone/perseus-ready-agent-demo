# syntax=docker/dockerfile:1
# Next.js app, run as a standalone server.
FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.23.1-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --chmod=755 docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
# Sessions and the permission log. EFS is mounted here on AWS.
RUN mkdir -p .data && chown node:node .data
USER node
EXPOSE 3000
ENTRYPOINT ["web-entrypoint.sh"]
CMD ["node", "server.js"]
