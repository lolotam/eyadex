#!/bin/sh
# Disposable: does headless Chromium extract the Arabic words Typst garbles? Synthetic page, same font.
set -e
apk add --no-cache -q chromium >/dev/null
chromium-browser --version || chromium --version
mkdir -p /tmp/page /tmp/x
cp /fonts/ar-IBMPlexSansArabic-Regular.ttf /tmp/page/plex.ttf
cat > /tmp/page/index.html <<'HTML'
<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
@font-face { font-family: Plex; src: url(plex.ttf); }
@page { size: A4; margin: 15mm; }
body { font-family: Plex; font-size: 10pt; }
.en { direction: ltr; unicode-bidi: isolate; }
</style></head>
<body>
<p>عيادة النور التجريبية</p>
<p>علاج الأسنان — تنظيف بشرة، جلسة ٢</p>
<p>استشارة طبية (متابعة)</p>
<p>الإجمالي <span class="en">15.000 KWD</span></p>
<p>التاريخ: ١٥ أكتوبر ٢٠٢٦ / <span class="en">15 October 2026</span></p>
</body></html>
HTML
start=$(date +%s%N)
chromium-browser --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=/tmp/page/chromium.pdf file:///tmp/page/index.html 2>/dev/null || true
end=$(date +%s%N)
echo "chromium_exit_pdf_bytes=$(stat -c %s /tmp/page/chromium.pdf 2>/dev/null || echo none) elapsed_ms=$(( (end - start) / 1000000 ))"
cp /tmp/page/chromium.pdf /out/chromium.pdf
cd /tmp/x && npm init -y >/dev/null && npm i -s --ignore-scripts pdfjs-dist@6.3.289 >/dev/null 2>&1
cat > /tmp/x/e.mjs <<'JS'
import { readFileSync } from "node:fs";
import { getDocument } from "/tmp/x/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const pdf = await getDocument({ data: new Uint8Array(readFileSync("/tmp/page/chromium.pdf")) }).promise;
const { items } = await (await pdf.getPage(1)).getTextContent();
const strs = items.map((i) => i.str).filter((s) => s.trim() !== "");
const spaced = strs.join(" ");
for (const w of ["علاج", "الأسنان", "بشرة", "استشارة", "عيادة", "التجريبية", "الإجمالي", "15 October 2026", "15.000 KWD"]) {
  console.log(`${spaced.includes(w) ? "found " : "absent"} ${w}`);
}
console.log("items:", JSON.stringify(strs));
JS
node /tmp/x/e.mjs
apk add --no-cache -q poppler-utils >/dev/null
echo "== pdftotext -raw"; pdftotext -raw /tmp/page/chromium.pdf - | head -6
echo "== pdffonts"; pdffonts /tmp/page/chromium.pdf
du -sh /usr/lib/chromium 2>/dev/null || true
