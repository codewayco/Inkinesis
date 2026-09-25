# Experimental quality assessment and bounded repair

The UI and CLI default remain `quality=off`: existing production behavior and the 27 published example rigs are unchanged. This feature is being evaluated on isolated outputs. A model finding does not invalidate an existing avatar.

## Pipeline hooks

Use a **new output directory**, not an existing approved run:

```sh
npm run image-to-rig -- --image example.png --out outputs/quality-trial --quality observe --h100-queue /path/to/existing/queue
npm run inkinesis -- --prompt "your character description" --out outputs/source-repair-trial --quality repair --h100-queue /path/to/existing/queue
```

`observe` records three independent stages: source suitability, prepared PSD layers, and native runtime head/body pose sheets. It does not edit images or introduce a new refusal gate. Observation service failures are logged distinctly from input defects and do not block the original pipeline.

`repair` permits up to **two source edits for generated inputs only**, after clear major/blocking localized source findings. Minor/uncertain findings do not trigger edits. Uploaded images remain immutable and are not automatically repaired. A clear blocking source finding that remains stops the experimental run for review. Unsupported design intent, such as two requested characters or intentionally concealed joints, is not silently simplified. The first failed/non-improving edit ends that sequence. The original and all candidates are retained; eligibility is not human approval.

Regions covering more than 40% of the canvas are held for review rather than fully redrawn. This is a conservative engineering bound, not a measured optimal threshold. Consequently some pose/framing errors cannot currently be repaired automatically.

Prepared-layer and post-rig hooks currently **observe only** even in repair mode. Motion review samples 28 head/expression configurations and 8 body configurations; this is not exhaustive continuous-motion validation. It uses native evaluated geometry and the repository rasterizer without needing a running browser UI. Missing controls are explicitly listed. Layer reconstruction residuals are diagnostic only, with no rejection threshold.

The source image and later candidate paths are kept separately in `report.json`. Resume checks original input, quality mode and cached evidence signatures. Existing run directories cannot be repurposed by changing quality mode on resume.

## Inspect a saved run without regenerating

`tools/quality/checkRun.ts` runs the three observation hooks on an existing run directory and a candidate INP, writing into a separate directory. It reads the run's `input.png` and `assets/character.psd`, calls the configured analysis provider for the visual review, and uses the native verifier for motion sheets. Nothing in the run directory is modified; `integrity.json` records that.

```sh
node --import tsx tools/quality/checkRun.ts outputs/<run-id> outputs/<run-id>/character.inp outputs/<run-id>-quality
```

## Limits

The checks are not calibrated visual classifiers. Prepared-layer and motion hooks do not automatically repair or publish models. Use separate baselines and held-out examples before enabling stronger decisions. The release does not include private frozen-set batch scripts or research artifacts.
