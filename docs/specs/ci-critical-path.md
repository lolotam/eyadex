# CI critical path — rule, analysis and measurement plan

Owner standing rule, 2026-11-18 (Waleed). The rule itself lives in
[`AGENTS.md`](../../AGENTS.md) → "Standing CI rule"; this file records the analysis behind the
workflow change, what was measured and what is still owed.

Scope: `.github/workflows/ci.yml` only, plus the merge-gate list that names its jobs. No product
code, no schema, no deployment, no security control and no freeze/HOLD changes.

## 1. The critical path as measured (baseline)

Five comparable successful first-attempt pull-request runs, before any change. Same runner class
(`ubuntu-latest`), same cache conditions (pnpm store and Docker layer cache are not shared between
runs, so each run rebuilds), all `attempt=1`, all `conclusion=success`.

| Run                                                                       | Branch                        | Wall to gate     | `db`    | `verify` | `api-image` | `worker-image` | `pdf-reproduction` | Runner minutes (job sum) |
| ------------------------------------------------------------------------- | ----------------------------- | ---------------- | ------- | -------- | ----------- | -------------- | ------------------ | ------------------------ |
| [43650814417](https://github.com/lolotam/eyadex/actions/runs/43650814417) | T3-CODE/p4a-invoice-pdf-lease | 920 s (15.3 m)   | 899 s   | 296 s    | 230 s       | 38 s           | 431 s              | 31.6                     |
| [43545609634](https://github.com/lolotam/eyadex/actions/runs/43545609634) | feat/payments-print           | 1 183 s (19.7 m) | 1 162 s | 264 s    | 271 s       | 50 s           | 433 s              | 36.3                     |
| [43544869415](https://github.com/lolotam/eyadex/actions/runs/43544869415) | feat/invoice-ai-explanation   | 977 s (16.3 m)   | 973 s   | 230 s    | 214 s       | 42 s           | 416 s              | 31.3                     |
| [43542059017](https://github.com/lolotam/eyadex/actions/runs/43542059017) | fix/field-cipher-flake        | 1 158 s (19.3 m) | 1 028 s | 249 s    | 222 s       | 53 s           | 297 s              | 30.8                     |
| [43539628150](https://github.com/lolotam/eyadex/actions/runs/43539628150) | lovable                       | 953 s (15.9 m)   | 951 s   | 254 s    | 181 s       | 52 s           | 489 s              | 32.1                     |

Medians: **wall to the required gate 977 s (16.3 m)**, `db` job 973 s (16.2 m), **runner minutes
31.6**. The `db` job is the critical path in every one of the five runs; `pdf-reproduction` is the
second longest at a median of 431 s.

Failures and retries in the window: one failed first-attempt PR run
(`43543244331`, feat/invoice-ai-explanation) and four cancelled runs — all cancelled by the
`concurrency` group when a newer push replaced the branch, not by a timeout. No run exhausted its
job timeout. No runner-pressure or OOM event was observed in these runs.

## 2. What the `db` job actually spent its time on

Step timings of run 43650814417 (`db`, 899 s): baseline apply 6 s, `db/tests/*.sql` isolation
proofs 1 s, migration-runner self-test 66 s, the four backfill scripts 43 s, workspace install and
build 10 s, `@eyadex/db` 13 s, **API database tests 485 s**, **worker database tests 198 s**,
`@eyadex/auth` 3 s. The two runtime suites are 76 % of the job, and they are independent: the API
suite owns tenancy, identity, auth-over-HTTP and the S3 blob store; the worker suite owns the
dispatcher role and the export pipeline. They shared one job and one database for no reason other
than convenience.

## 3. Techniques applied

- **Independent work starts as soon as its real prerequisite is done.** The deployed-artifact build
  (`pnpm build:all`, `NITRO_PRESET=node-server`) needed only the install, so it moved out of
  `verify` into its own `build` job that starts immediately. `verify` keeps the `verify` check name
  and still covers typecheck, lint and the unit suites.
- **Slow independent suites are split into isolated shards.** `db` becomes four jobs: `db-schema`
  (baseline, negative isolation proofs, runner self-test, backfills — no install, no Redis),
  `db-packages` (`@eyadex/db` + `@eyandex/auth`), `db-api` (the API suite split by file into
  `1/2` and `2/2`, each shard on its own fresh database with its own MinIO), and `db-worker` (the
  worker suite on its own database). Coverage is unchanged — the same suites, distributed — and a
  failing shard fails only itself (`fail-fast: false`).
- **At most two image builds at a time.** The three image jobs became one `images` matrix
  (`api`, `worker`, `pdf-reproduction`) with `max-parallel: 2` and `fail-fast: false`. Runner
  memory was checked first: the hosted runner has 16 GB and each image build compiles native code
  (`g++`, `cmake`) and unpacks fonts; two concurrent builds stay well inside the budget, three
  would double the peak. Because each matrix entry gets its own runner, the cap limits concurrent
  runner usage, not per-runner memory.

Expected effect: the `db` group's longest job drops from ~16 m to ~5 m, and the gate is then bound
by `pdf-reproduction` (~7.2 m). Runner minutes rise by roughly 12 % because every shard repeats the
baseline apply, the install and the workspace build — the trade-off is recorded here and in the
before/after report, not hidden.

## 4. Techniques evaluated and not applied, with the reason

- **Browser checks.** The workflow has no browser or end-to-end job. The bilingual Chrome checks
  (ar/en, 1440/390, every persona) are a manual orchestrator gate in the delivery loop, not a CI
  job, so there is nothing to start earlier. The technique applies only to the artifact build,
  which is now its own job.
- **Main-only staging image builds.** No such check exists: both production image builds
  (`api-image`, `worker-image`) already run on every pull request, so the pre-merge coverage of the
  exact images Dokploy deploys is already there. Moving either to `main` only would remove that
  pre-merge coverage, and that move needs the owner's approval, so it was not made. The one job
  that could have been moved is `pdf-reproduction` (431 s, the new bound of the gate): it
  reproduces the PDF research evidence, and moving it to `main` only would drop that reproduction
  from pull-request coverage. It was evaluated, documented and left in place; the owner decides
  separately whether the evidence reproduction is worth 7 minutes of every pull request.
- **Reusing a shared Docker stage.** `apps/api/Dockerfile` has a `pdf-tools` stage that the runtime
  stage already reuses; `apps/worker/Dockerfile` has no PDF toolchain, and the research image is a
  third, dated evidence Dockerfile that duplicates the native build. Unifying them would couple a
  research artifact to the production image and change the evidence's provenance, for no wall-clock
  gain: each job builds on its own runner with no shared Docker layer cache.
- **A shared GitHub Actions Docker build cache.** It would cut the two heavy image builds on cache
  hits, but it adds a new action and a cache that pull requests can populate. The repository pins
  its actions and keeps the supply-chain posture in §10 of `CLAUDE.md`; the cache was not worth the
  risk for this change. Re-evaluate if the images become the bound of the gate.

## 5. The merge gate after the change

Every outcome the workflow produced before is still produced, and the gate names all of them:
`verify`, `build`, `db-schema`, `db-packages`, `db-api (1/2)`, `db-api (2/2)`, `db-worker`,
`images (api)`, `images (worker)`, `images (pdf-reproduction)`, plus both Socket checks. The
delivery-loop skill's gate list is updated to match. No release, deployment, security or freeze
control changed; the workflow still runs on `pull_request` and on `push` to `main`.

Stack note: the PDF ledger stack (PR177 → PR178 → PR187) also edits `ci.yml` to add the PDF ledger
proof steps to the old `db` job. When that stack lands on `main` it must merge this branch and move
those steps into `db-schema`; otherwise the ledger proof would be lost from the gate.

## 6. Measurement plan

- **Baseline (done, above):** five comparable successful first-attempt code-PR runs, with the run
  links, the wall-clock to the required gate, the per-job split and the aggregate runner minutes.
- **After rollout:** five comparable successful first-attempt code-PR runs on the new workflow,
  collected the same way. `main` runs, reruns and runs with different runner or cache conditions
  are separated from the sample and reported separately, not mixed into it.
- **Recheck:** 2026-12-02, two weeks after the rollout.
- **The report to Waleed:** one before/after document with the sample sizes, the medians, the
  absolute and percentage change of the wall-clock to the gate, the runner-minute and cost
  difference, the failure and retry counts, any observed resource pressure, and the material
  reliability trade-offs. If the after-rollout sample is smaller than five, the report states the
  sample it has and the limits of the comparison.
- **Tracker:** the follow-up is on `roadmap.md` with its due date and owner.

## 7. Why the change is a separate PR

The workflow change is infrastructure, not product work: it touches `.github/workflows/ci.yml`, the
merge-gate list and this record. It rides on its own branch off `main`
(`chore/ci-critical-path`), so it never mixes with the PDF ledger stack, and it is reviewed on its
own before it merges.
