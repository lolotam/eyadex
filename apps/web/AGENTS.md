# apps/web rules

- The medical module lives in `apps/web/src/visits` (visit screens) and `apps/web/src/medical` (medical file, attachments, medicines); its mock rules are `shared/api/mock/mock-medical-*.ts`, whose audit rows carry field names only — so clinical text can never reach the log.
- Mock rules live in `apps/web/src/shared/api/mock/`: `mock-actor.ts` resolves the signed-in account and applies the permission check order, `mock-audit.ts` is the only clinic audit writer — so every namespace enforces the same rules.
- A persona may pin an exact clinic account (`memberId`); a deactivated account makes every request fail with `account_disabled`, and the clinic shell sends the user to sign-in — sessions end on deactivation.
- Role permission keys are always read live from the role (no copies on accounts), and saving a role keeps keys of switched-off modules untouched — so module toggles and role edits take effect immediately and reversibly.
- Patients branch scope hides out-of-scope files as `not_found` and patient audit snapshots use an explicit field allowlist (no civil ID) — so files can't be probed and sensitive IDs never reach the log.
- Platform accounts and platform settings live in the mock store; every platform-console call resolves the signed-in platform account first (`mock-platform-actor.ts`, which also holds the single platform audit writer) — so platform deactivation ends sessions and actor names are real.
