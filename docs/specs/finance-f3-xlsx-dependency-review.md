# Finance F3 XLSX writer — dependency review

Status: manager decision recorded 2026-10-26, before installation. This file is the T4b step 3 record. It is not a security guarantee, and it does not approve any other package.

## Decision (written before install)

Approve one runtime dependency for `apps/worker` only:

- `write-excel-file` exact `4.1.1`
- license MIT
- Node `>=18`
- published `2026-06-08T04:57:35.177Z` (older than `minimumReleaseAge` 1440 minutes by months)
- integrity `sha512-MUnCnNtQrcZek832ZcU24uU0rSphFmKPD1DvIjXOlygVb93CV7Tme6H3jUTkxsMmjB2W7HIzERzjqTi5kui71A==`

Its only runtime dependency is `fflate@^0.8.2`. The audited target is exact `fflate@0.8.3`:

- published `2026-05-16T00:14:03.449Z`
- integrity `sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==`
- also approved as a direct `devDependency` of `@eyadex/worker` only, so tests can unzip the generated ZIP with `unzipSync`. It is the same package already required transitively. It is not a second parser graph.

Do not add ExcelJS `4.4.0` (nine runtime dependencies), SheetJS, `read-excel-file`, or any other XLSX parser. The writer is write-only.

Registry metadata for both packages has no `preinstall`, `install`, or `postinstall` script. `write-excel-file` has `prepublishOnly` and `fflate` has `prepack`; those are publish/pack scripts. This record is not permission to run package publish scripts or build scripts. `pnpm-workspace.yaml` `minimumReleaseAge: 1440` and `allowBuilds` stay unchanged. No security-guard exception, override, or ignored-script change.

The native npm advisory bulk query for `{ "write-excel-file": ["4.1.1"], "fflate": ["0.8.3"] }` returned `{}` on 2026-10-26. That is no known advisories for those two versions. It is not a full security guarantee.

Pinned sources, fetched as data:

- https://unpkg.com/write-excel-file@4.1.1/README.md
- https://unpkg.com/write-excel-file@4.1.1/node/index.d.ts
- https://unpkg.com/write-excel-file@4.1.1/node/ReturnType.d.ts
- https://unpkg.com/write-excel-file@4.1.1/types/SheetData.d.ts
- https://unpkg.com/write-excel-file@4.1.1/modules/export/writeXlsxFileNode.js
- https://unpkg.com/write-excel-file@4.1.1/package.json (no install-lifecycle scripts; runtime dependency `fflate@^0.8.2` only)
- https://registry.npmjs.org/fflate/0.8.3 (integrity matches the pin; scripts are `test`, `build`, `prepack`, and build helpers — no install-lifecycle script)

v4 Node API, and only this API:

```ts
import writeXlsxFile from "write-excel-file/node";
const bytes = await writeXlsxFile(sheetData).toBuffer();
```

`toBuffer()` returns `Promise<Buffer>` and stays in memory. Do not use the old `buffer: true` option, `toFile`, or any filesystem or network path. Text cells are `{ type: String, value, format: "@" }`. Do not use `type: "Formula"` and do not let an amount be inferred as `Number`. Built-in images and other features stay unused. The published Node entry imports `node:fs`, but only `toFile` uses the filesystem.

## Baseline audit (not clean; install not done when this section was written)

`pnpm audit --prod --json` already failed on the lock inherited from `main` `0529b7a3`, before these packages were added: 21 findings (6 low, 13 moderate, 2 high, 0 critical). The highs are `vite@8.1.5` (`GHSA-587h-7wmj-h5pm`, Windows launch-editor bypass) and `zod@3.25.76` (`GHSA-mrhx-c7xc-m3w5`, collection OOM). Unrelated dependency upgrades are not authorized. These findings are a separate triage and merge gate. No suppressions. Installation of the writer had not been run when this section was written.

## Resolved install

Installed after the section above, with no `pnpm update` and no change to `pnpm-workspace.yaml` (`minimumReleaseAge`, `allowBuilds`, overrides).

Commands:

- `pnpm --filter @eyadex/worker add --save-exact write-excel-file@4.1.1`
- `pnpm --filter @eyadex/worker add --save-dev --save-exact fflate@0.8.3`

`apps/worker/package.json` now has runtime `write-excel-file` `4.1.1` and devDependency `fflate` `0.8.3`, both exact. The lockfile diff against the previous lock is only those two packages (importer entries, resolution blocks, and the `write-excel-file@4.1.1` snapshot). No other locked version moved.

Resolved integrity, matching the pins and the registry documents fetched above:

- `write-excel-file@4.1.1` → `sha512-MUnCnNtQrcZek832ZcU24uU0rSphFmKPD1DvIjXOlygVb93CV7Tme6H3jUTkxsMmjB2W7HIzERzjqTi5kui71A==`
- `fflate@0.8.3` → `sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==`

`write-excel-file@4.1.1` depends only on `fflate@0.8.3`. `fflate@0.8.3` has no dependencies. The worker importer lists `fflate@0.8.3` as a direct devDependency so tests can call `unzipSync`. Post-install advisory bulk query for `{ "write-excel-file": ["4.1.1"], "fflate": ["0.8.3"] }` returned `{}` (zero properties). That is no known advisory on these two versions after install, not a full security guarantee. A later non-empty result stops the task. The pre-existing 21-finding production audit is unchanged in kind: it is still not clean, and it is not suppressed.

## Carriage return in text cells

XML 1.0 section 2.11 requires a processor to normalize line breaks on input, before parsing: the two-character sequence `#xD #xA`, and any `#xD` not followed by `#xA`, become a single `#xA`. A character reference such as `&#13;` is not a literal `#xD`, so it survives that step and decodes to CR afterwards. https://www.w3.org/TR/xml/#sec-line-ends

`write-excel-file@4.1.1` writes text through shared strings and leaves a literal CR in that XML (`modules/xlsx/files/sharedStrings.xml.js`). A standard reader, including openpyxl 3.1.5, therefore turns a leading CR into LF. The apostrophe guard is not the loss.

The public feature hook cannot rewrite `xl/sharedStrings.xml`. In `modules/xlsx/generateXlsxFileContents.js`, `files.write.files` runs, and only then the library assigns `files['xl/sharedStrings.xml']`. The transform map in `types/Feature.d.ts` does not include that file. `xl/worksheets/sheet1.xml` already exists at the hook and is not generated again.

The library's shared-string map is a plain object (`initializeSharedStrings.js`). A lookup of `constructor`, `__proto__`, `toString`, or `hasOwnProperty` returns an inherited value, not a numeric index, and the sheet can become unreadable. The writer therefore does not clone that index. The same public `Feature<T>` hook, inferred at the `writeXlsxFile` call with no cast, rereads the sheet and rewrites each non-empty text cell by its standard address (`A1`, …) from the sheet values this writer owns. Numeric cells, styles, and row order stay. CR is stored as `&#13;`. `&`, `<`, and `>` stay escaped. A literal `&#13;` in the input stays those characters.

Coverage of those owned addresses is recorded in a set during that one sheet pass, then checked by set size. It does not scan the worksheet XML once per cell. A non-string hook read fails closed (`SheetTextMissed` → `export_value_invalid`, no uncorrected sheet).

Before that call, XLSX text is checked against the XML 1.0 `Char` production (https://www.w3.org/TR/xml/#charsets). A forbidden control, an unpaired surrogate, or U+FFFE/U+FFFF is `export_value_invalid` with no bytes and no stripping. CR, LF, TAB, Arabic, a well-formed emoji, U+FFFD, and the discouraged-but-legal C1 range stay. This check is XLSX only. No new package, no lockfile change, no filesystem, and no second ZIP pass.
