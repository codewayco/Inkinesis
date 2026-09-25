# External components for independent rig generation

Use the installation steps and environment table in [independent preparation](independent_preparation.md). The only source checkouts required for generation are:

| Component | Revision | Purpose |
| --- | --- | --- |
| See-through | `7f139bb25c46a0c8ac720d95ddab185fcda5451c` | Semantic layer/depth inference |
| psd2live | `5526f2e16b57e5f83d34f33730d6fa26d8bc8695` | Facial keyforms and optional Live2D serialization |

Both are installed directly from their original publishers under ignored `.cache/rig/`. Model publisher revisions and checksums are locked in `tools/generate/models/see-through.json`. Keep the engine source unmodified: `prepareDirect.py` checks the engine source revision and rejects modified sources. Our GPL adapters compile in the separate engine process, not the browser bundle.

Prepare JDK 21 and cache Gradle dependencies once before offline exports. Install the original See-through dependencies in `.venv-gen` and preparation dependencies from `tools/generate/requirements-character.txt` in `.venv`. Model weights are not installed by npm.

For the native verifier, install a D compiler/DUB and run:

```sh
npm run prepare:inochi
npm run image-to-rig -- --check
```

The verifier stages Inochi2D 0.8.7 with the checked-in renderless build patch. Optional speech uses the separate eSpeak NG executable. Optional official Core validation uses the private SDK installation described by `reference/cubism/dependencies.json`. No proprietary SDK binaries are redistributed.

See [NOTICE](../../NOTICE), [generation stages](image_to_rig.md), and [Live2D validation boundaries](live2d_export.md).
