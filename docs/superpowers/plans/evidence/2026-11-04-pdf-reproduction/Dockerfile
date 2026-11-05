FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
RUN apk add --no-cache g++ cmake ninja pkgconf openssl-dev zlib-dev jpeg-dev freetype-dev fontconfig-dev libpng-dev curl
WORKDIR /probe
ARG PROBE=docs/superpowers/plans/evidence/2026-11-04-pdf-reproduction
COPY ${PROBE}/build-tools.sh ./
RUN sh build-tools.sh
COPY ${PROBE}/package.json ${PROBE}/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN mkdir /fonts && \
    curl -fsSL https://raw.githubusercontent.com/google/fonts/fffdadf0f0c9cc1ec8b407063424a8bfbee05611/ofl/amiri/Amiri-Regular.ttf -o /fonts/Amiri-Regular.ttf && \
    curl -fsSL https://raw.githubusercontent.com/google/fonts/fffdadf0f0c9cc1ec8b407063424a8bfbee05611/ofl/amiri/Amiri-Bold.ttf -o /fonts/Amiri-Bold.ttf && \
    curl -fsSL https://raw.githubusercontent.com/google/fonts/fffdadf0f0c9cc1ec8b407063424a8bfbee05611/ofl/amiri/OFL.txt -o /fonts/OFL.txt && \
    echo 'ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7  /fonts/Amiri-Regular.ttf' | sha256sum -c - && \
    echo 'cfccb794268e7d573d857e6d6a67f89cf8a053e8ffd85dfa0c8ec1bb36fc4827  /fonts/Amiri-Bold.ttf' | sha256sum -c -
RUN curl -fsSL https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-unknown-linux-musl.tar.xz -o /tmp/typst.tar.xz && \
    echo 'a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c  /tmp/typst.tar.xz' | sha256sum -c - && \
    tar -xJf /tmp/typst.tar.xz -C /opt
COPY ${PROBE}/qpdf-memory.cc ./
RUN g++ -O2 -std=c++17 qpdf-memory.cc -lqpdf -o /usr/local/bin/qpdf-memory
COPY ${PROBE}/*.mjs ./
COPY docs/superpowers/plans/evidence/2026-11-04-pdf-corpus.json ./corpus.json
COPY docs/superpowers/plans/evidence/2026-11-05-invoice-template/*.mjs ./invoice/
CMD ["sh", "-c", "node run.mjs && node run-marked.mjs && node invoice/run.mjs"]
