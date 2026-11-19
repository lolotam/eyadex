# Delivery tiers — Light / Medium / Heavy Implementation Pipeline

Owner standing rule, 2026-11-19 (Waleed), applied to Eyadex from PosPay PP-195
(`lolotam/PayPos.systems#1085`). Waleed's verbatim instruction is recorded in
[`docs/owner-decisions.ar.md`](../owner-decisions.ar.md).

The rule is summarised for day-to-day work in `CLAUDE.md` §2.2 and in `AGENTS.md`. This file is
the full text: the lane map for Eyadex, the plan-summary format, and the delivery-loop steps each
tier replaces. No product code, no schema, no deployment and no security control changes with it.

## 1. The tier card (before every new task)

Every new task is tiered **before** it starts — side tasks and follow-up issues included:

- One questionnaire card to the owner, in Arabic, with three options. The first option is the
  recommendation and is marked «(المقترح)».
- The card states the tier, the recommendation, a one-line reason and an exception option (for
  example an extra review round, or an extra step on top of the tier).
- The work does not start before the answer arrives.
- The tier and the exception are written in the brief and in the PR body.
- Fix rounds inside a running task need no new card.

## 2. The three tiers

### LIGHT

Covers: documentation, specs, plans, ADRs, roadmap and status files, i18n, and small CSS/UI
changes up to about 150 lines.

Never LIGHT: money, permissions or authentication, database or migrations, API work, a new
dependency.

- Implementer: the manager or the cheapest available lane.
- The PR merges as soon as CI is green. The review bots are not awaited and are not a gate.
- No staging deploy of its own; the change ships with the next deploy.

### MEDIUM

- Review: at most 3 rounds — a local review (`/code-review`) plus the project's review bots
  (Codex, MergePilot, CodeRabbit, Socket). A bot stuck for more than an hour is skipped, and that
  is stated in the merge report.
- CI must be green on the exact head that merges.
- After round 3: P2/P3 findings become issues instead of blocking; P0/P1 findings still block.
- Staging deploys are batched daily.

### HEAVY

Covers: migrations, money, permissions or authentication, security, and long-running background
jobs.

- Claude Fable 5.2 (medium) writes the implementation plan; Codex Astra 6.2 (medium) debates that
  plan for one round before any implementation starts.
- Then the full review and CI, under the project's review-round cap.
- A PR that carries a migration, money or permissions/authentication merges **only** after the
  owner's card approval, after every gate. Other Heavy work is merged by the manager after every
  gate.
- Staging deploy alone, right after the merge.
- With a migration: take a DB snapshot first and keep the receipt.

## 3. Implementer fallback (fixed order)

Use only the lanes this project has, and keep the order:

| Tier   | Order                                               |
| ------ | --------------------------------------------------- |
| Light  | manager → Claude Sonnet                             |
| Medium | Kimi → MiniMax → Grok → Claude Sonnet               |
| Heavy  | Kimi → MiniMax → Grok → Claude Sonnet (high effort) |

After two failures or an exhausted quota, move to the next lane without asking.

**Lane map for Eyadex.** The owner rule names GLM as a step (Light: "manager/GLM"; Medium and
Heavy: "Kimi → MiniMax → GLM → Grok → Claude Sonnet"). This environment has no GLM lane, so GLM is
dropped and every other lane keeps its place; the manager lane covers the manager/GLM step. The
lanes that exist here are Claude (the reviewer and the Light fallback), Kimi, MiniMax (this
manager), Grok, and Codex (review bot and the Heavy plan-debate lane).

## 4. Plan summary after every merge

After every merge, the active plan is reported in three parts:

- «ما تم» — the main tasks that are done, with their PR numbers.
- «الباقي» — each remaining main task, with its sub-tasks underneath and their status.
- «التوصية» — the recommendation.

Side tasks are folded into the plan under their main task, and any roadmap or status file is kept
in sync. Every report ends with exactly these headings: «المطلوب منك»، «الخطوة الجاية اللي أنصح
بيها»، «ملاحظة» — write «مفيش» when there is nothing to add.

## 5. What each tier replaces in the delivery loop (`CLAUDE.md` §2.1)

| Gate (§2.1)                                         | LIGHT                                       | MEDIUM         | HEAVY                                           |
| --------------------------------------------------- | ------------------------------------------- | -------------- | ----------------------------------------------- |
| Review bots (Codex, MergePilot, CodeRabbit, Socket) | not awaited, not a gate                     | up to 3 rounds | full review, under the round cap                |
| Local review and CI on the exact head               | green CI is enough                          | required       | required                                        |
| Staging trial before the merge                      | skipped                                     | skipped        | skipped                                         |
| Staging deploy                                      | none of its own; ships with the next deploy | daily batches  | alone, right after the merge                    |
| Owner card before the merge                         | not needed                                  | not needed     | required for migration, money, permissions/auth |

Everything else in the delivery loop stays as written: the slice review (typecheck, lint, tests,
node-server build, real-Chrome checks in Arabic and English at 1440px and 390px for every
persona), the merge commit, the fast-forward of `lovable`, and the auto-deploy from `main`.

## 6. What the tiers never change

- Every other rule in `CLAUDE.md` and `CLAUDE.architecture.md` stays in force: forced RLS with its
  negative isolation test, one slice per PR, the merge commit, the 300-line limit, the security
  rules and the testing matrix.
- The owner keeps production, the server, secrets and every HOLD. No tier automates them.
- The tier is decided in the owner's card, never guessed. A missing answer blocks the start.
