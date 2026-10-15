#!/bin/sh
# Disposable: the same Arabic words in Typst with Noto Sans Arabic; extract with pdf.js and pdftotext.
set -e
mkdir -p /tmp/x /tmp/root
printf '%s\n' '#set page(paper: "a4", margin: 15mm)' '#set text(font: "Noto Sans Arabic", size: 10pt, dir: rtl, lang: "ar")' 'عيادة النور التجريبية' '' 'علاج الأسنان — تنظيف بشرة، جلسة ٢' '' 'استشارة طبية (متابعة)' '' 'الإجمالي' \
  | /opt/typst/typst compile --format pdf --ignore-system-fonts --font-path /fonts-noto --root /tmp/root - - > /tmp/noto.pdf
echo "typst_exit=$? bytes=$(stat -c %s /tmp/noto.pdf)"
cp /tmp/noto.pdf /out/noto.pdf
cd /tmp/x && npm init -y >/dev/null && npm i -s --ignore-scripts pdfjs-dist@6.3.289 >/dev/null 2>&1
cat > /tmp/x/e.mjs <<'JS'
import { readFileSync } from "node:fs";
import { getDocument } from "/tmp/x/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const pdf = await getDocument({ data: new Uint8Array(readFileSync("/tmp/noto.pdf")) }).promise;
const { items } = await (await pdf.getPage(1)).getTextContent();
const spaced = items.map((i) => i.str).filter((s) => s.trim() !== "").join(" ");
for (const w of ["علاج", "الأسنان", "بشرة", "استشارة", "عيادة", "التجريبية", "الإجمالي"]) console.log(`${spaced.includes(w) ? "found " : "absent"} ${w}`);
JS
node /tmp/x/e.mjs
apk add --no-cache -q poppler-utils >/dev/null
echo "== pdftotext -raw"; pdftotext -raw /tmp/noto.pdf - | head -5
