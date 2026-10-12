"""Failure-path coverage for the owned PTY process fixture."""
import errno
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import terminal_fixture


class TerminalFixtureTests(unittest.TestCase):
    def test_timer_start_failure_reaps_process_group_and_closes_pty(self):
        processes = []
        descriptors = []
        real_spawn = subprocess.Popen
        real_openpty = terminal_fixture.pty.openpty

        def spawn(*args, **kwargs):
            process = real_spawn(*args, **kwargs)
            processes.append(process)
            return process

        def openpty():
            pair = real_openpty()
            descriptors.extend(pair)
            return pair

        with tempfile.TemporaryDirectory(prefix="pi-lens-timer-test-") as directory:
            try:
                with patch.object(terminal_fixture.subprocess, "Popen", side_effect=spawn), \
                     patch.object(terminal_fixture.pty, "openpty", side_effect=openpty), \
                     patch.object(terminal_fixture.threading.Timer, "start",
                                  side_effect=RuntimeError("injected timer failure")):
                    with self.assertRaisesRegex(RuntimeError, "injected timer failure"):
                        terminal_fixture.TerminalFixture(
                            # A separate OS deadline also bounds the intentionally broken fixture.
                            [sys.executable, "-c", "import signal,time; signal.alarm(5); time.sleep(30)"],
                            directory, dict(os.environ), deadline=2,
                        )
                self.assertEqual(len(processes), 1)
                self.assertIsNotNone(processes[0].poll(), "Constructor leaked its child process")
                with self.assertRaises(ProcessLookupError):
                    os.killpg(processes[0].pid, 0)
                for descriptor in descriptors:
                    with self.assertRaises(OSError) as error:
                        os.fstat(descriptor)
                    self.assertEqual(error.exception.errno, errno.EBADF)
            finally:
                # Keep even the pre-fix red test bounded and clean up only owned resources.
                for process in processes:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        pass
                    finally:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait(timeout=1)
                for descriptor in descriptors:
                    try:
                        os.close(descriptor)
                    except OSError as error:
                        if error.errno != errno.EBADF:
                            raise


if __name__ == "__main__":
    unittest.main()
