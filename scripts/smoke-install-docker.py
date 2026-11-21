"""Real Docker smoke for the installed launcher; all study data is temporary."""
import json
import os
from pathlib import Path
import pty
import select
import signal
import socket
import subprocess
import tempfile
import termios
import time
import urllib.request

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='recall-install-') as tmp:
    tmp = Path(tmp)
    bindir = tmp / 'bin with spaces'
    project = tmp / 'study with spaces'
    project.mkdir()
    installer = ['bash', '-s', '--', '--bin-dir', str(bindir)]
    script = (root / 'scripts' / 'install-docker.sh').read_text()
    subprocess.run(installer, input=script, text=True, check=True)
    recall = str(bindir / 'recall.md')
    subprocess.run(installer, input=script, text=True, check=True)  # Updating our own launcher is allowed.
    def run(*args):
        return subprocess.run([recall, *args], cwd=project, check=True, capture_output=True, text=True).stdout
    assert 'Recall.md' in run('--help')
    run('init')
    title = 'Título com espaços, $variável e `literal`'
    run('unit', 'create', '--title', title, '--deck', 'Deck local')
    units = json.loads(run('unit', 'list', '--json'))
    assert units[0]['title'] == title
    assert 'ghcr.io/gmrodrigues/recall.md' in run('update')
    assert json.loads(run('unit', 'list', '--json'))[0]['title'] == title
    assert (project / 'recall/config.yml').is_file()
    assert (project / 'recall/config.yml').stat().st_uid == os.getuid()
    assert json.loads(run('--cwd', str(project), 'unit', 'list', '--json'))[0]['title'] == title
    for value in ['0', '65536', 'bad']:
        result = subprocess.run([recall, 'browser', '--port', value], cwd=project, capture_output=True)
        assert result.returncode != 0
    # An unrelated launcher must remain untouched.
    other = tmp / 'other'; other.mkdir(); target = other / 'recall.md'
    target.write_text('#!/bin/sh\necho existing\n')
    result = subprocess.run(['sh', str(root / 'scripts' / 'install-docker.sh'), '--bin-dir', str(other)], capture_output=True)
    assert result.returncode != 0 and target.read_text().endswith('echo existing\n')
    # A real TTY must start and restore the TUI.
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    process = subprocess.Popen([recall, 'tui'], cwd=project, stdin=slave, stdout=slave, stderr=slave)
    transcript = bytearray()
    try:
        deadline = time.monotonic() + 15
        while b'Recall.md' not in transcript:
            assert time.monotonic() < deadline, 'TUI did not start'
            if select.select([master], [], [], .1)[0]: transcript.extend(os.read(master, 65536))
        os.write(master, b'q')
        process.wait(timeout=15)
        assert process.returncode == 0
        while select.select([master], [], [], .1)[0]: transcript.extend(os.read(master, 65536))
        assert termios.tcgetattr(slave) == original
        assert b'\x1b[?1049l' in transcript
    finally:
        if process.poll() is None: process.terminate(); process.wait(timeout=15)
        os.close(master); os.close(slave)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
    process = subprocess.Popen([recall, 'browser', '--port', str(port)], cwd=project, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 15
        while True:
            try:
                with urllib.request.urlopen('http://127.0.0.1:%s/api/state' % port, timeout=1) as response:
                    assert response.status == 200
                break
            except OSError:
                assert process.poll() is None and time.monotonic() < deadline, 'Web did not start'
                time.sleep(.1)
        container = subprocess.check_output(['docker', 'ps', '-q', '--filter', 'publish=%s' % port], text=True).strip()
        mapping = subprocess.check_output(['docker', 'port', container], text=True)
        assert '127.0.0.1:%s' % port in mapping and '0.0.0.0:' not in mapping
    finally:
        process.send_signal(signal.SIGINT)
        process.wait(timeout=15)
    assert json.loads(run('unit', 'list', '--json'))[0]['title'] == title
print('Install smoke: pipe, install/reinstall, image update, ownership, arguments, persistence, PTY, localhost web and foreign-file protection passed.')
