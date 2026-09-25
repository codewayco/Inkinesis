# Publication-copy validation

Validation performed on September 24, 2026, on macOS Apple Silicon. This document covers release packaging and application regression checks, not a new rig-quality experiment.

| Check | Result |
| --- | --- |
| Isolated Node 22, freshly installed npm dependencies | Passed |
| TypeScript application and engine checks | Passed |
| ESLint | Passed |
| Portable unit suite | 158 passed; 2 optional private-reference tests skipped |
| Optional native-reference runtime parity | Both additional tests passed using existing private fixtures; fixtures are not distributed |
| Python preparation tests | 12 passed using the development preparation environment |
| Python 3.14 root requirements resolution | Passed with pip dry-run; no new GPU installation performed |
| Production build | Passed for the original bundled layout; the new metadata-only build is checked separately below |
| npm dependency audit | Zero known vulnerabilities reported after updating Vite and Vitest |
| Browser startup and synthetic rig | Passed: blank startup, prompt input, upload, rendering, control response, neutral reset |
| Browser Save flow | Passed: no persistent output before Save, full artifact tree preserved, repeated-save UI and reload |
| Request boundaries | Cross-origin generation/save and arbitrary export paths rejected |
| Existing avatar library | All 27 load; enabled controls and resets execute; INP and ZIP downloads match SHA-256 checksums |
| Example archive integrity | All 27 ZIP integrity checks passed |
| Published text and metadata scan | No Turkish prose, personal absolute paths, private deployment hostname, or scanned API-key patterns found |
| Documentation links | Local Markdown file links resolve |

Browser checks used headless Chromium and produced no JavaScript page errors. A rendered Purple Couture preview was also visually inspected. Existing binary rigs were copied without regeneration; checksums are in `example-avatars/checksums.json`.

No paid image/analysis API calls, new GPU inference, new Live2D export, or new full visual pose audit were performed for this packaging task. Local CUDA/MPS and remote H100 setup instructions describe supported routes; they do not certify every hardware/driver combination. Users must supply credentials, model access, external components, and compatible GPU resources before generating new rigs.

## On-demand avatar distribution update

The first seven avatar directories and catalog IDs are now numbered 01–07 in UI order. Existing binary bytes are preserved. Twenty-seven small WebP previews were rendered from the existing rigs in neutral poses, without image-generation calls. INP/ZIP payloads were removed from staging and ignored; source assets remain on disk.

The new downloader is validated with local synthetic transfers and browser checks (explicit action, progress, integrity failure, retry, installation of both files, rig control response, and reuse after reload). Production builds include metadata and previews without binary payloads. Live GitHub release download remains untested because no repository or release URL has been provided; none was created or uploaded.

Final update checks: TypeScript and lint passed; 164 unit tests passed and the 2 optional private-reference tests remained skipped. The new browser download test passed, as did the existing startup, Save and all-27-avatar browser tests. The metadata-only build contains no INP/ZIP files and totals about 170 KB; the 27 WebP previews total 102,742 bytes. Release preparation produced 54 hash-verified attachments plus SHA256SUMS locally; no assets were uploaded.

## Local setup and default port

The development server now defaults to port 5200 with strict port selection. Its HTTP setup endpoint was verified on that port. Private machine-specific dependency paths and model IDs are configured only in ignored `.env`; no credentials or private paths were added to public configuration. A tiny upload/download round trip through the existing H100 bridge verified connectivity and an NVIDIA H100 80GB GPU. No new image generation or inference was run. The bridge supports an optional kernel-directory mapping for older running bridge processes.
