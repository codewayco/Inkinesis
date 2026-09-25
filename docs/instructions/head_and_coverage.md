# Earlier head attachments and source-visible coverage

New pipeline runs enable `headAttachmentSafety` on both the visible-limb and experimental garment routes. The source meshes and native facial keyforms remain the reference for both routes. Native head/neck bindings are retained. The algorithm accepts meshes, source poses, canvas dimensions and inferred anatomy; it does not inspect character IDs, image filenames, hair colors or fixture-specific coordinates.

## Native part ownership

psd2live can emit uniquely named connected components such as `back hair#0:l` and `earwear#9:r`. Semantic classification removes the terminal split suffix; drawable IDs and full names stay unique throughout deformation and mask transfer. Previously the garment builder put these components in the static body group and the face adapter excluded them. Correcting the classification transfers their authored head channels, including the coupled yaw/pitch lattice and roll.

## Long hair attachment

The face mesh and inferred chin establish the head extent. A hair part extending more than half that head height below the chin is eligible for a body attachment field. Short hair retains its authored motion. For eligible parts, the full native head displacement is preserved above the chin. Below it, a smooth cubic weight decreases towards the lower hair extent. This is an attachment model, not simulated hair physics or a recovered 3D skeleton.

A fixed falloff band failed on the first real long-hair input: its extreme head poses inverted triangles. The implementation therefore searches input-relative band lengths from 0.4 to 1.6 times the below-chin hair extent, in steps of 0.05. It selects the shortest candidate passing the geometry constraints. The search grid and tolerances are common to every input, not fitted by character. If no attached field passes, the native field is retained only if it passes the same check; otherwise the build fails with an explicit diagnostic instead of exporting a known invalid mesh.

For each eligible hair mesh, all authored head-control cells are checked, including simultaneous yaw, pitch and roll. Within a cell, positions are bilinear in yaw/pitch plus a linear roll track. Each triangle's signed area is therefore at most quadratic in each control coordinate. Values at cell corners and midpoints are converted to tensor quadratic Bernstein coefficients. Their convex-hull bounds conservatively constrain the continuous cell, not just those sample points. Accepted bounds are a minimum signed-area ratio of 0.2 and maximum of 4; the sample prefilter also requires a minimum of 0.25. Rest triangles with doubled area below `height² × 1e-7` are excluded and explicitly reported. These bounds apply to the exported additive head tracks and retained linear interpolation, not arbitrary external modifiers, physics or facial-expression controls.

The report records each band's extent, retained tip response, attempts, sample counts and continuous area bounds. Root displacement is separately compared against the original source evaluator. This prevents an all-static hair patch from passing as a successful repair.

## Source-visible body recovery

The experimental garment route compares a rasterized rest-coverage union against the original image's inferred foreground mask below the face. Large connected omissions may be preserved as a source-pixel underlay, with a small overlap behind existing parts. This restores visible artwork lost by semantic decomposition; it neither draws hidden anatomy nor provides independently articulated joints. The underlay can follow supported body sway/breath, but has no independent limb or cloth track.

The foreground mask is not ground truth. Opaque images can include enclosed backdrop holes and cast shadows. For inferred masks, recovery requires chromatic evidence relative to the source border color; ambiguous neutral-color regions are reported and left unrecovered. Genuine source alpha bypasses this ambiguity filter. The current conservative thresholds are a component area of 0.25% of the canvas, at least 25% chromatically distinct pixels, and channel-difference contrast greater than 18/255. Small omissions, grayscale artwork and nonuniform backgrounds remain review cases. In particular, “no large confident omission” is not a claim of complete anatomical reconstruction.

## Validation and claim boundaries

- Regression fixtures cover both native split identities, missing body regions, ambiguous background, short hair preservation and rejection of an unsafe root field.
- Eighteen synthetic attachment cases vary scale, hair length and horizontal reflection. Polynomial tests include an interior failure invisible at sampled corners and midpoint.
- Three real garment characters are rebuilt with isolated roll, opposite simultaneous yaw/pitch/roll limits, expressions and garment/body controls. Native/browser and official Cubism Core checks use the exact exported files.
- New standard runs use the same hair-only attachment rule on both routes. Face and neck motion is not replaced.

The geometric certificate does not prove perceptual quality, texture continuity, layer ordering, collision freedom or valid artwork behind hair. A shoulder absent from every source layer cannot be recovered from a motion constraint. Those are separate decomposition/completion and visual acceptance problems. These tests support a bounded attachment and recovery mechanism, not a universal long-hair success claim. Generalization to a representative held-out dataset and a blinded visual evaluation are still needed before making a broader paper claim.

