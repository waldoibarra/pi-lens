"""Bounded, owned PTY process lifecycle for credential-free loader fixtures."""
import fcntl
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import termios
import threading
import time


class TerminalFixture:
    def __init__(self, command, workspace, env, deadline=120):
        self.workspace = Path(workspace)
        self.transcript = bytearray()
        self.deadline = time.monotonic() + deadline
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 55, 110, 0, 0))
        try:
            self.process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave,
                                            cwd=workspace, env=env, start_new_session=True)
        except BaseException:
            os.close(self.master)
            raise
        finally:
            os.close(slave)
        self.timer = None
        try:
            self.timer = threading.Timer(deadline, self.kill_group)
            self.timer.daemon = True
            self.timer.start()
        except BaseException:
            self.close()
            raise

    def kill_group(self, sig=signal.SIGKILL):
        try:
            os.killpg(self.process.pid, sig)
        except ProcessLookupError:
            pass

    def close(self):
        if self.timer is not None:
            self.timer.cancel()
        self.kill_group(signal.SIGTERM)
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        finally:
            # Descendants may remain even when the group leader already exited.
            self.kill_group()
            try:
                self.process.wait(timeout=3)
            finally:
                os.close(self.master)

    def send(self, data):
        os.write(self.master, data)

    def read(self):
        if time.monotonic() >= self.deadline:
            raise AssertionError("Fixture exceeded its hard wall deadline")
        if not select.select([self.master], [], [], 0.1)[0]:
            return b""
        try:
            data = os.read(self.master, 65536)
        except OSError:
            data = b""
        if len(self.transcript) + len(data) > 2 * 1024 * 1024:
            raise AssertionError("Fixture terminal output exceeded 2 MiB")
        self.transcript.extend(data)
        if b"\x1b[c" in data:
            self.send(b"\x1b[?1;2c")
        return data

    def wait(self, needle=None, filename=None, timeout=25):
        until = min(self.deadline, time.monotonic() + timeout)
        chunk = bytearray()
        while time.monotonic() < until:
            if filename and (self.workspace / filename).exists():
                return bytes(chunk)
            chunk.extend(self.read())
            if needle and needle.encode() in chunk:
                return bytes(chunk)
            if self.process.poll() is not None:
                break
        raise AssertionError(
            f"Missing {needle or filename!r}; process={self.process.poll()}\n"
            + self.transcript[-9000:].decode(errors="replace")
        )
