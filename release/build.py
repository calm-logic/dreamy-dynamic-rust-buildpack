#!/usr/bin/env python3
"""Build a dynamic-rust project for release, in Dreamy's isolated builder.

`setup` runs once per builder, as root, and installs the toolchain: the musl C
compiler, Rust with the static musl target, and yarn.

`build` runs in the committed source, unprivileged and without credentials.
Dreamy's environment for it:
- DREAMY_OUTPUT: an empty directory for what the build produces;
- DREAMY_CACHE: a directory kept between this project's builds;
- DREAM_TEST_DATABASE_URL: a throwaway PostgreSQL server for the tests.

It runs the project's tests, then writes the two things Dreamy deploys:
- `server`: the app's static linux/x86_64 executable;
- `static/`: the built admin UI.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

RUSTUP_HOME = '/opt/dream-rustup'
CARGO_HOME = '/opt/dream-cargo'
TOOLCHAIN = '1.88.0'
TARGET = 'x86_64-unknown-linux-musl'


def setup():
    subprocess.run(['apt-get', 'update', '-qq'], check=True)
    subprocess.run(['apt-get', 'install', '-y', '-qq', 'musl-tools', 'pkg-config', 'libssl-dev'], check=True)
    env = dict(os.environ, RUSTUP_HOME=RUSTUP_HOME, CARGO_HOME=CARGO_HOME)
    installer = Path('/tmp/dream-rustup.sh')
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--proto', '=https', '--tlsv1.2', 'https://sh.rustup.rs', '-o', str(installer)], check=True)
    subprocess.run(['sh', str(installer), '-y', '--profile', 'minimal', '--default-toolchain', TOOLCHAIN, '--target', TARGET, '--no-modify-path'], check=True, env=env)
    if not shutil.which('yarn'):
        subprocess.run(['npm', 'install', '--global', 'yarn@1.22.22'], check=True)


def run(command, cwd, env):
    """One step of the build; its failure fails the build with the step's name."""
    if subprocess.run(command, cwd=cwd, env=env, timeout=2400).returncode:
        raise SystemExit('Application check failed: ' + ' '.join(command[:2]))


def build():
    source = Path.cwd()
    output = Path(os.environ['DREAMY_OUTPUT'])
    cache = Path(os.environ['DREAMY_CACHE'])
    lock = json.loads((source / 'foundation.lock.json').read_text()) if (source / 'foundation.lock.json').is_file() else {}
    if lock.get('runtime_contract') != 1:
        raise SystemExit('Refresh the project to the current buildpack before releasing it.')
    if not (source / 'backend/src/main.rs').is_file():
        raise SystemExit('The project has no executable application host (backend/src/main.rs).')
    linker = shutil.which('musl-gcc') or '/usr/bin/musl-gcc'
    target = cache / 'target'
    env = dict(os.environ, RUSTUP_HOME=RUSTUP_HOME, CARGO_HOME=str(cache / 'cargo'), CARGO_TARGET_DIR=str(target),
               PATH=CARGO_HOME + '/bin:' + os.environ.get('PATH', ''), CARGO_NET_GIT_FETCH_WITH_CLI='true',
               CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=linker, CC_x86_64_unknown_linux_musl=linker)
    run(['cargo', 'test', '--manifest-path', 'backend/Cargo.toml', '--', '--include-ignored'], source, env)
    run(['cargo', 'rustc', '--locked', '--manifest-path', 'backend/Cargo.toml', '--release', '--target', TARGET, '--bin', 'app',
         '--', '-C', 'target-feature=+crt-static', '-C', 'relocation-model=static', '-C', 'link-arg=-static', '-C', 'link-arg=-no-pie'],
        source, env)
    shutil.copyfile(target / TARGET / 'release/app', output / 'server')
    run(['python3', 'frontend/scripts/prepare.py'], source, env)
    admin = source / 'frontend/.work/admin'
    run(['yarn', 'install', '--frozen-lockfile', '--non-interactive'], admin, env)
    run([os.environ.get('DREAM_NODE', 'node'), 'node_modules/@quasar/app/bin/quasar', 'build'], admin, env)
    shutil.copytree(admin / 'dist/spa', output / 'static')


if __name__ == '__main__':
    {'setup': setup, 'build': build}.get(sys.argv[1] if len(sys.argv) == 2 else '', lambda: sys.exit('Expected setup or build'))()
