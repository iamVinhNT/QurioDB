# CSV export encoding and formula safety

## Summary and reason

CSV previously passed strings directly to Blob, which always encoded them as UTF-8 regardless of the selected MIME charset. The export now produces actual UTF-8, UTF-16LE, US-ASCII or ISO-8859-1 bytes. UTF-8 and UTF-16LE always include their BOM so Excel can recognize Unicode text, including Vietnamese. ASCII and ISO-8859-1 are strict encodings: unrepresentable headers or values stop the download and show a toast recommending Unicode; no replacement or truncation occurs. Unknown encodings also stop with an error.

The user authorized option A through Supervisor: prefix dangerous CSV text with a TAB inside a quoted field, including column headers and leading-whitespace variants. Finite numeric values and strict signed decimal/scientific strings are preserved. Formula-like expressions, surrounding-whitespace numbers, nonfinite signed text and hex-looking signed text are protected. CSV quote escaping remains intact. Protection covers =, +, -, @, TAB, CR, LF and full-width operator variants. XLSX remains unchanged.

The Settings BOM switch never controlled export and had no typed store field. It is replaced by text explaining mandatory Unicode BOMs and the character limits of legacy encodings. Previously persisted `includeBOM` values remain unused and do not change exports; no settings migration or reset occurs.

## Files changed

- `apps/web/src/lib/export.ts`: encode CSV bytes and protect dangerous cells; report encoding errors through the existing toast library.
- `apps/web/tests/lib/export.test.ts`: byte-level, Vietnamese, BOM, injection, numeric, quoting, and XLSX regressions.
- `apps/web/src/app/settings/components/data-settings/ExportGovernanceCard.tsx`: explain the actual encoding/BOM behavior.
- `CHANGELOG.md` and this detail file: change record and technical review decision.

## Impact and limitations

- Desktop/UI: applies to the bundled web export path and browser mode. The existing Settings -> useSQLLab -> SQLLabResultPanel -> ExportDropdown route already passes resultEncoding; ResultFooter shows that encoding. No startup, health, dynamic API URL or shutdown code changes.
- API/data: no server, database or stored query result changes. No sidecar rebuild is needed.
- Exported data: protected CSV text contains an additional TAB; downstream parsers will retain it. No CSV mitigation is universal across spreadsheet applications. Windows Excel has not been exercised in this Linux environment; Unicode byte/BOM correctness is tested, and delimiter/locale import behavior remains Excel-specific. UTF-16LE may require Excel Text/CSV import to choose the delimiter.
- The object panel export caller separately omits its encoding argument and uses UTF-8 by default. That caller is outside this task's write scope; no change is made there.
- No commit, push, merge or branch creation. Lead owns the uncommitted candidate; review Peer has read-only ownership and relinquishes it on completion.

## Evidence and verification

- Base: `38e75d1`, branch `dev`; working tree was clean before editing.
- Baseline: `cd apps/web && bunx vitest run tests/lib/export.test.ts` — 4 tests passed, 1 file passed, exit 0.
- Candidate: same command — 53 tests passed, 1 file passed, exit 0.
- `cd apps/web && bunx tsc --noEmit` — no diagnostics, exit 0.
- UI change is limited to explanatory text and removal of an unused control; no running-app visual check or packaged desktop/Windows Excel test was run.
- References: [Microsoft Excel UTF-8 BOM guidance](https://support.microsoft.com/en-gb/excel/opening-csv-utf-8-files-correctly-in-excel), [WHATWG encoding specification](https://encoding.spec.whatwg.org/), [OWASP CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection). OWASP recommends a quoted TAB for Excel resistance and documents downstream and cross-application limitations.

## Peer review and Lead decision

Child Run: `run_0c9c66e11a22`. One read-only Peer will review the immutable candidate snapshot; its exact identity, result and explicit Lead ACCEPT/REJECT will be appended here before completion.
