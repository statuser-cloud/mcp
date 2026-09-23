# Hosted Streamable HTTP endpoint. The npm package (stdio) does not use this.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# @sentry/node is only a devDependency and an optional peer in the published
# package, so `npx` users never download it — and so `--omit=dev` would drop it
# here too. For the image, promote it to a regular dependency at the version
# the lockfile already pins, so the runtime install stays a reproducible
# `npm ci`.
RUN SENTRY_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/@sentry/node'].version")" \
  && npm pkg delete "devDependencies.@sentry/node" \
  && npm pkg set "dependencies.@sentry/node=${SENTRY_VERSION}" \
  && npm install --package-lock-only --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# The server handles SIGTERM itself and starts no child processes, so node
# can be PID 1 without an init.
USER node
CMD ["node", "dist/http/index.js"]
