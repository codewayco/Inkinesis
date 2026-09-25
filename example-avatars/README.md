# Example avatars

The catalog lists 27 previously prepared avatars. Neutral-pose WebP previews, labels, filenames, sizes and SHA-256 hashes are tracked in Git. IDs 01–07 identify the original seven in UI order; the remaining IDs retain their existing numbers.

Large `.inp` and `.zip` files are deliberately ignored, even after downloading. They belong in `example-avatars/<id>/` locally. There is no Git LFS requirement. Select an avatar in the UI and press **Download** to install both verified files, then animate it immediately. Installed avatars remain available after restarting the server.

A publisher must upload the prepared release attachments and configure the release URL before downloads can work in a new checkout. Existing local files work without that URL. See [distribution instructions](../docs/instructions/avatar_library.md) and [asset licensing](../LICENSE-ASSETS.md).
