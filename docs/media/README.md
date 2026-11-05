# README media

The gallery, showcase, contribution figures and browser motion frames are rendered from the 94 evaluated avatars, using the Inkinesis browser renderer. The two figure images come from an earlier paper figure and reuse the same saved renders. No new character images were generated for the README.

| File | Content |
| --- | --- |
| `title-light.png`, `title-dark.png` | The README title in the website's heading font (Google Sans Flex 600, −0.045 em tracking) at 64 px, rendered at 3× on a transparent background; dark text for GitHub's light theme and light text for its dark theme. |
| `wacv-2027.png` | The WACV 2027 badge from the project website (`.publication-venue`: #380513 fill, #fd084d border, Google Sans Flex 26 px bold), captured from the site at 3× pixel density on a transparent background and shown at the site's 222 px width. |
| `showcase.mp4` | 40 of the 94 evaluated rigs in an aligned, right-to-left scrolling showcase: neutral above, the repeating four-second “See it move” sequence below. 2400×1500, 60 fps, H.264 (CRF 24, animation tuning), 94.5 seconds, about 21 MB, no audio. Each rig is rendered at three times its on-screen size and downscaled with high-quality smoothing, so line art stays free of texture aliasing. Cells are wider than the character spacing and are composited with a lighten blend, so a neighbour's black background never cuts off an outstretched arm or held object. Two-second opening and five-second closing holds; one character-width of travel every 2.5 seconds. |
| `showcase.html` | Standalone local video player. Open directly in a browser, or visit `/docs/media/showcase.html` while the dev server runs. |
| `showcase-poster.png` | First frame of the two-row showcase, matching the inline video composition. |
| `showcase-provenance.json` | Source rig and renderer hashes, supported controls, GIF angle targets and timing, sampled range checks, review times, output hashes and encoding settings. |
| `stages.webp` | Top row of an earlier paper teaser figure: Purple Couture's source illustration beside renders of the generated rig with arms, legs, both combined, and a closed-eye open-mouth expression. Rasterized from the figure PDF; panels are the same saved runtime renders used in the report. |
| `pipeline.webp` | The website’s six updated pipeline panels with Arial HTML labels captured at 2× resolution. Badges map to steps 01/02/02/02/03/04; joints distinguish VLM proposal from Inkinesis verification. Composed and official-Core poses match; the export overlays real Core triangles. |
| `gallery.webp` | All 94 evaluated rigs rendered in neutral poses on a pure black background and composed into one labelled ten-column grid in the evaluation order (the paper's teaser characters first), rendered before the shipped 30 were renumbered 01–30; a regenerated gallery follows the new ID order. No UI or preview-footer pixels are included. |
| `ownership.webp` | Garment ownership on Saffron Orbit and Papaya Broadcaster, two evaluated characters whose sleeves follow the arms and whose trousers or shorts have a seat region shared by both legs (Papaya Broadcaster's rig is in the local `other-avatars/` folder, not the shipped catalog): artwork, garment parts recolored by the limb parameters that deform them (left, right, both legs, none) at rest and in a pose, and the delivered rig in that pose. Non-garment parts are shown as a dim silhouette. |
| `carriers.webp` | Cedar Ridge Ranger at rest, in a raised-arm pose, and in the same pose with the deformation bindings of its object layers removed. Halos mark the object layers; the bar values are the paper's carrier ablation. |
| `export.webp` | Emerald Star Wand in a pose, half rendered and half drawn as its posed triangle mesh, beside the paper's Cubism Core verification results. |
| `catalog-validation.json` | Saved official Cubism Core reports matched by MOC3 hash to the 30 shipped Live2D packages: 164 poses each, all within 0.005 px. Both catalog artifacts are also verified by size and SHA-256. This is an evidence audit, not a new Core run. |
| `motion.gif` | A four-second, 12 fps loop of Purple Couture, Ember Forge Smith and Asphalt Comet Skater, rendered at 1040×524 at a shared figure height; the held hammer, tongs and skateboard follow the hands. Arms open and close over 0–1.2 s with mirrored shoulders 0–16° and elbows 0–30°. Leg motion overlaps the arm phase by 0.2 s: right hip/knee over 1–1.8 s, then left over 1.8–2.6 s, reaching 18° hip and 45° knee targets. Head/face motion begins at 2.4 s, reaches yaw ±20° and roll ±10° with blink and mouth opening, and returns to neutral over 3.6–4 s. Renders keep a margin around each rig canvas so raised arms and held objects are not clipped. Only presentation controls change; rig data is unchanged. |
| `face.gif` | Close-up of Purple Couture from the same renderer, showing head and expression controls over a four-second loop. |
| `studio.webp` | Updated 2026-09-25: the running browser interface with Purple Couture, a black stage, ivory controls, Motion Demo, and simplified speech controls. Captured at 1440×1060 CSS pixels with 2× pixel density; lossless WebP. Only application content is captured. |

The gallery and animation use a custom presentation background around actual runtime renders. The UI image is a separate browser capture. Images illustrate selected assets and controls, not a quantitative quality evaluation or a guarantee for arbitrary inputs.

These media follow the same asset terms as the example characters; see [asset licensing](../../LICENSE-ASSETS.md). The screenshots contain no desktop, account information, or credentials.

## Full character showcase

The showcase uses the same meshes, textures, evaluator and WebGL renderer as the viewer. Both rows share horizontal positions; the top remains neutral while the lower row repeats the four-second `motion.gif` sequence. The cast is 34 characters that hold objects in their source illustration and six empty-handed anime characters. Ten held-object characters from an earlier 50-character cut were removed after a visual check at every phase peak, because their meshes tear, leave holes or drop the held object even at reduced angles. Three others (Amber Pangolin Ceramist, Turquoise Raven Calligrapher, Starberry Spacefarer) keep the full leg and head targets but use half the shoulder and elbow targets, so their mug, scroll and helmet stay with the hand and inside the frame; `showcaseArmScale` records them. Read left to right, holders alternate with empty-handed characters until the latter run out; the remaining holders follow. `showcaseCast` in `tools/media/showcaseMotion.ts` records this order. The gallery uses a separate order (see `gallery.webp` above).

The camera holds for two seconds at the start and five seconds at the end, with an 87.5-second scroll advancing one character-width every 2.5 seconds, for 94.5 seconds overall. The video is encoded at 60 fps so the scroll advances in small steps instead of visible jumps. Animation continues during both camera holds and throughout the scroll; there is no per-avatar delay, one-shot gesture or long idle period after a gesture ends.

The reference GIF's four-second phase windows and angle targets are used directly:

| Time within each loop | Controls and targets |
| --- | --- |
| 0–1.2 s | Both arms open and close: mirrored 16° shoulders and 30° elbows. |
| 1–1.8 s | Right leg: +18° hip and 45° knee flexion, then neutral. |
| 1.8–2.6 s | Left leg: −18° hip and 45° knee flexion, then neutral. |
| 2.4–4 s | Head yaw ±20° and roll ±10°, blink and mouth opening; final return to neutral over 3.6–4 s. |

Hip signs mirror the rig's right-knee flexion sign. Body and head phases overlap only at the transitions described for the GIF. No extra pitch, garment sway or body sway is introduced. Head key timing is reconstructed from the reference GIF's frames; the original GIF capture script is not present in this checkout. Mouth opening is capped at 0.65. The prior 60% amplitude multiplier and slower per-character gesture families are removed; the only amplitude change is the halved arm targets of the three characters listed above. Targets are clamped only to each rig's actual exported range, with missing/fixed limbs and individual head/face capabilities left at rest. The source rigs are unchanged.

The generator checks 193 sampled times per rig (24 samples per second over two loops) for finite, in-range values and return to neutral at loop boundaries. Full-body review sheets sample neutral, arms, each leg, and both head directions; separate head-and-neck sheets include the blink and final return. Review sheets remain in ignored `.cache/readme-media/`. No frame synthesis or character generation is involved. The showcase regeneration leaves `face.gif`, the studio screenshot, the stages figure unchanged; `motion.gif` has its own `gif` mode. The pipeline figure was updated separately on 5 October 2026, as documented below.

### Reproduce locally

Install the project's npm dependencies and the rigs to render. The UI ships avatars 01–30 in `example-avatars/`; the other 64 (31–94) live in an untracked local `other-avatars/` folder with its own `catalog.json` in the same format. The scripts merge both catalogs in ID order when `other-avatars/` exists, so the gallery, showcase and review sheets cover all 94; without it they cover the 30 shipped examples, and the 40-character showcase cannot be rebuilt. Supply an FFmpeg binary with H.264 encoding support (`libopenh264` by default, or set `SHOWCASE_ENCODER=libx264`). The script starts an isolated local Vite server on port 5207 and a headless Playwright browser; it does not call generation providers or upload files.

```sh
# Seven representative characters; writes ignored preview.mp4 and a poster.
FFMPEG=/path/to/ffmpeg node --import tsx tools/media/renderReadme.ts preview

# All installed avatars (94 with other-avatars/), phase-peak body and head review sheets only.
node --import tsx tools/media/renderReadme.ts review

# The three-character motion.gif.
FFMPEG=/path/to/ffmpeg node --import tsx tools/media/renderReadme.ts gif

# Update the video, poster and provenance without changing the gallery.
FFMPEG=/path/to/ffmpeg node --import tsx tools/media/renderReadme.ts video

# Also regenerate the neutral gallery in ID order.
FFMPEG=/path/to/ffmpeg node --import tsx tools/media/renderReadme.ts full

# Contribution figures: ownership.webp, carriers.webp and export.webp.
node --import tsx tools/media/renderContributions.ts

# Recheck saved Core evidence against catalog payloads; pass the directory of saved Core report JSON files.
python3 tools/media/auditCatalog.py <core-report-dir>
```

### README and GitHub playback

The README links the repository MP4 and a standalone local player. Open `docs/media/showcase.html` directly to watch it before publishing. GitHub does not turn a repository-relative MP4 into an inline attachment player. GitHub video attachments are limited to 10 MB for repositories on a free plan, so upload a 1600×1000, 30 fps copy encoded in two passes to about 9.7 MB instead of the full-resolution file:

```sh
ffmpeg -y -i docs/media/showcase.mp4 -vf "fps=30,scale=1600:1000:flags=lanczos" -c:v libx264 -preset veryslow -tune animation -b:v 820k -pass 1 -passlogfile .cache/readme-media/x264 -an -f mp4 /dev/null
ffmpeg -y -i docs/media/showcase.mp4 -vf "fps=30,scale=1600:1000:flags=lanczos" -c:v libx264 -preset veryslow -tune animation -b:v 820k -pass 2 -passlogfile .cache/readme-media/x264 -pix_fmt yuv420p -movflags +faststart -an .cache/readme-media/showcase-github.mp4
```

Upload that copy through GitHub Issues and replace the attachment URL at the marked comment in the README; retain the repository link so the full-resolution video remains available. Nothing is uploaded automatically.

### Method panels — 5 October 2026

`method/pipeline-*.webp` contains the six panel images used by the README’s HTML table. Labels stay in HTML so they remain readable rather than shrinking inside one wide raster. `pipeline.webp` is the complete, high-resolution figure for enlargement. The four steps and panel captions match the independent project page.

Source illustration, layers, expression edits and verified landmarks are saved Purple Couture outputs. Composition uses the published rig’s browser preview; export uses the matching MOC3 rendered by official Cubism Core. The right half of that panel overlays actual deformed Core triangles, projected with the reference renderer’s MVP. Only rendered output is included; no SDK binaries are copied. Saved verification: 379 poses, 1 strict mismatch, 0 Core-aware mismatches. This figure capture is not a new validation sweep.

`method/provenance.json` records source and output hashes, exact control values, topology counts and validation values. Other README motion/media assets are unchanged.
