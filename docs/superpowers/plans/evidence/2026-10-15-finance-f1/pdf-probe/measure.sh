#!/bin/sh
# Disposable: inspect the synthetic PDF, then time Typst with binary and fonts on the container filesystem.
set -e
apk add --no-cache -q poppler-utils time >/dev/null
echo "== pdfinfo"; pdfinfo /out/probe-50.pdf | grep -E "Pages|Page size|PDF version|Producer"
echo "== pdffonts"; pdffonts /out/probe-50.pdf
echo "== page 2, first lines"; pdftotext -f 2 -l 2 -layout /out/probe-50.pdf - | head -6
echo "== header row per page"; for p in 1 2 3; do printf "page %s: " "$p"; pdftotext -f $p -l $p /out/probe-50.pdf - | grep -c "Description" || true; done
mkdir -p /tmp/t /tmp/f /tmp/root /tmp/o /probe-root
cp /opt/typst/typst /tmp/t/typst && cp /fonts/*.ttf /tmp/f/
echo "== harness timing, binary + fonts on tmpfs"
node /work/probe.mjs /tmp/t/typst /tmp/f /tmp/o | grep -E '"(1|20|50)"|coldMs|warmP50Ms|warmP95Ms|exit'
echo "== peak RSS per compile (GNU time), 50 lines"
for i in 1 2 3; do node /work/emit.mjs 50 | /usr/bin/time -f "rss_kb=%M elapsed_s=%e exit=%x" /tmp/t/typst compile --format pdf --ignore-system-fonts --font-path /tmp/f --root /tmp/root - - > /dev/null; done
