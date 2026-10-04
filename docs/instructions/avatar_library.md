# Downloadable example avatars

## User flow

Start `npm run dev`, expand **Pick an Avatar**, select an example and press **Download**. Selection alone does not download missing files. The button displays **Downloading…** and byte progress, followed by **Downloaded** once both files have passed size and SHA-256 validation. The selected rig then opens in the player. Its ordinary Inochi/Live2D links can also save copies using the browser's download dialog.

The local Node service installs `character.inp` and `Live2D.zip` into `example-avatars/<id>/`. These files are ignored by Git. Restarting the server rechecks and reuses installed files; there is no repeated download. Generation dependencies, model keys and a GPU are unnecessary for examples. A static-only deployment cannot write into a local checkout and therefore requires `npm run dev` for this feature.

Failed, truncated or corrupt transfers are removed without replacing existing files. **Retry download** starts a new attempt. At most two downloads run concurrently, with a ten-minute timeout per attempt. Both artifacts are verified before the avatar directory is replaced. The service refuses linked directories and replacement of directories containing unrelated files. It downloads the INP and existing ZIP directly; it never extracts arbitrary archives.

## Publication layout

Git includes `catalog.json`, `checksums.json`, `previews/*.webp`, code and documentation. Git excludes INP/ZIP payloads, local `export-*` workspaces and `.downloads/` temporary directories. Do not enable Git LFS for these assets. The Vite build emits metadata and small previews only, even if payloads are installed locally.

The public catalog contains each avatar's label, stable ID, preview path, local paths and two artifact descriptors (`file`, unique release `asset` name, exact `bytes`, `sha256`). The checksum list provides the same hashes by local path. Download sources are pinned to a versioned release, not a mutable `latest` URL.

## Prepare attachments locally (no upload)

With all 53 existing avatars installed and verified:

```sh
npm run prepare:avatar-release
```

This verifies all files against the catalog and prepares 106 uniquely named attachments, plus `SHA256SUMS`, in ignored `.cache/avatar-release/`. It replaces the previous generated attachment directory only after all files verify, so removed or renamed avatars cannot leak into a new release. Each avatar has `<id>.inp` and `<id>-live2d.zip`. Separate attachments avoid nested archive extraction. The command does not commit, push, create tags or upload anything.

## Publish later

1. Commit/push the code, metadata and previews only when ready. Confirm `git diff --cached --name-only` contains no INP or ZIP payloads.
2. Publish the prepared files from `.cache/avatar-release/` (including `SHA256SUMS`) on the **`avatars-v2`** GitHub Release in **`codewayco/Inkinesis`**. The catalog is already pinned to that exact repository and tag. A differently named code release does not satisfy the download URL.
3. If using a different repository or tag, update `release.baseUrl` in `example-avatars/catalog.json` and ship that metadata with the matching attachments. Until the configured release is public, a fresh checkout can show previews but cannot download these avatars.
4. Test a clean checkout without local payloads. It should show previews immediately and install the selected avatar only after **Download** is pressed.

For local testing of an already published release, set `INKINESIS_AVATAR_RELEASE_URL` in `.env` and restart Vite. The override accepts only HTTPS GitHub versioned-release URLs, without credentials, queries or fragments. Private authenticated releases are not supported by this public downloader. An absent URL is reported explicitly; no guessed URL is requested.

To update assets, create a new versioned release, regenerate catalog sizes/hashes and small previews, and update the URL together. Never overwrite a published attachment with different bytes while retaining an old hash.

## Verification

`npm run verify:example-download` runs a local synthetic browser test with corrupt-transfer/retry coverage and no GitHub calls. `npm run verify:examples` checks all 53 actual installed avatars against a running dev server; install them first. Unit tests cover integrity, path checks, missing publication configuration, truncated/oversized files, and reuse after restart.
