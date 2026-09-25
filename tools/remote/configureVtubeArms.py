"""Add bounded hand-position controls to an existing VTube Studio model profile.

Run with VTube Studio closed. This is a gesture mapping, not skeletal tracking
or inverse kinematics. Requires the Inkinesis shoulder/elbow parameter IDs.
The original profile is backed up; face mappings and all other settings remain.
"""
import argparse
import copy
import json
from pathlib import Path


def configure(profile, parameter_ids):
    mappings = [
        ("Left shoulder", "HandLeftPositionX", "ParamShoulderL", 24, -24),
        ("Right shoulder", "HandRightPositionX", "ParamShoulderR", -24, 24),
        ("Left elbow", "HandLeftPositionY", "ParamElbowL", 50, -50),
        ("Right elbow", "HandRightPositionY", "ParamElbowR", -50, 50),
    ]
    outputs = {row[2] for row in mappings}
    if not outputs.issubset(parameter_ids):
        raise ValueError("Model is missing required shoulder/elbow parameters")
    result = copy.deepcopy(profile)
    result["ParameterSettings"] = [p for p in result.get("ParameterSettings", [])
                                   if p.get("OutputLive2D") not in outputs]
    for name, source, target, low, high in mappings:
        result["ParameterSettings"].append({
            "Folder": "", "Name": "Hand tracking: " + name,
            "Input": source, "InputRangeLower": -10.0, "InputRangeUpper": 10.0,
            "OutputRangeLower": float(low), "OutputRangeUpper": float(high),
            "ClampInput": True, "ClampOutput": True,
            "UseBlinking": False, "UseBreathing": False,
            "OutputLive2D": target, "Smoothing": 20, "Minimized": True,
        })
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path)
    args = parser.parse_args()
    path = args.profile
    profile = json.loads(path.read_text())
    model_path = path.parent / profile["FileReferences"]["Model"]
    model = json.loads(model_path.read_text())
    cdi = json.loads((path.parent / model["FileReferences"]["DisplayInfo"]).read_text())
    updated = configure(profile, {p["Id"] for p in cdi["Parameters"]})
    backup = path.with_suffix(path.suffix + ".before-hand-controls.bak")
    if not backup.exists():
        backup.write_bytes(path.read_bytes())
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(updated, indent=2) + "\n")
    temporary.replace(path)
    print("Added four bounded arm mappings; original profile backup preserved.")
