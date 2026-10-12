"""Exercise the installed Pi loader and TUI in a credential-free disposable profile."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
ANSI_RE = re.compile(rb'(?:\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9])')


def strip_terminal(data):
    return ANSI_RE.sub(b'', data).decode(errors='replace')


def run(mode, enabled=True):
    with tempfile.TemporaryDirectory(prefix="pi-lens-smoke-") as directory:
        workspace = Path(directory)
        (workspace / "fixture.txt").write_text("alpha\nbeta\n")
        image = os.environ.get("PI_LENS_FIXTURE_IMAGE") == "1"
        if image:
            (workspace / "fixture-image.png").write_bytes(
                bytes.fromhex(
                    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de"
                    "0000000d4944415478da63fccfc0500f000583027f949826590000000049454e44ae426082"
                )
            )
        profile = workspace / "profile"
        profile.mkdir()
        settings = {"quietStartup": True, "hideThinkingBlock": True}
        if image:
            settings["terminal"] = {"images": "kitty"}
        (profile / "settings.json").write_text(json.dumps(settings))
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 55, 110, 0, 0))
        env = dict(os.environ, PI_CODING_AGENT_DIR=str(profile), PI_OFFLINE="1",
                   PI_SKIP_VERSION_CHECK="1", PI_TELEMETRY="0", TERM="xterm-256color")
        extension = os.environ.get("PI_LENS_EXTENSION", str(ROOT / "src/index.ts"))
        command = [shutil.which("pi"), "--offline", "--no-extensions", "--no-skills",
                   "--no-prompt-templates", "--no-context-files", "--no-mcp", "--no-approve",
                   "--no-session", "--tui-mode", mode, "-e", extension,
                   "-e", str(ROOT / "tests/fixtures/provider.ts"),
                   "--model", "lens-fixture/gpt-6-astra-fixture", "Inspect the fixture."]
        if not enabled:
            index = command.index(extension)
            del command[index - 1:index + 1]
        batch = os.environ.get("PI_LENS_FIXTURE_BATCH") == "1"
        if batch:
            command[1:1] = ["-e", "builtin:codemode", "--tools", "read,bash,codemode"]
        voice = os.environ.get("PI_LENS_VOICE_EXTENSION")
        if voice:
            command[1:1] = ["-e", voice]
        process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave,
                                   cwd=workspace, env=env, start_new_session=True)
        os.close(slave)
        transcript = bytearray()

        def wait_for(needle, timeout=25):
            begin = time.monotonic()
            chunk = bytearray()
            while time.monotonic() - begin < timeout:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        break
                    chunk.extend(data)
                    transcript.extend(data)
                    # Answer terminal capability requests so startup never waits for a person.
                    if b"\x1b[c" in data:
                        os.write(master, b"\x1b[?1;2c")
                    if needle.encode() in chunk:
                        return bytes(chunk)
                if process.poll() is not None:
                    break
            raise AssertionError(f"{mode}: did not observe {needle!r}\n{chunk.decode(errors='replace')[-9000:]}")

        def wait_for_file(name, timeout=25):
            begin = time.monotonic()
            while time.monotonic() - begin < timeout:
                if (workspace / name).exists():
                    return
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        break
                    transcript.extend(data)
                    if b"\x1b[c" in data:
                        os.write(master, b"\x1b[?1;2c")
                if process.poll() is not None:
                    break
            raise AssertionError(f"{mode}: did not observe file {name!r}")

        try:
            initial = wait_for("Fixture complete.")
            assert b"Lens could not attach" not in initial, initial
            assert b"Lens rendering failed" not in initial, initial
            captured = (workspace / "fixture-context.jsonl").read_text().replace(str(workspace), "WORKSPACE")
            def stable(value):
                if isinstance(value, dict):
                    return {key: stable(item) for key, item in value.items()
                            if key not in ("timestamp", "durationMs")}
                if isinstance(value, list):
                    return [stable(item) for item in value]
                if isinstance(value, str):
                    return re.sub(r"(?m)^Wall time [\d.]+ seconds$", "Wall time DURATION seconds", value)
                return value
            contexts = [stable(json.loads(line)) for line in captured.splitlines()]
            if not enabled:
                return contexts
            assert b"Latest fixture update" in initial, initial
            if image:
                assert b"Read fixture-image.png" in initial, initial
                assert b"[Image 1]" not in initial, initial
                os.write(master, b"/fixture-assert-image-ui\r")
                wait_for_file("fixture-image-expanded-ok")
                os.write(master, b"/fixture-assert-image-details\r")
                wait_for_file("fixture-image-details-ok")
                os.write(master, b"/fixture-assert-live-tail\r")
                wait_for_file("fixture-tail-ok")
                print(f"PASS {mode}: loader, image-first read disclosure, kitty protocol, details, live tail")
                return contexts
            if batch:
                tool_summary = "Read 1 file, ran 1 command"
                assert tool_summary.encode() in initial, initial
                assert b"1 failed" in initial, initial
            else:
                tool_summary = "Read 6 files, ran 1 command (1 failed)"
                assert tool_summary.encode() in initial, initial
            os.write(master, b"/fixture-assert-activity-order\r")
            wait_for("FIXTURE_ACTIVITY_ORDER_OK")
            if mode == "fullscreen":
                os.write(master, b"/fixture-open-thinking\r")
                wait_for("FIXTURE_THINKING_BULLETS_OK")
            os.write(master, b"/fixture-assert-live-tail\r")
            wait_for_file("fixture-tail-ok")
            os.write(master, b"/lens clean\r")
            clean = wait_for("1 step" if batch else "7 steps")
            assert b"1 failed" in clean, clean
            os.write(master, b"/lens raw\r")
            if mode == "fullscreen":
                # Opening thinking pinned the viewport; follow the new command notice explicitly.
                os.write(master, b"\x1b[8^")
            wait_for("View: raw")
            os.write(master, b"\x14")
            if mode == "fullscreen":
                # Native expanded history can exceed the viewport; inspect its beginning.
                os.write(master, b"\x1b[7^")
            wait_for("Older reasoning detail.")
            os.write(master, b"/lens normal\r")
            if mode == "fullscreen":
                os.write(master, b"\x1b[8^")
            wait_for("View: normal")
            os.write(master, b"/fixture-voice\r")
            wait_for("Voice request: Inspect the voice request.")
            os.write(master, b"\x0f")
            if mode == "fullscreen":
                # Lens disclosure pinning intentionally stopped following new output.
                os.write(master, b"\x1b[8^")
            wait_for("VOICE_DETAIL_SENTINEL")
            os.write(master, b"/reload\r")
            wait_for("Reloaded")
            os.write(master, b"/lens\r")
            wait_for("View: normal")
            print(f"PASS {mode}: loader, folds, progress, live tail, native thinking, errors, modes, voice, expansion, reload")
            return contexts
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            os.close(master)
            # Synthetic output only. Keep failure evidence outside the repository.
            Path(f"/tmp/pi-lens-{mode}-smoke.ansi").write_bytes(transcript)


if __name__ == "__main__":
    baseline = run("fullscreen", enabled=False)
    modes = ("fullscreen",) if os.environ.get("PI_LENS_FIXTURE_IMAGE") == "1" else ("fullscreen", "regular")
    for tui_mode in modes:
        actual = run(tui_mode)
        assert actual == baseline, f"{tui_mode}: Lens changed model-visible context"
    if os.environ.get("PI_LENS_FIXTURE_IMAGE") == "1":
        print("SKIP regular image fixture: regular mode exposes no safe native mouse dispatch here")
    print("PASS baseline equivalence: same tool declarations, calls, results, and model-visible messages")
