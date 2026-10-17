#!/bin/sh
# Disposable: same 3-line document with optional ligatures off; render PNG + PDF, then extract with pdf.js.
set -e
mkdir -p /probe-root /tmp/o /tmp/x
node -e '
import("/work/doc.mjs").then(async ({ documentFor }) => {
  const fs = await import("node:fs");
  const doc = documentFor(3).replace(fs.readFileSync("/work/invoice.typ", "utf8"), fs.readFileSync("/work/invoice-noliga.typ", "utf8"));
  process.stdout.write(doc);
});' > /dev/shm/doc.typ
for f in pdf png; do /opt/typst/typst compile --format $f --ignore-system-fonts --font-path /fonts --root /probe-root - - < /dev/shm/doc.typ > /out/noliga-3.$f; echo "$f exit=$?"; done
rm /dev/shm/doc.typ
cd /tmp/x && npm init -y >/dev/null && npm i -s --ignore-scripts pdfjs-dist@6.3.289 >/dev/null 2>&1
sed 's#/out/probe-50.pdf#/out/noliga-3.pdf#' /work/extract.mjs > /tmp/x/e.mjs && node /tmp/x/e.mjs
