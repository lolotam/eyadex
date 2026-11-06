import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { invoicePdfModel } from "/app/dist/modules/billing/domain/invoice-pdf-model.js";
import { orderedPages } from "/app/assets/invoice-pdf/page-order.mjs";

// Synthetic-only image smoke test. The production adapter's host-policy and
// performance gates remain closed; this calls the packaged child directly.
assert.notEqual(process.getuid(), 0);
assert.equal(existsSync("/app/src"), false, "source files must not enter the runtime bundle");
assert.equal(existsSync("/app/assets/invoice-pdf/build-native.sh"), false);
assert.equal(existsSync("/app/assets/invoice-pdf/qpdf-memory.cc"), false);
assert.match(readFileSync("/proc/self/limits", "utf8"), /^Max core file size\s+0\s+0\s+bytes/m);
for (const name of ["qpdf/LICENSE.txt", "qpdf/NOTICE.md", "typst/LICENSE", "typst/NOTICE"]) {
  assert(readFileSync(`/usr/share/licenses/${name}`).length > 0, "missing tool license/notice");
}
for (const [name, expected] of [
  ["Amiri-Regular.ttf", "ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7"],
  ["Amiri-Bold.ttf", "cfccb794268e7d573d857e6d6a67f89cf8a053e8ffd85dfa0c8ec1bb36fc4827"],
])
  assert.equal(
    createHash("sha256")
      .update(readFileSync(`/app/assets/fonts/${name}`))
      .digest("hex"),
    expected,
  );

function child(binary, args, input) {
  const result = spawnSync(binary, args, {
    input,
    env: {},
    cwd: "/",
    timeout: 5000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, "packaged PDF tool failed");
  assert.equal(result.error, undefined);
  return result.stdout;
}
assert.match(child("/usr/local/bin/typst", ["--version"]).toString(), /^typst 0\.15\.1\b/);
assert.match(child("/usr/local/bin/qpdf", ["--version"]).toString(), /qpdf version 12\.3\.2\b/);
const model = invoicePdfModel(
  {
    id: "SYN-INVOICE",
    number: "SYN-000001",
    status: "issued",
    source: "manual",
    sourceId: null,
    branchId: "SYN-BRANCH",
    branchNameAr: "فرع تجريبي",
    branchNameEn: "Synthetic Branch",
    patientId: "SYN-PATIENT",
    issuedAt: "2026-01-01T00:00:00.000Z",
    currency: "KWD",
    currencyExponent: 3,
    subtotalMinor: "1000",
    discountMinor: "0",
    taxRateBp: 0,
    taxMinor: "0",
    totalMinor: "1000",
    invoiceDiscount: null,
    voidReason: null,
    voidedAt: null,
    version: 1,
    lines: [
      {
        position: 0,
        kind: "free",
        serviceId: null,
        providerId: null,
        descriptionAr: "فحص تجريبي",
        descriptionEn: "Synthetic examination",
        quantity: 1,
        unitPriceMinor: "1000",
        discount: null,
        lineTotalMinor: "1000",
      },
    ],
  },
  {
    clinicAr: "عيادة تجريبية",
    clinicEn: "Synthetic Clinic",
    timezone: "Asia/Kuwait",
    address: null,
    phone: null,
    commercialRegNo: null,
  },
  "مراجع تجريبي",
);
const paths = {
  typst: "/usr/local/bin/typst",
  qpdf: "/usr/local/bin/qpdf-memory",
  fonts: "/app/assets/fonts",
  root: "/pdf-root",
};
const pdf = child(
  process.execPath,
  ["/app/assets/invoice-pdf/render.mjs", JSON.stringify(paths)],
  Buffer.from(JSON.stringify(model)),
);
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
assert(pdf.length <= 5 * 1024 * 1024);
const document = JSON.parse(child(paths.qpdf, ["to-json"], pdf));
assert.equal(orderedPages(document).length, 1);
const objects = document.qpdf[1];
const descriptors = Object.values(objects).filter((o) => o.value?.["/Type"] === "/FontDescriptor");
const amiri = descriptors.filter((o) => /Amiri-(Regular|Bold)$/.test(o.value["/FontName"]));
assert.equal(amiri.length, 2);
assert(amiri.every((o) => o.value["/FontFile2"] || o.value["/FontFile3"]));
// BoundWord Type3 fonts embed their glyph programs directly, without FontFile2.
for (const object of Object.values(objects)) {
  if (object.value?.["/Subtype"] !== "/Type3") continue;
  const procs = object.value["/CharProcs"];
  const resolved = typeof procs === "string" ? objects["obj:" + procs].value : procs;
  assert(Object.values(resolved).every((ref) => objects["obj:" + ref]?.stream?.data));
}
console.log(
  "Packaged tools, font hashes, zero core limits, non-root render and embedded fonts passed.",
);
