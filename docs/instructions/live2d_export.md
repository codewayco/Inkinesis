# Optional Live2D export from a combined rig

The Live2D backend is an additional, explicit export. The original INP remains available alongside Live2D. The combined player offers both download formats. No image generation, landmark inference or See-through run is needed when a combined INP already exists.

**Compatibility: Cubism 5.0 or newer is required for the default export.** Use a compatible Cubism Viewer/Editor and runtime; the channel blend shapes in this delivery are not a Cubism 4.2 target. Additive geometry and channel morphs are built-in defaults.

## Download from the UI

Run `npm run dev`, then select or generate a character. Under **Download rig**, choose **Inochi (.inp)** for the original rig or **Live2D (.zip)** for the complete Live2D package. Extract the ZIP and open its `.model3.json` in Cubism Viewer. The archive also includes texture PNGs, parameter display information, the reconstructed `.cmo3`, export notices and opening instructions. The packages of the downloadable example avatars omit the `.cmo3` editor project to keep downloads small; export the rig yourself to obtain it.

Downloads are keyed by source bytes and exporter code. For a generated UI avatar, the ZIP and newly produced export files live inside that trial’s `live2d-downloads/` directory; **Save** includes them. If you export after saving, they are written beside the saved rig. Preset conversions use an OS temporary cache. Save does not itself run a new Live2D conversion; prepare it through **Live2D (.zip)** when required. First-time conversion requires the dependencies below; repeated downloads reuse the ZIP. This endpoint is development-only, accepts only saved preset and generated-job INP paths, and shares the generation lock. It does not call image APIs. Locally uploaded arbitrary INP files remain preview-only in the UI; the CLI below is available for compatible combined rigs.

## Export an existing character

Use a new empty output directory. The exporter refuses to overwrite an existing delivery. `model/` contains the MOC3, model3 manifest, CDI3 parameter names, texture PNGs and reconstructed CMO3 editor project. Keep the entire directory together. Drag the `.model3.json` file into Cubism Viewer; use `.cmo3` for Cubism Editor. The Viewer uses the textures referenced by the manifest, so copying only the MOC3 is insufficient.

## Opt in at the end of a new automatic run

```sh
npm run image-to-rig -- --image character.png --live2d
npm run inkinesis -- --prompt "A front-facing character in shorts" --live2d
```

The default remains INP only. The optional stage runs after the original INP delivery is prepared, under a separate `live2d-<run-id>/` directory. Failure of this secondary export is reported without invalidating or overwriting the validated INP. The automatic run reports the Live2D manifest, editor project and export report paths. Official Core validation remains an explicit second command; export alone never claims playback acceptance.

## Conversion contract

- Read the final combined INP, including its corrected textures and final body meshes.
- Map coupled `Head Angles` to `ParamAngleX/Y`, arms to `ParamShoulderL/R` and `ParamElbowL/R`, and legs to `ParamHipL/R` and `ParamKneeL/R`. Keep scalar face controls and the source parameter ranges.
- Encode additive geometry and scalar channel morphs, preserving the coupled joint key grids and opacity channels. Cubism's near-key sampling differs slightly from Inochi's continuous interpolation.
- Carry UVs, triangle indices, clipping-source assignments and stable back-to-front order. Convert centered INP canvas coordinates to the exporter canvas coordinates.
- Repack the texture pages. Byte-identical and unsampled INP pages are dropped; each drawable's UV box, with two texels of original padding, is copied into square power-of-two pages with an 8-pixel transparent gutter, and its UVs are moved by the same integer offset. Every drawable samples the same texels as in the INP; drawables that shared one atlas slot still share it. The INP is not rewritten. `export.json` records the source and packed pages under `atlas`.
- Export a Cubism 5.0-or-newer runtime through the separately installed pinned psd2live/Umamo exporter. Its MOC3 warnings fail the export rather than silently dropping features.
- Reconstruct a CMO3 from final atlas slices. This is useful editable mesh/keyform data, but not a restoration of the original PSD source layers or artist-authored deformer hierarchy. The upstream `MissingSourceArt` notice is preserved.

This is a restricted combined-INP backend, not a general Inochi-to-Live2D converter. Nonidentity transforms and unsupported rendering state are refused. Cubism soft alpha clipping differs from Inochi's thresholded stencil; exact raster edge parity is not promised. No physics, automatic tracking mappings, idle or walk motion files are invented. Custom limb parameters must be driven manually or mapped by the consuming application. High-dimensional meshes can have many keyforms and may be less convenient to edit.

## Dependencies and isolation

Reuse the pinned external engine from [the component runbook](component_runbook.md): psd2live commit `5526f2e16b57e5f83d34f33730d6fa26d8bc8695` with unmodified source. `RIG_DIRECT_ENGINE` and `RIG_JAVA_HOME` environment variables override the local paths. JDK 21 and already cached Gradle dependencies are required (`--offline`). The exporter uses a maximum Java heap of 16 GB by default; `INKINESIS_LIVE2D_JAVA_HEAP` can adjust the resource budget. This is a heap ceiling, not a constant allocation. Very large reconstructed editor projects may need that budget; lowering it can cause an out-of-memory export failure. Bridge JSON is streamed in chunks to avoid the JavaScript string-size limit. The adapter and Gradle task run as a separate process; the GPL-3.0-only adapter is not bundled into either browser player. Upstream source, binary dependencies and Live2D proprietary libraries are not vendored.

## Near-key runtime differences

Use `npm run reference:combined -- source.inp export-directory --near-keys` to probe both sides of authored keys as well as the regular pose set. Cubism snaps values within 0.001 physical parameter units to a key; Inochi continuously interpolates. The harness reports the **raw strict source-parity result** and errors separately from `coreSampling`, which evaluates the expected Cubism sampling rule with the same 0.005-pixel/1e-5-opacity tolerances. `passed_with_runtime_differences` is deliberately distinct from exact source parity. Because pages are repacked, `textureSampling` compares texels rather than page indices: each triangle centre is sampled from the exported page at Core's UVs and from the source page at INP UVs. This does not change the INP, MOC3 or browser evaluator.

Prepared examples include Live2D ZIP packages. For a new generated rig, the on-demand exporter builds a package locally; export failure leaves the Inochi file available.
