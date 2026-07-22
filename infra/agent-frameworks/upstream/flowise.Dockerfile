ARG UPSTREAM_IMAGE=mirror.gcr.io/library/node:24.18.0-bookworm-slim@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:b1386d556b478c420927eb212236bfb31be9834a4549850a060a6351f7fff514
ARG FLOWISE_PNPM_LOCK_SHA256=f37c5b91f15e8a162a6daa3ed214d37649c887c9dab74c2ba840ce2db60eaae8

FROM ${UPSTREAM_IMAGE} AS toolchain

ADD --checksum=sha256:f60974c68cfe0a13f951fba0199669588577f0e3f0c9b7d1a7ca47633bf72386 \
    https://registry.npmjs.org/pnpm/-/pnpm-10.26.0.tgz \
    /opt/aria/downloads/pnpm-10.26.0.tgz
ADD --checksum=sha256:11981517fdf01c2651eb2007854128f84ea6a57d43d32f2a0cc02e819c4d8132 \
    https://github.com/ewfian/faiss-node/releases/download/v0.5.1/faiss-node-v0.5.1-napi-v8-linux-x64.tar.gz \
    /opt/aria/prebuilds/faiss-node-v0.5.1-napi-v8-linux-x64.tar.gz
ADD --checksum=sha256:6d1f7a95e5aca90db1fd6a2839380a021d5ee23d46f2d7c520ded094da813fed \
    https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v6-linux-x64.tar.gz \
    /opt/aria/prebuilds/sqlite3-v5.1.7-napi-v6-linux-x64.tar.gz

RUN set -eu; \
    mkdir -p /opt/pnpm; \
    tar -xzf /opt/aria/downloads/pnpm-10.26.0.tgz -C /opt/pnpm; \
    test "$(node /opt/pnpm/package/bin/pnpm.cjs --version)" = "10.26.0"

FROM ${UPSTREAM_IMAGE} AS build

ARG FLOWISE_PNPM_LOCK_SHA256

ENV CI=true \
    NODE_OPTIONS=--max-old-space-size=8192 \
    PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /usr/src/flowise

COPY --from=toolchain /opt/pnpm /opt/pnpm
COPY --from=toolchain /opt/aria/prebuilds /opt/aria/prebuilds
RUN ln -s /opt/pnpm/package/bin/pnpm.cjs /usr/local/bin/pnpm \
    && test "$(pnpm --version)" = "10.26.0"

COPY --from=flowise_source . ./
COPY --chmod=0555 infra/agent-frameworks/upstream/patch-flowise-worker-readiness.mjs /opt/aria/patch-flowise-worker-readiness.mjs

RUN printf '%s  %s\n' \
      "${FLOWISE_PNPM_LOCK_SHA256}" \
      'pnpm-lock.yaml' \
    | sha256sum --check --strict -
RUN ["node", "/opt/aria/patch-flowise-worker-readiness.mjs", "/usr/src/flowise/packages/server/src/commands/worker.ts"]
RUN pnpm fetch --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store
RUN --network=none \
    pnpm install \
      --offline \
      --frozen-lockfile \
      --verify-store-integrity \
      --ignore-scripts \
      --package-import-method=copy \
      --store-dir=/pnpm/store
RUN --network=none \
    node -e \
      "const actual=require('./package.json').pnpm?.onlyBuiltDependencies; const expected=['faiss-node','sqlite3']; if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('unexpected lifecycle-script allowlist')"
RUN --network=none \
    cd node_modules/.pnpm/faiss-node@0.5.1/node_modules/faiss-node \
    && npm_config_faiss_node_local_prebuilds=/opt/aria/prebuilds \
       node ../prebuild-install/bin.js --runtime napi --verbose
RUN --network=none \
    cd node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3 \
    && npm_config_sqlite3_local_prebuilds=/opt/aria/prebuilds \
       node ../prebuild-install/bin.js --runtime napi --verbose
RUN --network=none node -e \
    "require('./node_modules/.pnpm/faiss-node@0.5.1/node_modules/faiss-node'); require('./node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3')"
RUN --network=none \
    pnpm exec turbo run build \
      --filter='!@flowiseai/agentflow' \
      --filter='!@flowiseai/observe' \
      --concurrency=1 \
      --output-logs=full
RUN set -eu; \
    install -d \
      /runtime/packages/server \
      /runtime/packages/components \
      /runtime/packages/ui; \
    cp -a package.json pnpm-lock.yaml pnpm-workspace.yaml /runtime/; \
    cp -a packages/server/package.json /runtime/packages/server/; \
    cp -a packages/components/package.json /runtime/packages/components/; \
    cp -a packages/ui/package.json /runtime/packages/ui/
RUN --network=none \
    cd /runtime \
    && pnpm install \
         --prod \
         --offline \
         --frozen-lockfile \
         --verify-store-integrity \
         --ignore-scripts \
         --package-import-method=copy \
         --store-dir=/pnpm/store
RUN set -eu; \
    test -e /runtime/packages/components/node_modules/ioredis; \
    test ! -e /runtime/packages/server/node_modules/ioredis; \
    ln -s ../../components/node_modules/ioredis /runtime/packages/server/node_modules/ioredis; \
    for dependency in lunary redis; \
    do \
      test -e "/runtime/packages/components/node_modules/${dependency}"; \
      test ! -e "/runtime/packages/server/node_modules/${dependency}"; \
      ln -s "../../components/node_modules/${dependency}" "/runtime/packages/server/node_modules/${dependency}"; \
    done; \
    mkdir -p /runtime/packages/server/node_modules/@langchain; \
    for dependency in core langgraph; \
    do \
      test -e "/runtime/packages/components/node_modules/@langchain/${dependency}"; \
      test ! -e "/runtime/packages/server/node_modules/@langchain/${dependency}"; \
      ln -s "../../../components/node_modules/@langchain/${dependency}" "/runtime/packages/server/node_modules/@langchain/${dependency}"; \
    done; \
    test -e /runtime/node_modules/.pnpm/keyv@5.3.2/node_modules/keyv; \
    test ! -e /runtime/packages/server/node_modules/keyv; \
    ln -s ../../../node_modules/.pnpm/keyv@5.3.2/node_modules/keyv /runtime/packages/server/node_modules/keyv; \
    test -e /runtime/packages/server/node_modules/turndown; \
    test ! -e /runtime/packages/components/node_modules/turndown; \
    ln -s ../../server/node_modules/turndown /runtime/packages/components/node_modules/turndown; \
    test -e /runtime/packages/server/node_modules/multer; \
    test ! -e /runtime/packages/components/node_modules/multer; \
    ln -s ../../server/node_modules/multer /runtime/packages/components/node_modules/multer; \
    for dependency in \
      multer-azure-blob-storage \
      multer-cloud-storage \
      multer-s3 \
      s3-streamlogger \
      winston-azure-blob \
      winston-daily-rotate-file; \
    do \
      test -e "/runtime/packages/server/node_modules/${dependency}"; \
      test ! -e "/runtime/packages/components/node_modules/${dependency}"; \
      ln -s "../../server/node_modules/${dependency}" "/runtime/packages/components/node_modules/${dependency}"; \
    done; \
    test -e /runtime/packages/server/node_modules/@google-cloud/logging-winston; \
    test ! -e /runtime/packages/components/node_modules/@google-cloud/logging-winston; \
    ln -s ../../../server/node_modules/@google-cloud/logging-winston /runtime/packages/components/node_modules/@google-cloud/logging-winston; \
    test -e /runtime/node_modules/.pnpm/@opentelemetry+instrumentation@0.54.2_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/instrumentation; \
    test ! -e /runtime/packages/components/node_modules/@opentelemetry/instrumentation; \
    ln -s ../../../../node_modules/.pnpm/@opentelemetry+instrumentation@0.54.2_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/instrumentation /runtime/packages/components/node_modules/@opentelemetry/instrumentation; \
    test -e /runtime/node_modules/.pnpm/@opentelemetry+sdk-trace-node@1.27.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-node; \
    test ! -e /runtime/packages/components/node_modules/@opentelemetry/sdk-trace-node; \
    ln -s ../../../../node_modules/.pnpm/@opentelemetry+sdk-trace-node@1.27.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-node /runtime/packages/components/node_modules/@opentelemetry/sdk-trace-node
RUN --network=none \
    cd /runtime/node_modules/.pnpm/faiss-node@0.5.1/node_modules/faiss-node \
    && npm_config_faiss_node_local_prebuilds=/opt/aria/prebuilds \
       node ../prebuild-install/bin.js --runtime napi --verbose
RUN --network=none \
    cd /runtime/node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3 \
    && npm_config_sqlite3_local_prebuilds=/opt/aria/prebuilds \
       node ../prebuild-install/bin.js --runtime napi --verbose
RUN --network=none node -e \
    "const fs=require('node:fs'); const {createRequire}=require('node:module'); const server=createRequire('/runtime/packages/server/package.json'); const components=createRequire('/runtime/packages/components/package.json'); for (const name of ['@langchain/core','@langchain/langgraph','@oclif/core','bullmq','ioredis','keyv','lunary','pg','redis','sqlite3','turndown','typeorm']) server(name); for (const name of ['@google-cloud/logging-winston','@opentelemetry/instrumentation','@opentelemetry/sdk-trace-node','multer','multer-azure-blob-storage','multer-cloud-storage','multer-s3','s3-streamlogger','turndown','winston-azure-blob','winston-daily-rotate-file']) components(name); require('/runtime/node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3'); require('/runtime/node_modules/.pnpm/faiss-node@0.5.1/node_modules/faiss-node'); const entries=fs.readdirSync('/runtime/node_modules/.pnpm'); if (entries.length < 100) throw new Error('production dependency tree is incomplete'); if (entries.some((name)=>name === 'turbo@1.10.16' || name.startsWith('turbo-linux-'))) throw new Error('development dependencies leaked into production')"
RUN set -eu; \
    cp -a \
      packages/server/bin \
      packages/server/dist \
      packages/server/marketplaces \
      /runtime/packages/server/; \
    cp -a \
      packages/components/dist \
      /runtime/packages/components/; \
    cp -a packages/ui/build /runtime/packages/ui/build; \
    find /runtime/node_modules -type f \( -name Dockerfile -o -name '*.Dockerfile' \) -delete; \
    test -f /runtime/packages/server/dist/commands/worker.js
RUN install -d -m 0555 /runtime-opt/aria /worker-opt/aria
COPY --chmod=0444 infra/agent-frameworks/upstream/flowise-entrypoint.cjs /runtime-opt/aria/flowise-entrypoint.cjs
COPY --chmod=0444 infra/agent-frameworks/fly/runtime/identity-probe.mjs /runtime-opt/aria/identity-probe.mjs
COPY --chmod=0444 infra/agent-frameworks/upstream/flowise-worker-healthcheck.mjs /worker-opt/aria/flowise-worker-healthcheck.mjs

FROM ${RUNTIME_IMAGE} AS runtime

ARG RELEASE_SOURCE_COMMIT
ARG UPSTREAM_SOURCE_COMMIT

LABEL org.opencontainers.image.revision="${RELEASE_SOURCE_COMMIT}" \
      io.mantu.aria.upstream-revision="${UPSTREAM_SOURCE_COMMIT}"

ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=8192 \
    PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PUPPETEER_SKIP_DOWNLOAD=true

USER 0:0
WORKDIR /app

COPY --from=build --chown=0:0 /runtime/ ./
COPY --from=build --chown=0:0 /runtime-opt/ /opt/
RUN ["/nodejs/bin/node", "-e", "const fs=require('node:fs'); const path=require('node:path'); for (const directory of ['/app','/opt','/opt/aria']) { fs.chownSync(directory,0,0); fs.chmodSync(directory,0o555); } for (const forbidden of ['/pnpm','/usr/src/flowise','/app/node_modules/.cache']) if (fs.existsSync(forbidden)) throw new Error('build-only content leaked into runtime'); function logicalBytes(target) { const stat=fs.lstatSync(target); if (stat.isSymbolicLink()) return 0; if (stat.isFile()) return stat.size; return stat.isDirectory() ? fs.readdirSync(target).reduce((total,name)=>total+logicalBytes(path.join(target,name)),0) : 0; } const bytes=logicalBytes('/app'); if (bytes > 2100000000) throw new Error('Flowise runtime exceeds the reviewed logical-size bound');"]

USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "/opt/aria/flowise-entrypoint.cjs"]

FROM runtime AS server

EXPOSE 3000
CMD ["start"]

FROM runtime AS worker

ENV WORKER_PORT=5566

COPY --from=build --chown=0:0 /worker-opt/ /opt/

EXPOSE 5566
CMD ["worker"]
