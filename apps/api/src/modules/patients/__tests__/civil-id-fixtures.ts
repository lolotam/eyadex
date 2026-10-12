import { fieldCipherFromEnv, indexKeyFromEnv } from "@eyadex/secrets";

import { MEDICAL_KEYS } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { CivilIdCodec } from "../persistence/civil-id-codec.ts";

/** The codec of this test file's run: the same generated keys the harness gave the API (R2-6). */
export const testCivilIds = (): CivilIdCodec =>
  new CivilIdCodec(fieldCipherFromEnv(MEDICAL_KEYS), indexKeyFromEnv(MEDICAL_KEYS));
