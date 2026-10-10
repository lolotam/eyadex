import { z } from "zod";
import { stripInvisibleControls } from "./common.ts";

/** `GET /v1/icd10?q=` — a code prefix or title words; 20 results, English titles (P2-F1). */
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
