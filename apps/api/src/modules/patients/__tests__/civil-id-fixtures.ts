import { fieldCipherFromEnv, indexKeyFromEnv } from "@eyadex/secrets";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { MEDICAL_KEYS, type Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { CivilIdCodec } from "../persistence/civil-id-codec.ts";

/** The codec of this test file's run: the same generated keys the harness gave the API (R2-6). */
export const testCivilIds = (): CivilIdCodec =>
  new CivilIdCodec(fieldCipherFromEnv(MEDICAL_KEYS), indexKeyFromEnv(MEDICAL_KEYS));

/** What the backfill command builds, on the API's own `eyadex_app` pool. */
export const backfillDeps = (h: Harness, batchSize?: number) => ({
  db: h.app.get<Database>(DATABASE),
  civilIds: testCivilIds(),
  ...(batchSize === undefined ? {} : { batchSize }),
});
