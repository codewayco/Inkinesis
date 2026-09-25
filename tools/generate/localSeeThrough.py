#!/usr/bin/env python3
"""Run the pinned See-through weights locally; never substitutes a model.

The upstream source stays outside this repository. A temporary source copy gets
only explicit device/scheduler compatibility changes, recorded with the output.
"""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

PIN = '7f139bb25c46a0c8ac720d95ddab185fcda5451c'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-checkout', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--device', choices=['mps', 'cuda'], default='mps')
    parser.add_argument('--export-only', action='store_true', help='Re-export existing layer/depth maps without repeating inference')
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    if subprocess.check_output(['git', '-C', str(args.source_checkout), 'rev-parse', 'HEAD'], text=True).strip() != PIN:
        raise ValueError('See-through checkout does not match the recorded source pin')
    record = {
        'status': 'preparing', 'model': 'See-through', 'sourceRevision': PIN,
        'inputSha256': digest(args.input), 'manifestSha256': digest(args.manifest),
        'device': args.device, 'dtype': 'bfloat16', 'seed': 42,
        'resolution': 1280, 'steps': 30, 'tblrSplit': True,
        'weights': [], 'patches': [],
        'licenceOpenItem': 'Commercial rights to See-through depth weights are unresolved.',
        'whatThisDoesNotMeasure': 'Bitwise CUDA/MPS equivalence, rig quality or human acceptance.'}
    record_path = args.output / 'local-decomposition.json'
    if record_path.exists():
        previous = json.loads(record_path.read_text())
        if args.export_only and (previous.get('status') != 'complete' or previous.get('inputSha256') != record['inputSha256']):
            raise ValueError('PSD-only re-export requires a successful run on this exact input')
        attempt = len(list(args.output.glob('local-decomposition-attempt-*.json')))
        shutil.copy2(record_path, args.output / f'local-decomposition-attempt-{attempt}.json')
        record['previousAttempt'] = f'local-decomposition-attempt-{attempt}.json'
    elif args.export_only:
        raise ValueError('No successful inference to re-export')
    record['elapsedSecondsScope'] = 'PSD re-export only' if args.export_only else 'weight verification, loading, inference and PSD export'
    record['dependencies'] = {name: importlib.metadata.version(name) for name in ['torch','diffusers','transformers','numpy','psd-tools']}

    def save():
        record_path.write_text(json.dumps(record, indent=2) + '\n')

    started = time.monotonic()
    save()
    try:
        for item in json.loads(args.manifest.read_text()):
            path = args.models / item['model'] / item['path']
            if path.stat().st_size != item['size']:
                raise ValueError(f'Model size mismatch: {path}')
            actual = digest(path)
            if item.get('sha256') and item['sha256'] != actual:
                raise ValueError(f'Model SHA256 mismatch: {path}')
            if not item.get('sha256') and item.get('git_oid'):
                contents = path.read_bytes()
                oid = hashlib.sha1(f'blob {len(contents)}\0'.encode() + contents).hexdigest()
                if oid != item['git_oid']:
                    raise ValueError(f'Model git blob mismatch: {path}')
            record['weights'].append({**item, 'verifiedSha256': actual})
        save()
        print('Pinned See-through weights verified', flush=True)
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
        import torch
        if args.device == 'mps' and not torch.backends.mps.is_available():
            raise RuntimeError('MPS is unavailable; run with local GPU access enabled')
        if args.device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA is unavailable')
        # Fail early if the device cannot execute the original weight precision.
        torch.ones(1, device=args.device, dtype=torch.bfloat16).add_(1).cpu()
        with tempfile.TemporaryDirectory(prefix='character-seethrough-') as directory:
            checkout = Path(directory)
            # git archive guarantees pristine pinned source, regardless of local edits.
            archive = subprocess.check_output(['git', '-C', str(args.source_checkout), 'archive', PIN])
            subprocess.run(['tar', '-x', '-C', str(checkout)], input=archive, check=True)
            path = checkout / 'common/utils/inference_utils.py'
            original = path.read_text()
            patched = original
            replacements = [
                ('            scheduler=None\n', "            scheduler=DPMSolverMultistepScheduler.from_pretrained(pretrained, subfolder='scheduler')\n")]
            if args.device == 'mps':
                replacements.extend([
                    ("device='cuda'", "device='mps'"),
                    ('torch.Generator(device=pipeline.unet.device)', "torch.Generator(device='cpu')")])
            for old, new in replacements:
                count = patched.count(old)
                if not count:
                    raise ValueError(f'Compatibility patch no longer matches: {old}')
                patched = patched.replace(old, new)
                record['patches'].append({'from': old, 'to': new, 'occurrences': count})
            patched = 'from diffusers import DPMSolverMultistepScheduler\n' + patched
            path.write_text(patched)
            record['patchedInferenceSha256'] = digest(path)
            sys.path[:0] = [str(checkout / 'common'), str(checkout / 'annotators')]
            from utils import inference_utils as inference
            work = args.output / 'local-work'
            record['status'] = 'layer-inference'; save()
            if not args.export_only:
                inference.apply_layerdiff(str(args.input), str(args.models / 'layer'),
                                          seed=42, resolution=1280, num_inference_steps=30,
                                          save_dir=str(work), group_offload=False)
            # Release layer weights before loading the original depth model.
            inference.layerdiff_pipeline = None
            gc.collect()
            if args.device == 'mps': torch.mps.empty_cache()
            else: torch.cuda.empty_cache()
            record['status'] = 'depth-inference'; save()
            if not args.export_only:
                inference.apply_marigold(str(args.input), str(args.models / 'depth'),
                                        seed=42, save_dir=str(work), group_offload=False)
            record['status'] = 'psd-export'; save()
            # Match upstream inference_psd.py, not further_extr's training-data default.
            inference.further_extr(str(work / args.input.stem), rotate=False, save_to_psd=True, tblr_split=True)
            record['rotate'] = False
            produced = work / (args.input.stem + '.psd')
            target = args.output / 'decomposition.psd'
            shutil.copyfile(produced, target)
            record.update(status='complete', outputSha256=digest(target))
    except Exception as error:
        record.update(status='failed', errorType=type(error).__name__, error=str(error))
        raise
    finally:
        record['elapsedSeconds'] = time.monotonic() - started
        save()


if __name__ == '__main__':
    main()
