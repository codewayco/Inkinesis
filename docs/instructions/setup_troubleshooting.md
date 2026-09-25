# Setup troubleshooting

Start with `npm run check:setup`. It checks paths, model-file sizes, configured model IDs, and credential presence. It does not authenticate provider accounts or certify GPU capacity. Inspect the run report for execution failures.

## Viewer or generation?

Prepared Inkinesis `.inp` files can be played with Node.js and the browser UI, without a GPU or provider API keys. New character generation additionally needs the Python environments, providers, engine, models, and native verifier described in [installation](../../README.md#installation).

Example downloads install the INP and Live2D ZIP under `example-avatars/<id>/`, verifying sizes and SHA-256 hashes. Only catalog metadata and small previews are versioned; large assets are ignored and excluded from the production build. Distribution configuration belongs in the [avatar library guide](avatar_library.md).

## Missing Python or packages

Preparation uses `.venv/bin/python` with `requirements.txt` and Python 3.14. Local GPU inference uses `.venv-gen/bin/python` with `requirements-gpu.txt` and Python 3.12. Install packages with the matching interpreter's `-m pip`; installing into a global Python does not populate either environment.

Custom interpreter paths can be set through `RIG_DIRECT_PYTHON` and `RIG_LOCAL_PYTHON` in `.env`. Restart the dev server after changes.

## API credentials and models

Set both provider keys and both model IDs in `.env`. A key being present does not prove that it is valid or has access to the selected model. Use image generation/editing and Anthropic vision model IDs available to your own accounts. Both input routes use the image provider for expression edits. Provider charges apply.

Never put keys in source code, screenshots, or published logs. `.env` is ignored by Git.

## GPU and memory

Local See-through supports NVIDIA CUDA and Apple Silicon MPS. The runner requires BF16 support; CPU-only inference is not implemented. Native Windows has not been validated; use a Linux environment with working GPU access.

The pinned GPU dependencies come from the validated CUDA environment. MPS has a runner, but the exact fresh dependency combination has not been validated on every macOS version. Use the MPS installation command without the CUDA wheel index.

The approximately 12.5 GiB of downloaded weights is a disk-space figure, not a VRAM requirement. No universal minimum VRAM has been established. An out-of-memory error cannot be solved by selecting CPU mode. Confirm the device, driver, and available memory, or use the configured remote route.

## Missing or incomplete models

Complete the model download command in your selected installation backend. Keep model files at `RIG_DIRECT_MODELS` (default `.cache/rig/models`). Setup checks inspect the model manifest and file sizes; missing files require completing the download rather than bypassing the check.

For `h100` operation, weights and See-through live remotely. Follow [remote setup](remote_gpu.md) instead of downloading a second local copy.

## Java, engine, or verifier errors

Use JDK 21 via `JAVA_HOME` or `RIG_JAVA_HOME`. Keep the pinned psd2live checkout unmodified and run its Gradle `classes` command once with network access to prime dependencies; adapters subsequently build offline.

The native verifier requires a D compiler and DUB. Run `npm run prepare:inochi` after installing them. Java, GPU drivers, model weights, and the Cubism SDK are installed separately; they are not distributed in this repository.

## Remote jobs and fallback

`h100` requires the running bridge and does not use local fallback. `h100-first` requires both a working remote configuration and a complete local inference installation for fallback. Only See-through decomposition runs remotely; preparation and verification still run locally.

For connection, token, transfer, and recovery details, see [remote troubleshooting](remote_gpu.md#failure-and-recovery). GPU and model failures remain visible in the run report.

## Interface and saved results

`npm run dev` opens the local app on port 5200 with no avatar automatically loaded. Select an example or upload a compatible rig. New UI runs remain temporary until **Save**; see [saving and downloads](../../README.md#saving-and-downloads).

A static production build supports uploaded-rig preview. Generation, example installation, and export preparation require the local service. This service is intended for a trusted local machine, not an authenticated multi-user deployment.
