# README media

The gallery and browser motion frames are rendered from existing example avatars, using the Inkinesis browser renderer. The two figure images come from the technical report and reuse the same saved renders. No new character images were generated for the README.

| File | Content |
| --- | --- |
| `showcase.mp4` | All 27 catalog rigs in a synchronized, right-to-left scrolling showcase: neutral above, animated below. 1440×1000, 24 fps, H.264, 81 seconds, no audio. One character-width of travel every three seconds. |
| `showcase-poster.png` | First frame of the two-row showcase, matching the inline video composition. |
| `showcase-provenance.json` | Source rig and renderer hashes, motion recipe, per-character presentation scales, reviewed sample times, output hashes and encoding settings. |
| `stages.webp` | Top row of the technical report's teaser figure: Purple Couture's source illustration beside renders of the generated rig with arms, legs, both combined, and a closed-eye open-mouth expression. Rasterized from the figure PDF; panels are the same saved runtime renders used in the report. |
| `pipeline.webp` | The report's pipeline figure: source, See-through layers, registered expressions, VLM joints, composed rig, and the Live2D export, labelled by reused, ours, and verification. Rasterized from the figure PDF. |
| `gallery.webp` | All 27 example rigs freshly rendered in neutral poses on a pure black background and composed into one labelled grid. No UI or preview-footer pixels are included. |
| `characters.webp` | Neutral renders of `04-purple-couture`, `06-ultramarine-tempo`, `07-saffron-orbit`, `12-desert-ranger`, `09-neon-skater`, and `08-lichen-starweaver`. |
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

The showcase evaluates the same meshes, textures and exposed controls as the UI. The top row remains in the neutral pose; the corresponding animated rigs below follow the same horizontal positions. The two rows scroll continuously from right to left, advancing one character-width every three seconds.

Limb trajectories reach the exported outward shoulder/hip and inward elbow endpoints and the maximum knee flexion, without exceeding the authored ranges. Arm, hip and knee phases are offset. Fixed capabilities stay fixed; limited ranges are read directly from the exported rig. Garment-only rigs use their garment controls. Head targets are yaw ±30°, pitch ±10° and roll ±15°, clamped to each rig.

After inspecting full-range poses, video-only motion amplitude was reduced to 70% for Ultramarine Tempo, Saffron Orbit, Neon Skater, Coral Diver, Tangerine Chef and Lemon Scientist because of visible sleeve/shoulder texture pulling. This does not repair or alter the rigs. All other rigs retain the full limb demonstration range. The provenance file records these presentation choices. No frame synthesis, new character generation or source rig edits are applied.

The README embeds a local HTML video with controls and a poster. For inline playback on GitHub itself, upload the MP4 through GitHub's attachment interface and replace the video's local `src` with the resulting attachment URL. The local file remains the source artifact; a repository-relative MP4 URL alone is not a GitHub inline-video upload. Nothing has been uploaded automatically.
