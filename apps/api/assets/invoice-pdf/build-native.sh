#!/bin/sh
set -eu

# Only the checksum-approved x86-64 Typst artifact is supported by this image.
if [ "${TARGETARCH:-}" != amd64 ]; then
  echo "invoice_pdf_unsupported_architecture" >&2
  exit 1
fi

curl -fsSL https://github.com/qpdf/qpdf/releases/download/v12.3.2/qpdf-12.3.2.tar.gz -o /tmp/qpdf.tar.gz
echo '6cba2f9f2cd887d905faeb99e0e51a307b217920d1bbf3e9cfbb2e8178a2deda  /tmp/qpdf.tar.gz' | sha256sum -c -
tar -xzf /tmp/qpdf.tar.gz -C /tmp
cmake -S /tmp/qpdf-12.3.2 -B /tmp/qpdf-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_STATIC_LIBS=OFF -DBUILD_DOC=OFF \
  -DBUILD_TESTING=OFF -DREQUIRE_CRYPTO_OPENSSL=ON
cmake --build /tmp/qpdf-build --parallel 2
cmake --install /tmp/qpdf-build
g++ -O2 -std=c++17 /src/qpdf-memory.cc -lqpdf -o /usr/local/bin/qpdf-memory
g++ -O2 -std=c++17 /src/pdf-limit-launcher.cc -o /usr/local/bin/pdf-limit-launcher

curl -fsSL https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-unknown-linux-musl.tar.xz -o /tmp/typst.tar.xz
echo 'a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c  /tmp/typst.tar.xz' | sha256sum -c -
tar -xJf /tmp/typst.tar.xz -C /tmp
cp /tmp/typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst
