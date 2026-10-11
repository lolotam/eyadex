import { z } from "zod";
import { stripInvisibleControls } from "./common.ts";

/**
 * `POST /v1/icd10/search` with `{ q }` in the body — a code prefix or title words, never in a URL (the
 * words a doctor types reveal a diagnosis); 20 billable results, English titles (P2-F1).
 */
export const icd10QuerySchema = z
  .object({
    q: z.string().transform(stripInvisibleControls).pipe(z.string().trim().min(1).max(60)),
  })
  .strict();
export const icd10ResultSchema = z
  .object({
    items: z.array(z.object({ code: z.string(), title: z.string() }).strict()),
    release: z.string(),
  })
  .strict();
export type Icd10Result = z.infer<typeof icd10ResultSchema>;
