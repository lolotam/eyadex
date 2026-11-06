# Eyadex API (NestJS on Fastify) — production image. Build from the repository root:
#   docker build -f apps/api/Dockerfile .
# Same store-first layering as the root (web) Dockerfile: `pnpm fetch` reads pnpm-lock.yaml alone, so a new
# workspace package never needs another COPY line here. The runtime stage receives a `pnpm deploy` bundle:
# apps/api's production dependencies plus the built workspace packages it imports — no sources, no
# devDependencies, no other app.

# Native ABI matches the runtime base; versions and downloaded sources are pinned.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS pdf-tools
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64 || { echo "invoice_pdf_unsupported_architecture" >&2; exit 1; }
RUN apk add --no-cache g++ cmake ninja pkgconf openssl-dev zlib-dev jpeg-dev curl
WORKDIR /src
COPY apps/api/assets/invoice-pdf/build-native.sh apps/api/assets/invoice-pdf/qpdf-memory.cc apps/api/assets/invoice-pdf/pdf-limit-launcher.cc ./
RUN sh build-native.sh

# ---- build ----
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
# apps/api and every workspace package it depends on (they are consumed from dist/).
RUN pnpm --filter "@eyadex/api..." build
# A self-contained copy of apps/api with its production dependencies; workspace packages are copied in
# (injected), not symlinked to sources that the runtime stage does not have.
RUN pnpm --filter @eyadex/api deploy --prod --config.inject-workspace-packages=true /out

# ---- runtime ----
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
RUN apk add --no-cache libstdc++ libcrypto3 zlib libjpeg-turbo tini \
    && addgroup -S eyadex && adduser -S eyadex -G eyadex \
    && mkdir /pdf-root && chmod 555 /pdf-root
COPY --from=build --chown=eyadex:eyadex /out ./
COPY --from=pdf-tools /usr/local/bin/typst /usr/local/bin/qpdf /usr/local/bin/qpdf-memory /usr/local/bin/pdf-limit-launcher /usr/local/bin/
COPY --from=pdf-tools /usr/local/lib/libqpdf.so* /usr/local/lib/
COPY --from=pdf-tools /tmp/qpdf-12.3.2/LICENSE.txt /tmp/qpdf-12.3.2/NOTICE.md /usr/share/licenses/qpdf/
COPY --from=pdf-tools /tmp/typst-x86_64-unknown-linux-musl/LICENSE /tmp/typst-x86_64-unknown-linux-musl/NOTICE /usr/share/licenses/typst/
RUN cd /app/assets/fonts && sha256sum -c SHA256SUMS
USER eyadex
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/pdf-limit-launcher"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/v1/health >/dev/null || exit 1
# `eyadex-runtime`: @eyadex/contracts resolves to its built dist/ — Node does not strip types inside
# node_modules, so the .ts sources the web app and tests use would crash the API at startup.
CMD ["/usr/local/bin/node", "--conditions=eyadex-runtime", "dist/main.js"]
