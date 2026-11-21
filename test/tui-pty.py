"""Interactive smoke over an actual POSIX pseudo-terminal, using synthetic study data."""
import fcntl
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time
import uuid

cli, cwd, node, *extra = sys.argv[1:]
image = extra[0] if extra else None

def session(mode):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 110, 0, 0))
    original = termios.tcgetattr(slave)
    container_name = 'recall-pty-' + uuid.uuid4().hex[:12]
    command = (['docker', 'run', '--name', container_name, '--rm', '-it', '--user', '%s:%s' % (os.getuid(), os.getgid()), '--mount', 'type=bind,source=%s,target=/workspace' % cwd, image, 'tui'] if image else [node, cli, '--cwd', cwd, 'tui'])
    process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    transcript = bytearray()
    offset = 0

    def wait_for(value, timeout=12):
        target = value.encode()
        deadline = time.monotonic() + timeout
        while target not in transcript[offset:]:
            if time.monotonic() >= deadline:
                raise AssertionError('TUI did not show %r; recent output: %s' % (value, bytes(transcript[-3500:]).decode(errors='replace')))
            ready, _, _ = select.select([master], [], [], 0.05)
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    chunk = b''
                if chunk:
                    transcript.extend(chunk)
                elif process.poll() is not None:
                    raise AssertionError('TUI exited before %r' % value)

    def send(value):
        nonlocal offset
        offset = len(transcript)
        os.write(master, value if isinstance(value, bytes) else value.encode())

    try:
        wait_for('Recall.md')
        if mode == 'flow':
            # Resize with the same UI still alive, then restore a wider viewport.
            offset = len(transcript)
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 20, 60, 0, 0))
            os.kill(process.pid, signal.SIGWINCH)
            wait_for('Colunas 1–2 de 5')
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 110, 0, 0))
            os.kill(process.pid, signal.SIGWINCH)
            send(b'\r'); wait_for('MATERIAL')
            send('m'); wait_for('Mover ficha para')
            send(b'\x1b[B\r'); wait_for('Ficha de conteúdo salva.')
            send('q'); wait_for('Múltipla escolha')
            send(b'2\r'); wait_for('Texto livre')
            send('Minha explicacao no terminal'); wait_for('Minha explicacao no terminal')
            send(b'\r'); wait_for('TENTATIVA REGISTRADA')
            send(b'\x1b[C'); wait_for('COMPARE COM A REFERÊNCIA')
            send('2'); wait_for('Autoavaliação registrada.')
            send(b'\r'); wait_for('MATERIAL')
            send('r'); wait_for('Resposta oculta.')
            send(' '); wait_for('RESPOSTA')
            send('3'); wait_for('REVISÃO EM DIA')
            send(b'\x1b'); wait_for('PLANOS DE ESTUDO PARA REVISÃO')
            send(b'\x1b'); wait_for('Colunas')
            send('n'); wait_for('Nova ficha de conteúdo')
            send('Etapa pelo terminal'); wait_for('Etapa pelo terminal')
            send(b'\t\t'); wait_for('Material / descrição')
            send('Material sintetico'); wait_for('Material sintetico')
            send(b'\x13'); wait_for('Ficha de conteúdo salva.')
            send(b'\x1b'); wait_for('Colunas')
            send('q')
        elif mode == 'interrupt':
            send(b'\x03')
        else:
            os.kill(process.pid, signal.SIGTERM)
        process.wait(timeout=12)
        # Drain the final restore sequence.
        while select.select([master], [], [], 0.1)[0]:
            transcript.extend(os.read(master, 65536))
        assert process.returncode == 0, 'TUI exit status %s' % process.returncode
        assert b'\x1b[?1049h' in transcript, 'Alternate screen was not entered'
        assert b'\x1b[?25h\x1b[?1049l' in transcript, 'Cursor/screen was not restored'
        assert b'\x1b[?2004l' in transcript, 'Bracketed paste mode was not restored'
        restored = termios.tcgetattr(slave)
        assert restored == original, 'Terminal attributes not restored after %s' % mode
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        if image:
            subprocess.run(['docker', 'rm', '-f', container_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.close(master)
        os.close(slave)

for mode in (['flow', 'interrupt'] if image else ['flow', 'interrupt', 'signal']):
    session(mode)
    print('PTY %s: navigation/exit and terminal restoration verified' % mode)
