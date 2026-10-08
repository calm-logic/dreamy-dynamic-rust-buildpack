#!/usr/bin/env python3
"""Resolve the public core libraries at the revisions in foundation.lock.json."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPOSITORIES = {
    'dynamic-rust': 'https://github.com/aleontiev/dynamic-rust.git',
    'dynamic-rust-admin': 'https://github.com/aleontiev/dynamic-rust-admin.git',
}

def read_lock(root):
    lock = json.loads((Path(root) / 'foundation.lock.json').read_text())
    if lock.get('version') != 1 or set(lock.get('libraries', {})) != set(REPOSITORIES):
        raise ValueError('Unsupported foundation lock file')
    for name, repository in REPOSITORIES.items():
        entry = lock['libraries'][name]
        if entry.get('repository') != repository or not re.fullmatch(r'[0-9a-f]{40}', entry.get('revision', '')):
            raise ValueError('Core libraries must use their official repositories and full commit revisions')
    return lock


def checkout(root, name):
    root = Path(root)
    entry = read_lock(root)['libraries'][name]
    cache = root / '.foundation'
    destination = cache / (name + '-' + entry['revision'])
    def git(*args, cwd=destination):
        return subprocess.check_output(['git', *args], cwd=cwd, text=True, env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'}).strip()
    if not destination.exists():
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=name + '-', dir=cache) as temp:
            source = Path(temp) / 'source'
            git('clone', '--no-checkout', entry['repository'], str(source), cwd=root)
            git('checkout', '--detach', entry['revision'], cwd=source)
            try:
                source.rename(destination)
            except FileExistsError:
                pass  # Another preparation process finished the same revision.
    if (git('rev-parse', 'HEAD') != entry['revision']
            or git('config', '--get', 'remote.origin.url') != entry['repository']
            or git('status', '--porcelain', '--untracked-files=all', '--ignored')):
        raise ValueError(f'Foundation checkout was modified: {destination}. Move it aside before rebuilding.')
    return destination


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('library', choices=REPOSITORIES)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(checkout(args.root, args.library))
