// Disposable: pdf.js text of page 1, raw items around the Arabic description cells, and per-word search.
import { readFileSync } from "node:fs";
import { getDocument } from "/tmp/x/node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const pdf = await getDocument({ data: new Uint8Array(readFileSync("/out/probe-50.pdf")) }).promise;
const { items } = await (await pdf.getPage(1)).getTextContent();
const strs = items.map((i) => i.str).filter((s) => s.trim() !== "");
const joined = strs.join("");
const spaced = strs.join(" ");
for (const word of ["علاج", "الأسنان", "بشرة", "استشارة", "عيادة", "التجريبية", "الإجمالي", "consultation"]) {
  console.log(`${spaced.includes(word) ? "as-is " : joined.includes(word) ? "glued " : "absent"} ${word}`);
}
const i = strs.findIndex((s) => s.includes("سنان") || s.includes("سن"));
console.log("items near the first description:", JSON.stringify(strs.slice(Math.max(0, i - 3), i + 4)));
