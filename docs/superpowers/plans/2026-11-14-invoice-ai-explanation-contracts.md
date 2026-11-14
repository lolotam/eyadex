# Invoice AI Explanation — Contracts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Approved spec: `docs/superpowers/specs/2026-11-14-invoice-ai-explanation-design.md`. Parent plan: `docs/superpowers/plans/2026-11-14-invoice-ai-explanation.md`.

## Task 1: Freeze strict request, admission, status, and error contracts

**Owner:** Orchestrator. **Files:** contract paths in the file map.

- [ ] Write `packages/contracts/src/__tests__/invoice-explanation.spec.ts` with this failing test, then add table cases for lengths 0/1/1000/1001, invalid language, extra properties, all four statuses, and all six failure codes.

```ts
import { expect, it } from "vitest";
import { explanationBodySchema, explanationStatusResponseSchema } from "../invoice-explanation.ts";
it("trims a question and rejects a success with no answer", () => {
  expect(explanationBodySchema.parse({ question: "  Explain tax  ", language: "en" }))
    .toEqual({ question: "Explain tax", language: "en" });
  expect(explanationStatusResponseSchema.safeParse({ request: {
    id: "00000000-0000-7000-8000-000000000001", status: "succeeded",
    explanation: null, errorCode: null,
    createdAt: "2026-11-14T00:00:00.000Z", expiresAt: "2026-11-14T01:00:00.000Z",
  } }).success).toBe(false);
});
```

- [ ] Run `pnpm --filter @eyadex/contracts test src/__tests__/invoice-explanation.spec.ts`. Expected RED: missing module/export, not an infrastructure failure.
- [ ] Add `INVOICE_EXPLANATION_ERROR_CODES` to `common.ts` and spread it into `baseApiErrorCodes`, so API and web enums both carry it. Create the following contract module; use the existing `utcDatetime` wrapper to match repository date handling.

```ts
// common.ts
export const INVOICE_EXPLANATION_ERROR_CODES = [
  "ai_not_configured", "ai_generation_failed", "ai_timeout",
  "ai_rate_limited", "ai_busy", "ai_access_revoked",
] as const;
```

```ts
// packages/contracts/src/invoice-explanation.ts
import { z } from "zod";
import { idSchema, languageSchema, INVOICE_EXPLANATION_ERROR_CODES } from "./common.ts";
import { utcDatetime } from "./datetime-compat.ts";
export const explanationBodySchema = z.object({
  question: z.string().trim().min(1).max(1000), language: languageSchema,
}).strict();
export const explanationTextSchema = z.string().trim().min(1).max(12000);
export const explanationErrorSchema = z.enum(INVOICE_EXPLANATION_ERROR_CODES);
const metadata = { id: idSchema, createdAt: utcDatetime(), expiresAt: utcDatetime() };
export const explanationAdmissionSchema = z.object({ request: z.object({
  ...metadata, status: z.literal("queued"),
}).strict() }).strict();
export const explanationStatusSchema = z.discriminatedUnion("status", [
  z.object({ ...metadata, status: z.literal("queued"), explanation: z.null(), errorCode: z.null() }).strict(),
  z.object({ ...metadata, status: z.literal("running"), explanation: z.null(), errorCode: z.null() }).strict(),
  z.object({ ...metadata, status: z.literal("succeeded"), explanation: explanationTextSchema, errorCode: z.null() }).strict(),
  z.object({ ...metadata, status: z.literal("failed"), explanation: z.null(), errorCode: explanationErrorSchema }).strict(),
]);
export const explanationStatusResponseSchema = z.object({ request: explanationStatusSchema }).strict();
export type ExplanationBody = z.infer<typeof explanationBodySchema>;
export type ExplanationAdmission = z.infer<typeof explanationAdmissionSchema>;
export type ExplanationStatus = z.infer<typeof explanationStatusSchema>;
export type ExplanationStatusResponse = z.infer<typeof explanationStatusResponseSchema>;
export type ExplanationError = z.infer<typeof explanationErrorSchema>;
export const EXPLANATION_REQUESTED = "finance.invoice_explanation_requested";
export const explanationEventPayloadSchema = z.object({ requestId: idSchema }).strict();
```

- [ ] Run the targeted test and `pnpm --filter @eyadex/contracts typecheck`. Expected GREEN. Assert whitespace-only/12001-character answers fail; queued/failed cannot carry answers; admission cannot carry content; response cannot carry `question`, patient fields, or unknown keys.
- [ ] Review checkpoint: hand the exact contracts to Migrations lane and Lovable. Neither lane invents another DTO or error vocabulary.
