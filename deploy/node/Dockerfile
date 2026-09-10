# Example image for the Node.js deployment. Multi-stage so the runtime layer
# carries no toolchain: pnpm, turbo and the TypeScript compiler exist only in the
# build stage.
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /repo
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/deploy/node
EXPOSE 8788
CMD ["node", "src/main.ts"]
