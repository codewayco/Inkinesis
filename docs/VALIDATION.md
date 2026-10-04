# Release 2 validation

Checked on October 4, 2026, on macOS Apple Silicon. A separate source-only copy was assembled from publishable files, without `.env`, research directories, local avatar payloads, model caches or proprietary SDKs. It received a fresh `npm ci` under Node 22.23.3 and a fresh Python 3.14 virtual environment using `requirements.txt`.

| Check | Result |
| --- | --- |
| Clean npm installation | Passed; lockfile resolves without dependency changes |
| TypeScript application and engine | Passed |
| ESLint | Passed; local ignored research workspaces are excluded |
| Portable unit suite | 39 files; **214 passed**, 2 optional private-reference tests skipped |
| Clean Python preparation installation/tests | **58 passed** |
| Production build | Passed; 57 files, 471,855 bytes; metadata/previews only, no INP/ZIP/MOC3/CMO3 payloads |
| npm dependency audit | **0 known vulnerabilities** after updating the two transitive `brace-expansion` versions |
| Browser startup and synthetic rig | Passed: empty startup, prompt entry, optional picker, uploaded INP, control response, neutral reset and request boundaries |
| Upload review browser flow | Passed: source warnings, redraw preview, reload recovery, explicit selection/hash confirmation, visual review and limited-motion result, failed redraw recovery, as-is, cancel and unchanged prompt payload |
| Browser Save flow | Passed: temporary preview, explicit Save, complete artifact tree, repeat-save behavior and reload |
| Example download browser flow | Passed: explicit action, progress, corrupt transfer rejection, retry, both formats, playback and local reuse |
| Installed avatar library | **53/53** load; both downloads match hashes; enabled controls reach requested values and return to their defaults |
| ZIP CRC integrity | **53/53** pass |
| Release attachment preparation | Exactly **106** verified avatar files plus `SHA256SUMS`; obsolete attachments removed only after successful preparation |
| Catalog/checksum consistency | All 106 entries agree; 53 preview paths resolve |
| Saved Cubism evidence | 53 current INP/MOC3 identities match saved reports; 53 Core-aware zero-mismatch reports, 8 strict-source zero-mismatch reports |
| Optional Cubism reference typecheck | Passed in the development workspace with its separately installed SDK; not required or available in a clean portable checkout |
| Local generation preflight | Passed with the development configuration |
| Source/publication scan | No scanned credential patterns or developer absolute paths; local Markdown links resolve; no oversized Git payloads |

The browser tests completed without JavaScript page errors. Purple Couture's rendered preview was visually inspected. All-53 control checks verify runtime operation and resets, not the aesthetic quality of every pose. The saved Core evidence audit rechecks artifact identity; it does not rerun Core or certify visual quality.

## Corrections made during this audit

- Removed the unused error formatting/exit helpers, unreachable direct-image generation branch, unused upload-normalization return value, obsolete deprecated-directory configuration and unreferenced legacy character figure. Import/reference searches checked remaining modules against the player, pipeline, CLI commands, tests and documentation; optional adapters and documented tools remain active entry points.
- Fixed strict H100 CLI preflight incorrectly requiring local inference dependencies when `allowLocalFallback` was omitted. Added policy regression coverage; the UI prompt path keeps its existing backend policy.
- Fixed fractional joint ranges causing HTML sliders to round neutral or requested values. Browser checks now verify exact targets and restored defaults for every installed avatar.
- Kept oversized upload/confirmation failures readable and released the request slot without destroying the response socket. Added recovery coverage.
- Made release preparation replace its generated directory after full verification, preventing removed/renamed avatars from surviving into the next release. Added stale-file and failed-verification tests.
- Excluded local export workspaces from Git and ignored research directories from lint. Updated obsolete 27-avatar publication instructions and release URLs.
- Added the upload browser regression to CI and refreshed vulnerable transitive dependency pins within their existing version ranges.

## Generation and publication boundaries

This release audit made no new paid image/analysis calls or GPU inference runs. The preceding upload integration check used one real photo, reviewed its redraw, completed H100 decomposition and local rigging, saved the result and reopened it. That run's rest silhouette IoU was approximately **0.993**, with articulated limbs, head axes, blink and mouth; its visual state remained **needs review**. One successful example is not a guarantee for arbitrary uploads or identity preservation.

The optional two native parity tests require private fixtures via `RIG_TEST_ASSET_DIR`; they were skipped in the portable suite. Native reference tools, GPU inference and provider access still require their separately documented dependencies. The clean install validates preparation dependencies, not a new CUDA/MPS installation on every supported platform. Vite currently emits a non-fatal warning about extensionless configuration imports under a possible future native loader; the current build succeeds.

The catalog targets `codewayco/Inkinesis` release **`avatars-v2`**, which returned HTTP 404 at audit time. Installed local avatars and synthetic download tests pass, but a real fresh-checkout download cannot be certified until the maintainer publishes the matching attachments. Follow [release instructions](RELEASE.md). No files were staged or committed, and no release, tag, push or media upload was performed.

## Reproduce

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:python
npm run build
npx playwright install chromium
npm run verify:upload
npm run verify:example-download
node --import tsx tools/verify/uiSaveSmoke.ts
# With npm run dev running separately:
npm run verify:ui
# With all current avatar payloads installed:
npm run verify:examples
npm run prepare:avatar-release
# With saved local Cubism export reports:
python3 tools/media/auditCatalog.py
```
