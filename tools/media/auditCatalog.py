"""Match saved official Cubism Core reports to the shipped example catalog; no SDK rerun.

Usage: python3 tools/media/auditCatalog.py <directory of saved Core report JSON files>

Each shipped Live2D package is matched to a report by the SHA-256 of its MOC3 model,
so report file names and evaluation IDs do not need to agree with catalog IDs.
"""
import hashlib
import json
import sys
from pathlib import Path
import zipfile

TOLERANCE_PX = 0.005


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(__file__).resolve().parents[2]
    reports = {}
    for path in sorted(Path(sys.argv[1]).glob("*.json")):
        report = json.loads(path.read_text())
        if "mocSha256" in report:
            reports[report["mocSha256"]] = (path, report)
    catalog = json.loads((root / "example-avatars/catalog.json").read_text())
    rows = []
    for entry in catalog["entries"]:
        folder = root / "example-avatars" / entry["id"]
        hashes = {}
        for artifact in entry["artifacts"]:
            data = (folder / artifact["file"]).read_bytes()
            digest = sha256(data)
            if len(data) != artifact["bytes"] or digest != artifact["sha256"]:
                raise ValueError(f"Catalog artifact mismatch: {entry['id']}/{artifact['file']}")
            hashes[artifact["file"]] = digest
        with zipfile.ZipFile(folder / "Live2D.zip") as archive:
            models = [n for n in archive.namelist() if n.endswith(".moc3")]
            if len(models) != 1:
                raise ValueError(f"Expected one model: {entry['id']}")
            moc_hash = sha256(archive.read(models[0]))
        if moc_hash not in reports:
            raise ValueError(f"No saved Core report for the packaged model: {entry['id']}")
        path, report = reports[moc_hash]
        if not report.get("loaded") or not report.get("comparable"):
            raise ValueError(f"Saved Core report did not load or compare: {entry['id']}")
        rows.append({
            "id": entry["id"], "artifactSha256": hashes, "mocSha256": moc_hash,
            "reportSha256": sha256(path.read_bytes()), "poses": len(report["frames"]),
            "maxFrameErrorPx": report["maxFrameMaxPx"],
        })
    summary = {
        "scope": "Saved official Cubism Core reports matched by MOC3 hash to the packaged example models. Catalog sizes and SHA-256 verified for both artifacts. This audit does not rerun Cubism Core or certify visual quality.",
        "catalogSha256": sha256((root / "example-avatars/catalog.json").read_bytes()),
        "avatars": len(rows),
        "toleranceMaxPx": TOLERANCE_PX,
        "withinTolerance": sum(r["maxFrameErrorPx"] <= TOLERANCE_PX for r in rows),
        "worstFrameErrorPx": max(r["maxFrameErrorPx"] for r in rows),
        "entries": rows,
    }
    destination = root / "docs/media/catalog-validation.json"
    destination.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"{len(rows)} catalog pairs verified; {summary['withinTolerance']} within {TOLERANCE_PX} px; worst {summary['worstFrameErrorPx']:.3g} px")


if __name__ == "__main__":
    main()
