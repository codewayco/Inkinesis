#!/usr/bin/env python3
"""Evaluate a prepared PSD through our direct adapter to pristine psd2live."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

PIN = '5526f2e16b57e5f83d34f33730d6fa26d8bc8695'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for flag in ['engine', 'java-home', 'psd', 'output']:
        p.add_argument('--' + flag, type=Path, required=True)
    a = p.parse_args()
    engine, out = a.engine.resolve(), a.output.resolve()
    if subprocess.check_output(['git', '-C', str(engine), 'rev-parse', 'HEAD'], text=True).strip() != PIN:
        raise ValueError('Wrong psd2live revision')
    if subprocess.check_output(['git', '-C', str(engine), 'diff', 'HEAD', '--', 'src', 'build.gradle.kts'], text=True).strip():
        raise ValueError('Direct adapter requires unmodified engine sources')
    out.mkdir(parents=True, exist_ok=True)
    adapter = Path(__file__).resolve().parent
    env = dict(os.environ, JAVA_HOME=str(a.java_home.resolve()))
    env['PATH'] = str(a.java_home.resolve() / 'bin') + os.pathsep + env.get('PATH', '')
    started = time.monotonic()
    command = ['bash', './gradlew', '--offline', '--no-daemon', '--console=plain',
               '-Pkotlin.incremental=false', '--init-script', str(adapter / 'direct.gradle'),
               'evaluateDirectBust', '-PdirectAdapterDir=' + str(adapter),
               '-PpreparedPsd=' + str(a.psd.resolve()), '-PposeOutput=' + str(out / 'model/poses.json')]
    with (out / 'build.log').open('w') as log:
        result = subprocess.run(command, cwd=engine, env=env, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'Direct bust evaluation failed: {out / "build.log"}')
    record = {'engineRevision': PIN, 'engineModified': False, 'adapter': 'DirectBust.kt',
              'adapterSha256': {name: hashlib.sha256((adapter / name).read_bytes()).hexdigest()
                                for name in ['DirectBust.kt', 'PoseDump.kt', 'direct.gradle']},
              'sourceSha256': hashlib.sha256(a.psd.read_bytes()).hexdigest(),
              'seconds': time.monotonic() - started, 'physicsSimulated': False}
    (out / 'provenance.json').write_text(json.dumps(record, indent=2) + '\n')


if __name__ == '__main__':
    main()
