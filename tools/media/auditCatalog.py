"""Match saved Cubism validation evidence to the current catalog; no SDK rerun."""
import hashlib
import json
from pathlib import Path
import zipfile


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    root = Path(__file__).resolve().parents[2]
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
        matches = []
        for path in sorted(folder.glob("export-*/validation/validation.json")):
            report = json.loads(path.read_text())
            if report.get("sourceSha256") == hashes["character.inp"] and report.get("mocSha256") == moc_hash:
                matches.append((path, report))
        if not matches:
            raise ValueError(f"No matching saved Core validation: {entry['id']}")
        path, report = matches[-1]
        rows.append({
            "id": entry["id"], "artifactSha256": hashes,
            "mocSha256": moc_hash, "validationReportSha256": sha256(path.read_bytes()),
            "status": report["status"], "frames": report["frames"],
            "strictSourceMismatchCount": report["mismatchCount"],
            "coreAwareMismatchCount": report["coreSampling"]["mismatchCount"],
        })
    summary = {
        "scope": "Saved official Cubism Core reports matched to current INP and packaged MOC3 hashes. Catalog sizes and SHA-256 verified for both artifacts. This audit does not rerun Cubism Core or certify visual quality.",
        "catalogSha256": sha256((root / "example-avatars/catalog.json").read_bytes()),
        "avatars": len(rows),
        "coreAwareZeroMismatch": sum(r["coreAwareMismatchCount"] == 0 for r in rows),
        "strictSourceZeroMismatch": sum(r["strictSourceMismatchCount"] == 0 for r in rows),
        "coreSamplingEpsilonPhysicalUnits": .001, "entries": rows,
    }
    destination = root / "docs/media/catalog-validation.json"
    destination.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"{len(rows)} catalog pairs verified; {summary['coreAwareZeroMismatch']} Core-aware zero-mismatch reports; {summary['strictSourceZeroMismatch']} strict source zero-mismatch reports")


if __name__ == "__main__":
    main()
