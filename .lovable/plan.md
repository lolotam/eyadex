# Clinic Branches slice

## Scope
- Replace only the clinic Branches placeholder; leave Users, Roles, Patients, Audit, and Settings unchanged.
- Preserve the approved Clinical Operations visual system and Arabic-first RTL behavior.

## Build
- Extend the branch contract with status, address, phone, list query, create input, and update input schemas.
- Add a `branches` namespace to the shared API boundary for list, create, update, deactivate, and reactivate.
- Implement the mock adapter with cursor pagination, search, status filtering, clinic-scope permission checks, active-branch limits, last-active-branch protection, local persistence, and clinic audit records with before/after snapshots.
- Build the Branches page with usage and limit display, permission-aware actions, one search/filter toolbar, responsive table, translated loading/empty/error states, a create/edit side sheet, and deactivate/reactivate confirmation.
- Keep the platform clinic Branches tab read-only but update its columns and status treatment to match the clinic screen.
- Add all Arabic and English copy, update the route metadata, and mark only Branches complete in the roadmap.

## Pattern lock
- Use the existing flat clinical surfaces, compact controls, thin borders, deep-teal actions, and 8px-or-less radii.
- Follow Refero patterns from Mercury-style dense management tables and Shopify-style focused single-column forms: one primary action, one compact filter row, clear row-end actions, and a narrow side sheet.
- Do not change global tokens or add decorative styling.

## Validation
- Verify each demo persona’s visible actions and direct API rejection when permission is missing.
- Verify create/reactivate limits, last-active deactivation protection, persistence, and audit entries.
- Check Arabic RTL at desktop and mobile widths, then confirm the latest preview build and runtime logs are clean.
