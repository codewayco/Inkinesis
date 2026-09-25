# Automatic image-to-rig and Inkinesis prompt mode

The default CLI and browser generation path uses [repository-owned preparation](independent_preparation.md), original See-through and pristine psd2live.

Run `npm run dev` and open the printed local URL. The home page opens the current avatar workflow directly, with image/prompt input, saved characters, motion controls, speech and both rig download formats.

For an additional Live2D MOC3/model3 package from the final combined rig, see [the optional Live2D export](live2d_export.md). Existing INP output remains the default.

## Commands

```sh
npm run image-to-rig -- --check
npm run image-to-rig -- --image /path/to/character.png
npm run inkinesis -- --prompt "A front-facing character in a T-shirt and shorts"
# Choose an output directory, then resume the same input after an external failure:
npm run image-to-rig -- --image /path/to/character.png --out outputs/my-character
npm run image-to-rig -- --image /path/to/character.png --out outputs/my-character --resume
```

CLI runs use isolated directories under `outputs/` by default (`RIG_OUTPUT_DIR` overrides this). UI runs instead use OS temporary directories: press **Save** after generation to persist all produced files under `outputs/<job-id>/`. The session selector lets you revisit unsaved avatars; these previews do not survive an ordinary dev-server process exit. **Load last saved** reads persistent outputs. A failed or unsupported trial can also be saved if its input image exists. Save waits until generation/export finishes and never overwrites an existing run. Existing saved files are retained. No coordinates or garment flags are required. A process lock prevents concurrent CLI/UI jobs from competing for the local GPU and external Gradle build. The UI polls asynchronous jobs and reconnects to its job after a page reload. Generate does not keep one HTTP request open throughout inference.

## Saving and downloads

UI runs stay in OS temporary directories until you click **Save**. Saving copies the complete run into `outputs/<job-id>/` by default: prompt, image, analysis, layers, rig, validation, previews, logs, and any prepared Live2D exports. `RIG_OUTPUT_DIR` changes that destination. **Load last saved** reopens the latest completed saved rig. Unsaved previews expire on normal server shutdown; abrupt crashes can leave temporary files.

The **Live2D (.zip)** button prepares the second format on demand. Save does not itself run a Live2D conversion. Exporting after Save stores the export beside the saved rig. The ZIP contains model files, not VTube Studio hand-tracking configuration. [Export details](live2d_export.md).

## Actual stages

1. Normalize image orientation, format and maximum dimension (1536 pixels). For text input, run the existing hosted character drawer in an isolated working directory first.
2. Infer clothing support and anatomical landmarks from the actual image through the configured Anthropic client. Record model, prompt digest, input digest, reasons, confidence and pixel coordinates.
3. Prepare foreground alpha and neutral background locally with our edge-connected background estimator.
4. Run the pinned See-through layer/depth models on the selected GPU backend. UI defaults to local; H100-first and strict H100 are optional. Verify source and weight pins. Decompose the exact prepared image used by the expression stages.
5. Derive feature masks from semantic layers, request expression edits directly, register them against unchanged face pixels, measure their support and serialize the prepared PSD with pixel-exact readback.
6. Run pristine psd2live through our direct CPU source-bust adapter in a separate process.
7. Build the combined `.inp` from that bust and this repository's continuous two-joint limb rig. Reject body foldovers at the existing authored keys and half-grid samples.
8. Evaluate the actual file with the native Inochi verifier, audit browser/native geometry and opacity, check sampled body triangle orientation, render signed evidence frames, and make an animated demo.
9. Write `report.json`, `REPORT.md`, `analysis.json`, `build.json`, `validation.json`, `character.inp`, `layers.psd`, `poses.json`, evidence frames and `demo.gif`. The UI exposes the rig, report and demo.

A resumed run preserves prior report snapshots and appends stage logs. Analysis is reused only for the same normalized-image digest. Successful local decomposition is reused only when both input and output digests match. The direct expression adapter validates input, mask, prompt, model and output hashes. Resume refuses a changed source image or prompt. A failed stage never becomes a successful delivery.

## Result policy

- `unsupported`: multiple/non-front-facing characters. These still exceed the face builder's contract; partial capabilities do not promise a rig for every image.
- `needs_review` without a rig: insufficient overall analysis confidence or unusable eye landmarks for the current bust adapter. Do not invent missing anatomy.
- `needs_review` with a rig: each arm, leg, head, blink and mouth is assessed independently. Clothing or uncertain joints disable only the affected region. Points below 0.5 are unusable; 0.5–0.8 retains an uncertainty note. These thresholds apply to model-reported confidence, **not calibrated probabilities**.
- `failed`: missing environment, provider failure, invalid source assets or an unrecoverable build/validation failure. Preserve the stage and its log.

### Regional movement capabilities

The source analysis records visible separation and attachment evidence per limb. Clear fitted-clothing contours may locate a joint; generic body proportions alone may not. Long garments do not reject healthy arms or the whole character. The user's requested design is preserved.

Prepared See-through layers are checked for ownership and distal limb coverage. Unsupported chains retain their drawn pixels without independent controls. Missing or failed expression edits disable only that expression. Their neutral state is baked into the rig so disabling a control does not reveal an expression patch. Head, blink and mouth are independent; facial hair is not an automatic mouth refusal.

Each candidate limb is tested with the existing mesh gate. If its authored range fails, a half-range candidate is tested with skin and clothing together. If that also fails, the chain remains fixed. The report and rig metadata distinguish `articulated`, `limited` and `fixed`, with the stage and reason. No unverified sway is invented for a hidden joint. Existing head/neck/roll mathematics is unchanged.

The UI explains unavailable movements and disables their sliders and incompatible motion clips. Source-only assessments are explicitly candidates, never enabled motion. These checks do not prove natural seams, correct depth ownership or identity preservation: inspect the preview before Save. Existing saved avatars are not automatically rebuilt or replaced.

The report schema reserves `success` for a future acceptance policy. Current automatic runs deliberately end as `needs_review` even after structural validation; no automated run is labeled human-approved. Independent blink support requires actual open-eye source layers, not merely parameters bearing eye names. Walk/gesture clips are previews, without foot planting or physics.

## Environment

The existing configured API credentials are read from `.env` without entering the browser bundle. Analysis uses `ANTHROPIC_API_KEY`; image/expression generation uses `OPEN_AI_API_KEY` (the direct edit adapter also supports `OPENAI_API_KEY` and `LLM_API_KEY`). Uploaded images leave the machine for these configured providers. See-through runs on H100 when available, with a local GPU fallback. Generation has API usage costs.

The local defaults reuse the prepared development dependencies. Set these environment variables to use persistent installations elsewhere:

| Variable | Default |
| --- | --- |
| `RIG_DIRECT_PYTHON` | `.venv/bin/python` |
| `RIG_LOCAL_PYTHON` | `.venv-gen/bin/python` |
| `RIG_DIRECT_ENGINE` | `.cache/rig/psd2live` |
| `RIG_JAVA_HOME` | `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` |
| `RIG_DIRECT_SEE_THROUGH` | `.cache/rig/see-through` |
| `RIG_DIRECT_MODELS` | `.cache/rig/models` |
| `RIG_DEVICE` | `mps` (`cuda` is also supported) |
| `RIG_ANALYSIS_MODEL` | Existing repository default `claude-opus-5` |

The preflight checks paths, model-file sizes and credential presence; it does not certify provider availability, Python imports, GPU availability or downloaded-weight integrity. The stage runners perform those checks. Temporary dependencies can disappear after system cleanup; they are not vendored into this repository. See [the component runbook](component_runbook.md) for exact pins, dependency preparation and licensing, and [the combined method runbook](independent_preparation.md) for the rig contract and known limitations.

## Runtime and validation boundaries

The browser reads the restricted INP subset emitted by `buildCombined`: linear scalar/vector keyforms, deformation, opacity, PNG atlases and native threshold masks. It rejects unrelated INP files and unsupported binding modes. The renderer draws the actual embedded meshes and textures using WebGL 2; no geometric PSD re-export occurs. Native comparison tests cover both cached characters' signed endpoints, coupled head lattice, expressions and simultaneous clips. Geometry/opacity parity is distinct from native GPU pixel parity.

`npm run build:player` builds the current player. Model generation requires the development server and prepared local tools; a static build does not host the generation service. Record uses the existing browser recorder and produces silent video.

No avatar is loaded automatically. **Pick an Avatar** lists the 27 example characters; select one and press **Download** to install its files. Saved Inochi and Live2D packages require no model requests.
