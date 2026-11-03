#!/bin/sh
set -eu

# Pin the tested tools to release sources, independent of replaceable Alpine package revisions.
curl -fsSL https://github.com/qpdf/qpdf/releases/download/v12.3.2/qpdf-12.3.2.tar.gz -o /tmp/qpdf.tar.gz
echo '6cba2f9f2cd887d905faeb99e0e51a307b217920d1bbf3e9cfbb2e8178a2deda  /tmp/qpdf.tar.gz' | sha256sum -c -
tar -xzf /tmp/qpdf.tar.gz -C /tmp
cmake -S /tmp/qpdf-12.3.2 -B /tmp/qpdf-build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_STATIC_LIBS=OFF -DBUILD_DOC=OFF \
    -DBUILD_TESTING=OFF -DREQUIRE_CRYPTO_OPENSSL=ON
cmake --build /tmp/qpdf-build --parallel 2
cmake --install /tmp/qpdf-build

curl -fsSL https://poppler.freedesktop.org/poppler-25.12.0.tar.xz -o /tmp/poppler.tar.xz
echo 'c18b40eb36b1a0c5b86e29ca054bf0770304583da4f2cdd42fe86eca6a20de48  /tmp/poppler.tar.xz' | sha256sum -c -
tar -xJf /tmp/poppler.tar.xz -C /tmp
cmake -S /tmp/poppler-25.12.0 -B /tmp/poppler-build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -DENABLE_UNSTABLE_API_ABI_HEADERS=OFF \
    -DENABLE_GLIB=OFF -DENABLE_GOBJECT_INTROSPECTION=OFF -DENABLE_QT5=OFF \
    -DENABLE_QT6=OFF -DENABLE_CPP=OFF -DENABLE_BOOST=OFF \
    -DENABLE_GPGME=OFF -DENABLE_NSS3=OFF -DENABLE_CURL=OFF \
    -DENABLE_LIBCURL=OFF -DENABLE_LIBTIFF=OFF -DENABLE_LIBOPENJPEG=none \
    -DENABLE_LCMS=OFF -DENABLE_CMS=none -DBUILD_GTK_TESTS=OFF \
    -DBUILD_QT5_TESTS=OFF -DBUILD_QT6_TESTS=OFF -DBUILD_CPP_TESTS=OFF \
    -DBUILD_MANUAL_TESTS=OFF
cmake --build /tmp/poppler-build --parallel 2
cmake --install /tmp/poppler-build
