# Arabic app terminology and audit categories

## Scope
- Replace Arabic patient-facing app copy with the approved reviewer terminology while leaving English and all `patients` code identifiers unchanged.
- Add clinic-audit categories so patient entities are always `patient_access` and every other entity is `administrative`, with a regression test.
- Split the three named files so each React component lives in its own file, preserving behavior and styling.
- Mark this maintenance task complete in the roadmap.

## Technical details
- Extend the clinic audit entity contract to include `patient` and require the SQL-aligned category enum.
- Derive category inside the single shared mock audit writer rather than trusting callers.
- Move BranchesContent, UsageRow, and the shell Brand into focused neighboring files; keep current public imports stable.
- Verify forbidden Arabic terms are absent outside marketing, then run formatting, typecheck, lint, tests, build, and responsive persona checks in Arabic and English.

## Boundaries
- No marketing, routes, patient identifiers, permission keys, contracts for patient data, SQL, root layout, or shared form changes.
