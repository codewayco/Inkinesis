# README media

The gallery and browser motion frames are rendered from existing example avatars, using the Inkinesis browser renderer. The two figure images come from the technical report and reuse the same saved renders. No new character images were generated for the README.

| File | Content |
| --- | --- |
| `showcase.mp4` | All 53 current catalog rigs in an aligned, right-to-left scrolling showcase: neutral above, the repeating four-second “See it move” sequence below. 1600×1000, 24 fps, H.264, 105 seconds, no audio. Two-second opening and seven-second closing holds; one character-width of travel every two seconds. |
| `showcase.html` | Standalone local video player. Open directly in a browser, or visit `/docs/media/showcase.html` while the dev server runs. |
| `showcase-poster.png` | First frame of the two-row showcase, matching the inline video composition. |
| `showcase-provenance.json` | Source rig and renderer hashes, supported controls, GIF angle targets and timing, sampled range checks, review times, output hashes and encoding settings. |
| `stages.webp` | Top row of the technical report's teaser figure: Purple Couture's source illustration beside renders of the generated rig with arms, legs, both combined, and a closed-eye open-mouth expression. Rasterized from the figure PDF; panels are the same saved runtime renders used in the report. |
| `pipeline.webp` | The website’s six updated pipeline panels with Arial HTML labels captured at 2× resolution. Badges map to steps 01/02/02/02/03/04; joints distinguish VLM proposal from Inkinesis verification. Composed and official-Core poses match; the export overlays real Core triangles. |
| `gallery.webp` | All 53 current example rigs freshly rendered in neutral poses on a pure black background and composed into one labelled grid. No UI or preview-footer pixels are included. |
| `catalog-validation.json` | Saved official Cubism Core validation reports matched by hash to the 53 current INP files and packaged MOC3 models; both catalog artifacts are also verified. This is an evidence audit, not a new Core run. |
| `motion.gif` | A four-second, 12 fps loop of Purple Couture, Solstice Mosaic, and Saffron Orbit, rendered at 1040×524. Arms open and close over 0–1.2 s with mirrored shoulders 0–16° and elbows 0–30°. Leg motion overlaps the arm phase by 0.2 s: right hip/knee over 1–1.8 s, then left over 1.8–2.6 s, reaching 18° hip and 45° knee targets. Head/face motion begins at 2.4 s, reaches yaw ±20° and roll ±10° with blink and mouth opening, and returns to neutral over 3.6–4 s. Each capture panel is 30 px wider to avoid clipping. Only presentation controls change; rig data is unchanged. |
| `face.gif` | Close-up of Purple Couture from the same renderer, showing head and expression controls over a four-second loop. |
| `vtube-face.gif` | Continuous face-tracking excerpt from the existing Purple Couture VTube Studio session: 21.5–25.5 seconds. |
| `vtube-hands.gif` | Continuous face and hand-driven arm excerpt from the existing VTube Studio session: 26–30 seconds. |
| `vtube-provenance.json` | Source recording hashes, timestamps, crop rectangles, output dimensions, and timing for the two VTube Studio excerpts. |
| `studio.webp` | Updated 2026-09-25: the running browser interface with Purple Couture, a black stage, ivory controls, Motion Demo, and simplified speech controls. Captured at 1440×1060 CSS pixels with 2× pixel density; lossless WebP. Only application content is captured. |

The gallery and animation use a custom presentation background around actual runtime renders. The UI image is a separate browser capture. Images illustrate selected assets and controls, not a quantitative quality evaluation or a guarantee for arbitrary inputs.

These media follow the same asset terms as the example characters; see [asset licensing](../../LICENSE-ASSETS.md). The screenshots contain no desktop, raw webcam image, account information, or credentials. VTube Studio excerpts retain the tracking landmark panels and application UI. Each four-second excerpt is downsampled to 12 fps, retains the original playback speed, and loops with an end-to-start cut. No frames are synthesized or rearranged. The source recordings remain outside the publication repository.

The VTube Studio clips show a selected demonstration on one avatar, with separately configured hand-to-arm mappings. They are not a tracking accuracy benchmark. Application UI and branding belong to their respective owners.

## Full character showcase

The showcase uses the same meshes, textures, evaluator and WebGL renderer as the viewer. Both rows share horizontal positions; the top remains neutral while the lower row repeats the four-second `motion.gif` sequence. All 53 catalog entries appear. The video opens with Purple Couture, Solstice Mosaic, Saffron Orbit, Ultramarine Tempo and Desert Ranger; other avatars follow by the number of supported limbs, with Tidal Glass and Ember Waltz last. This is presentation order only: the catalog and gallery order are unchanged.

Camera speed is unchanged: a two-second opening hold and seven-second closing hold, with a 96-second scroll advancing one character-width every two seconds, for 105 seconds overall. Animation continues during both camera holds and throughout the scroll; there is no per-avatar delay, one-shot gesture or long idle period after a gesture ends.

The reference GIF's four-second phase windows and angle targets are used directly:

| Time within each loop | Controls and targets |
| --- | --- |
| 0–1.2 s | Both arms open and close: mirrored 16° shoulders and 30° elbows. |
| 1–1.8 s | Right leg: +18° hip and 45° knee flexion, then neutral. |
| 1.8–2.6 s | Left leg: −18° hip and 45° knee flexion, then neutral. |
| 2.4–4 s | Head yaw ±20° and roll ±10°, blink and mouth opening; final return to neutral over 3.6–4 s. |

Hip signs mirror the rig's right-knee flexion sign. Body and head phases overlap only at the transitions described for the GIF. No extra pitch, garment sway or body sway is introduced. Head key timing is reconstructed from the reference GIF's frames; the original GIF capture script is not present in this checkout. Mouth opening is capped at 0.65. The prior 60% amplitude multiplier and slower per-character gesture families are removed. Targets are clamped only to each rig's actual exported range, with missing/fixed limbs and individual head/face capabilities left at rest. The source rigs are unchanged.

The generator checks 193 sampled times per rig for finite, in-range values and return to neutral at loop boundaries. Full-body review sheets sample neutral, arms, each leg, and both head directions; separate head-and-neck sheets include the blink and final return. Review sheets remain in ignored `.cache/readme-media/`. No frame synthesis or character generation is involved. The showcase regeneration leaves Purple Couture's existing GIFs, studio screenshot, stages figure and VTube Studio recordings unchanged. The pipeline figure was updated separately on 5 October 2026, as documented below.

### Reproduce locally

Install all current catalog rigs and the project's npm dependencies. Supply an FFmpeg binary with H.264 encoding support (`libopenh264` by default, or set `SHOWCASE_ENCODER=libx264`). The script starts an isolated local Vite server on port 5207 and a headless Playwright browser; it does not call generation providers or upload files.

```sh
# Seven representative characters; writes ignored preview.mp4 and a poster.
FFMPEG=/path/to/ffmpeg node --import tsx tools/media/renderReadme.ts preview

# All 53 avatars, phase-peak body and head review sheets only.
node --import tsx tools/media/renderReadme.ts review

# Update the video, poster and provenance without changing the gallery.
FFMPEG=/path/to/ffmpeg node --import tsx tools/media/renderReadme.ts video

# Also regenerate the neutral gallery in catalog order.
FFMPEG=/path/to/ffmpeg node --import tsx tools/media/renderReadme.ts full

# Recheck saved Core evidence against catalog payloads; requires local export reports.
python3 tools/media/auditCatalog.py
```

### README and GitHub playback

The README links a video poster to the repository MP4 and includes a standalone local player link. Open `docs/media/showcase.html` directly to watch it before publishing. GitHub does not turn a repository-relative MP4 into an inline attachment player. After uploading the new `showcase.mp4` through GitHub Issues, place the resulting bare attachment URL at the marked comment in the README; retain the repository link so the video remains available locally. The previous attachment URL has been removed. Nothing is uploaded automatically.

### Method panels — 5 October 2026

`method/pipeline-*.webp` contains the six panel images used by the README’s HTML table. Labels stay in HTML so they remain readable rather than shrinking inside one wide raster. `pipeline.webp` is the complete, high-resolution figure for enlargement. The four steps and panel captions match the independent project page.

Source illustration, layers, expression edits and verified landmarks are saved Purple Couture outputs. Composition uses the published rig’s browser preview; export uses the matching MOC3 rendered by official Cubism Core. The right half of that panel overlays actual deformed Core triangles, projected with the reference renderer’s MVP. Only rendered output is included; no SDK binaries are copied. Saved verification: 379 poses, 1 strict mismatch, 0 Core-aware mismatches. This figure capture is not a new validation sweep.

`method/provenance.json` records source and output hashes, exact control values, topology counts and validation values. Other README motion/media assets are unchanged.
