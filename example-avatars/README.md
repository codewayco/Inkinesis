# Example avatars

The catalog lists the 30 example avatars that ship with the viewer, selected from the 94 characters evaluated in the paper. It includes the characters that appear in the main paper's figures, except four (two whose legs are fixed by their drawing and two whose clothing pulls apart at the limb extremes), most characters featured in this README and on the project website, and evaluated characters that stayed intact at the extremes of every limb range. They are numbered 01–30 in UI order, with the paper's teaser characters first; Teal Drummer (05) takes the place of the teaser's Aurora Axolotl Beaconer.

The README gallery and showcase video still show all 94 evaluated characters. The other 64 rigs (numbered 31–94) are not distributed with the repository.

Neutral-pose WebP previews, labels, filenames, sizes and SHA-256 hashes are tracked in Git. Large `.inp` and `.zip` files are deliberately ignored, even after downloading. They belong in `example-avatars/<id>/` locally. There is no Git LFS requirement. Select an avatar in the UI and press **Download** to install both verified files, then animate it immediately. Installed avatars remain available after restarting the server.

A publisher must upload the prepared release attachments and configure the release URL before downloads can work in a new checkout. Existing local files work without that URL. See [distribution instructions](../docs/instructions/avatar_library.md) and [asset licensing](../LICENSE-ASSETS.md).
