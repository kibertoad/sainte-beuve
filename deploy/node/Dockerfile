# Example image for the Node.js deployment. Multi-stage so the runtime layer
# carries no toolchain: pnpm, turbo and the TypeScript compiler exist only in the
# build stage. The repo-root .dockerignore keeps the host's node_modules and .git
# out of the context, so the install runs against this image's platform.
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Prune the toolchain before the runtime stage copies the tree: the service is
# started with `node` directly, so turbo, typescript, oxlint, wrangler and vitest
# have nothing left to do here. Switching a tree to prod-only makes pnpm rewrite
# node_modules, which it will not do unprompted without a TTY.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --config.confirmModulesPurge=false

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/deploy/node
USER node
EXPOSE 8788
# Node 24 runs the TypeScript entry directly through type stripping, and
# --env-file-if-exists matches what the package's own `start` script loads.
CMD ["node", "--env-file-if-exists=.env", "src/main.ts"]
