// Runs against the BUILT package, not the source: importing @eyadex/ids by name goes through the export
// map, so a wrong path there, or a dist that was never built, fails here instead of in the api or the
// worker at runtime. It is outside src/ and outside vitest's include for the same reason — `pnpm test`
// chains it after the build (`test:node`).
import assert from "node:assert/strict";
import { test } from "node:test";

import { createUuidV7, systemUuidV7 } from "@eyadex/ids";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the export map resolves the package to the built output", () => {
  assert.match(import.meta.resolve("@eyadex/ids"), /dist.index\.js$/);
});

test("the built package generates UUID v7 ids from the system clock", () => {
  const generator = systemUuidV7();
  const ids = Array.from({ length: 100 }, () => generator.newId());
  for (const id of ids) assert.match(id, UUID_V7);
  assert.equal(new Set(ids).size, 100);
});

test("the built package honours injected time and entropy", () => {
  const sources = {
    now: () => 1_727_000_000_000,
    fillRandom: (bytes: Uint8Array) => bytes.fill(0),
  };
  const id = createUuidV7(sources).newId();
  assert.match(id, UUID_V7);
  assert.equal(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16), 1_727_000_000_000);
});
