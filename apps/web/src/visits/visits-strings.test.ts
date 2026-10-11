import { describe, expect, it } from "vitest";
import { arVisits } from "@/shared/i18n/ar-visits";
import { enVisits } from "@/shared/i18n/en-visits";

function keys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("the P2 strings", () => {
  it("Arabic and English hold the same keys", () => {
    expect(keys(arVisits).sort()).toEqual(keys(enVisits).sort());
  });

  it("Arabic says «المراجع» and «زيارة», never «المريض»", () => {
    const text = JSON.stringify(arVisits);
    expect(text).not.toMatch(/المريض|المرضى/);
    expect(text).toContain("المراجع");
    expect(text).toContain("زيارة");
    for (const word of [
      "ملاحظات الطبيب",
      "الملف الطبي",
      "التشخيص",
      "الروشتة",
      "المرفقات",
      "اعتماد",
      "ملحق",
      "زيارة مباشرة",
    ]) {
      expect(text).toContain(word);
    }
  });
});
