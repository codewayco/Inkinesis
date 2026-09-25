#!/usr/bin/env python3
"""Download directly from See-through's model publishers at locked revisions."""
import argparse
import hashlib
import json
from pathlib import Path
from huggingface_hub import snapshot_download

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,default=Path('.cache/rig/models'))
a=p.parse_args()
weights=json.loads((Path(__file__).parent/'models/see-through.json').read_text())
for model in ['layer','depth']:
    items=[w for w in weights if w['model']==model]
    snapshot_download(items[0]['repo'],revision=items[0]['revision'],local_dir=str(a.output/model),
                      allow_patterns=[w['path'] for w in items],max_workers=4)
    for w in items:
        path=a.output/model/w['path']
        with path.open('rb') as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
        if path.stat().st_size!=w['size'] or actual!=w['sha256']:
            raise RuntimeError('Weight integrity failed: '+str(path))
    print(model+' verified',flush=True)
