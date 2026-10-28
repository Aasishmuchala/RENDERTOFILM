FROM 642011519820.dkr.ecr.us-east-1.amazonaws.com/bay/base:runway-api-base-latest AS deps
# The base image (runway-api-base.Dockerfile, RUNWAY_API_BASE_IMAGE) already
# has pnpm@10.33.4 activated and a warm store at /opt/bay-store — no
# `--mount=type=cache` here, which would shadow that store at the pnpm
# default path instead of using it. The hardened base defaults to user 1000;
# install/build need root. Runtime drops to 1000.
USER 0
WORKDIR /app

# .npmrc carries the @runway Artifactory registry line (from templates/base) but
# no credential — it is committed, and pnpm refuses to expand `${VAR}` for
# credential keys in a project file for exactly that reason. Auth comes from the
# secret mount below, at the user level. pnpm-workspace.yaml must be present at
# install time so its esbuild build-script allowlist applies during this layer,
# not only after `COPY . .`.
#
# The mounted file exists only for this RUN and never becomes a layer, unlike a
# build ARG. `required=true` fails the build up front rather than installing
# unauthenticated and 401ing halfway through. By hand outside Bay, with
# BAY_NPMRC set to a resolved credential:
#   docker build --secret id=artifactory_npmrc,env=BAY_NPMRC .
#   See `bay docs custom-dockerfiles` for the export line.
#   This needs Docker with Dockerfile frontend 1.19 or newer (for `--exclude`).
#
# The scaffolded template ships no lockfile — one can't be committed for an SDK
# version that publishes after the release commit, and a committed pair is what
# used to force a separate post-publish re-pin chore. `pnpm-lock.yaml*` matches
# nothing on the first build and the app's own lockfile on every build after
# the developer commits one; `--frozen-lockfile` then applies, so their builds
# are reproducible from that point on. `bay deploy` checks the lockfile against
# package.json before the build either way.
COPY package.json pnpm-lock.yaml* .npmrc pnpm-workspace.yaml ./
RUN --mount=type=secret,id=artifactory_npmrc,target=/root/.npmrc,required=true \
    if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --prefer-offline; \
    else \
      pnpm install --prefer-offline; \
    fi

FROM deps AS build
COPY . .
RUN pnpm run build

# Final stage: the image Bay ships. It stays on runway-api-base so pnpm and
# the warm store are there for release commands. Bay's build workers diff
# every exported layer by walking its whole file tree, so the build stage's
# layers (each over the store and node_modules) made the export slow.
# `--link` makes each copy its own layer with no lower tree to walk, and only
# this stage is exported. node_modules comes from the deps stage, so a
# source-only deploy leaves that layer byte-identical and the registry and
# nodes reuse it. Everything else comes from the build stage's /app, so every
# file `pnpm run build` writes outside node_modules (dist/, codegen under src/
# or anywhere else) ships. `--exclude` is stable Dockerfile syntax (1.19+) and
# is in the frontend bundled with Bay's BuildKit, so no `# syntax=` line.
# Because node_modules ships from the deps stage, a step that writes into it
# (`prisma generate`, a postinstall patch) must run in the deps stage, after
# the install, not in the build stage, or its output is dropped.
# A RUN below the copies brings the full walk back for its layer: put installs
# (apt packages and the like) above the first COPY --link line. USER 0 keeps `bay add` placing its
# apt layer there; WORKDIR stays above the copies so it reuses the deps stage's
# layer instead of walking node_modules.
FROM 642011519820.dkr.ecr.us-east-1.amazonaws.com/bay/base:runway-api-base-latest
USER 0
WORKDIR /app
COPY --link --from=deps /app/node_modules /app/node_modules
COPY --link --from=build --exclude=node_modules /app /app

# Trust the AWS RDS CA so a database client (if one is added later) can
# verify Aurora's TLS chain. Bay injects aws-rds-ca.pem into the build
# context at deploy time; the build-stage copy above lands it in /app.
ENV NODE_EXTRA_CA_CERTS=/app/aws-rds-ca.pem
EXPOSE 3000
USER 1000
ENV NODE_ENV=production
# `pnpm run build` bundles the server (src/index.ts and everything it imports,
# with node_modules left external) into .build/index.mjs, so the container
# starts node directly: no npm/npx in front of it and no TypeScript compile at
# startup, which is most of a cold start. node is then PID 1, so src/index.ts
# handles SIGTERM itself. The source map keeps stack traces on src/*.ts lines.
CMD ["node", "--enable-source-maps", ".build/index.mjs"]
