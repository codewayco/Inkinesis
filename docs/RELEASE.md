# Release 2 publication

The source distribution includes the player, generation pipeline, rendering and rigging code, optional quality hooks, external-component adapters, tests, setup documentation, README media, and metadata/small previews for **53** example avatars.

Large avatar payloads are separate GitHub Release attachments. Model weights, proprietary SDKs, credentials, generated user jobs, local export workspaces, and research/experiment directories stay outside Git. INP/ZIP files and avatar `export-*` folders are ignored; Git LFS is not used. Local research files are retained on disk.

## Publish the matching assets

1. Run `npm run prepare:avatar-release` with all current avatars installed. It verifies their sizes and SHA-256 hashes, then replaces the generated `.cache/avatar-release/` directory with exactly **106 attachments plus `SHA256SUMS`**. A failed verification preserves the previous prepared release.
2. Review and commit/push the source changes. Include the new source/test files and 53 current previews; exclude ignored payloads, `.env`, caches and research data.
3. Publish the attachments under **`avatars-v2` in `codewayco/Inkinesis`**. This is the exact URL pinned in `example-avatars/catalog.json`. If the code release uses another tag, the avatar release still needs this tag, or the catalog must be changed to match.
4. Test Download in a fresh checkout after the release is public. Before publication, local installed avatars work but new downloads cannot succeed. The configured release returned HTTP 404 during the October 4 pre-release check.
5. For inline README playback, upload `docs/media/showcase.mp4` through GitHub Issues and insert the resulting attachment URL at the README comment. Keep the repository video and local player links.

Release preparation does not create commits, tags, pushes, releases or uploads. The October 4 audit left the index empty and performed none of those actions.

## Validation boundaries

See [the release validation record](VALIDATION.md) for the checked source, installation, browser, archive and dependency paths. Portable tests use synthetic fixtures without paid model calls. Real prepared examples are checked through the picker and both download formats. Saved Cubism validation evidence is matched to the current binaries separately from visual quality.

GPU inference and external API access require each user's environment. The optional `reference:check` requires the separately installed Cubism SDK; it is not a portable-checkout prerequisite. A successful portable source audit does not certify every GPU, account or character design.
