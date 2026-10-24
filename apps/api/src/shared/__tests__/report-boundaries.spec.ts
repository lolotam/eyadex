import { readdirSync, readFileSync } from "node:fs";

import { expect, it } from "vitest";

const queryDir = new URL("../../modules/billing/queries/", import.meta.url);

it("billing report queries read branch and service names only through owner ports", () => {
  const violations = readdirSync(queryDir)
    .filter((file) => /^report-.*\.ts$/.test(file))
    .flatMap((file) => {
      const source = readFileSync(new URL(file, queryDir), "utf8");
      return [...source.matchAll(/\b(?:FROM|JOIN)\s+(branches|clinic_services)\b/g)].map(
        ([, relation]) => `${file}: ${relation}`,
      );
    });
  expect(violations).toEqual([]);
});
