# Swap kie.ai for Higgsfield in the scroll-craft skill

The scroll-craft skill (from your upload) generates its images and video clips through kie.ai. This plan replaces that provider with Higgsfield everywhere in the skill, keeping the same workflow (probe / still / shot commands).

## Changes

1. **Rewrite `scripts/kie.mjs` as `scripts/higgsfield.mjs`**
   - Same command shape: `probe` (credit check), `still "<prompt>" out.png --ar 16:9 [--ref img]`, `shot "<move>" in.png out.mp4 [--dur 5]`.
   - Calls the Higgsfield API instead of api.kie.ai; API key read from `HIGGSFIELD_API_KEY` (env or project-root `.env`).
   - I will verify the current Higgsfield API endpoints/models from their docs before writing the script.

2. **Update `scripts/doctor.mjs`** — check for `HIGGSFIELD_API_KEY` instead of `KIE_AI_API_KEY`, and call the new probe command.

3. **Update the docs inside the skill**
   - `SKILL.md`: description and asset-generation sections mention Higgsfield, new script name, new env var.
   - `references/assets.md` and `references/verify.md`: command examples, cost/credit notes adjusted (Higgsfield pricing noted as approximate, since published unit costs differ).
   - `references/approved-collection.md`: provider mention updated.
   - `CHANGELOG.md`: new entry recording the provider swap (old entries kept as history).

4. **Activate the updated skill** so it's available in this workspace.

## Notes

- The skill is design tooling only — it does not touch the Eyadex app code, and no app screens change.
- Exact Higgsfield model names and credit costs will be confirmed against their API docs during the edit; anything uncertain gets a comment in the script rather than a guess.
