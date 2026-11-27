#!/usr/bin/env python3
"""Build a deterministic, limited public companion archive from the checkout."""
import gzip
import pathlib
import sys
import tarfile

root = pathlib.Path(__file__).resolve().parent.parent
if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/build-companion.py OUTPUT.tar.gz")
output = pathlib.Path(sys.argv[1])
files = [(root / 'distribution/companion' / name, name) for name in ('README.md', 'package.json', 'package-lock.json')]
files += [(path, str(path.relative_to(root))) for path in sorted((root / 'adapter').glob('*.ts'))]
files += [(root / 'src' / (name + '.ts'), 'src/' + name + '.ts') for name in ('auth', 'crypto', 'direct', 'group-protocol', 'protocol', 'validation')]
with output.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz, tarfile.open(fileobj=gz, mode='w') as tar:
    for path, name in files:
        info = tar.gettarinfo(str(path), arcname=name)
        info.uid = info.gid = info.mtime = 0
        info.uname = info.gname = ''
        with path.open('rb') as source:
            tar.addfile(info, source)
