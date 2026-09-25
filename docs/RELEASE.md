# Publication scope

This distribution includes the active player, pipeline, rendering/rigging code, optional quality hooks, external-component adapters, tests, English setup documentation, and metadata/small previews for 27 curated example avatars. The large avatar files are installed on demand from a separately published GitHub Release.

It excludes the research paper, trial prompts, experiment directories, recordings, private reports, deprecated motor, model weights, proprietary SDKs, credentials, generated user jobs, and historical dataset-specific batch/publishing scripts. The original development workspace remains intact.

The publication repository starts with one filtered historical commit containing only the original Apache license. Its author and date are retained from September 14, 2026; its hash differs because all other historical files have been excluded. Current implementation and example files are intentionally left uncommitted for the maintainer. There is no remote and no push has been performed.

Do not stage example binaries. INP and ZIP files are ignored and distributed as Release attachments; Git LFS is not used. Dependency caches, `.env`, generated jobs, and research directories are ignored. Keep real API keys and personal server paths out of committed configuration.

## Validation boundaries

Portable unit tests and UI tests use synthetic fixtures without paid model calls. The real prepared examples can be checked through the picker and both download formats. GPU inference, external API access, and JupyterHub allocation require each user's environment; a portable source release is not proof that every GPU or model account can execute the full pipeline.
