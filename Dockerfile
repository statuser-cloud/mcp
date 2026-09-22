# Hosted Streamable HTTP endpoint. The npm package (stdio) does not use this.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# The server handles SIGTERM itself and starts no child processes, so node
# can be PID 1 without an init.
USER node
CMD ["node", "dist/http/index.js"]
