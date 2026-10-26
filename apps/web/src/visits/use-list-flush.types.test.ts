import { describe, expect, expectTypeOf, it } from "vitest";
import { z as z3 } from "zod";
import * as z4 from "zod/v4";
import type { ItemsParser } from "./use-list-flush";

type Row = { code: string };

describe("ItemsParser fits both Zod majors", () => {
  it("[Zod 3, current] a schema of { items } is a parser and keeps its row type", () => {
    const schema = z3.object({ items: z3.array(z3.object({ code: z3.string() })) });
    const parser: ItemsParser<Row> = schema;
    const ok = parser.safeParse({ items: [{ code: "A" }] });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expectTypeOf(ok.data.items).toEqualTypeOf<Row[]>();
      expect(ok.data.items[0]?.code).toBe("A");
    }
    expect(parser.safeParse({ items: [{ code: 1 }] }).success).toBe(false);
  });

  it("[v4 stand-in, zod/v4 inside 3.25.76 — not 4.6.6 verification] same contract", () => {
    const schema = z4.object({ items: z4.array(z4.object({ code: z4.string() })) });
    const parser: ItemsParser<Row> = schema;
    const ok = parser.safeParse({ items: [{ code: "B" }] });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.items[0]?.code).toBe("B");
    expect(parser.safeParse({ items: [{ code: 1 }] }).success).toBe(false);
  });
});
