# Version 1.0 publication

The source distribution includes the player, generation pipeline, rendering and rigging code, optional quality hooks, external-component adapters, tests, setup documentation, README media, and metadata/small previews for the **30** example avatars, selected from the 94 characters evaluated in the paper. The README gallery and showcase video still show all 94.

Large avatar payloads are separate GitHub Release attachments. Model weights, proprietary SDKs, credentials, generated user jobs, local export workspaces, and research/experiment directories stay outside Git. INP/ZIP files and avatar `export-*` folders are ignored; Git LFS is not used. Local research files are retained on disk.

## Publish the matching assets

1. Run `npm run prepare:avatar-release` with all current avatars installed. It verifies their sizes and SHA-256 hashes, then replaces the generated `.cache/avatar-release/` directory with exactly **60 attachments plus `SHA256SUMS`**. A failed verification preserves the previous prepared release.
2. Review and commit/push the source changes. Include the new source/test files and the 30 current previews; exclude ignored payloads, `.env`, caches and research data.
3. Create the GitHub Release **`v1.0.0` in `codewayco/Inkinesis`** and attach the 60 files plus `SHA256SUMS` to it. The code and the avatar payloads share this one release; `example-avatars/catalog.json` is pinned to `https://github.com/codewayco/Inkinesis/releases/download/v1.0.0`. Earlier versions used separate `avatars-v1` and `avatars-v2` tags.
4. Test Download in a fresh checkout after the release is public. Before publication, local installed avatars work but new downloads cannot succeed.
5. For inline README playback, upload the 1280×800 copy described in [README media](media/README.md#readme-and-github-playback) through GitHub Issues and replace the attachment URL at the README comment. Keep the repository video and local player links.

Release preparation does not create commits, tags, pushes, releases or uploads.

## Validation boundaries

See [the release validation record](VALIDATION.md) for the checked source, installation, browser, archive and dependency paths. Portable tests use synthetic fixtures without paid model calls. Real prepared examples are checked through the picker and both download formats. Saved Cubism validation evidence is matched to the current binaries separately from visual quality.

GPU inference and external API access require each user's environment. The optional `reference:check` requires the separately installed Cubism SDK; it is not a portable-checkout prerequisite. A successful portable source audit does not certify every GPU, account or character design.
