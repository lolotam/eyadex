# Eyadex rebrand

## Scope
- Replace the retired product name with **Eyadex** across interface copy, metadata, documentation, comments, and saved plans without renaming clinic-domain code or routes.
- Update Arabic and English taglines, set package name to `eyadex-web`, and move browser storage keys to the `eyadex:` prefix.
- Normalize seeded clinic-user emails to `example.com` and platform-team emails to `eyadex.com` where present.
- Reserve the specified clinic slugs in the shared Zod contract and mock API, with translated inline feedback.
- Show the future `<slug>.eyadex.com` address beneath the clinic slug field.

## Validation
- Type-check the project and confirm no `Clinic App` or `clinic-app` strings remain outside generated/dependency artifacts.
- Confirm old browser keys are ignored, fresh demo data seeds successfully, and reserved slugs fail in both the form and mock API.
- Review the Arabic shell and create-clinic form at desktop and mobile widths, then inspect build/runtime logs.

## Boundaries
No new screens, visual-system changes, hosting configuration, cloud services, database work, or server-side business logic.
