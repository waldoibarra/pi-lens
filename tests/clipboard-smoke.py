"""Exercise synthetic captured bytes through the frozen host's native editor and real loader."""
import json
import os
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode = True
from terminal_fixture import TerminalFixture

ROOT = Path(__file__).resolve().parents[1]
HOST = Path(os.environ["PI_LENS_SOURCE_HOST"]).resolve()
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGPQ2Jfynyvqzn8GEAHiAABMFgkR0cgD4AAAAABJRU5ErkJggg=="
EXPECTED = [{"type": "text", "text": "typed /missing/lens-clipboard.png [Image 1] captures "
             "/missing/lens-clipboard.png + /missing/lens-clipboard.png"}]


def run(mode):
    with tempfile.TemporaryDirectory(prefix="pi-lens-clipboard-") as directory:
        workspace = Path(directory)
        profile = workspace / "profile"
        profile.mkdir()
        (profile / "settings.json").write_text(json.dumps({"quietStartup": True, "terminal": {"images": "kitty"}}))
        env = dict(os.environ, PI_CODING_AGENT_DIR=str(profile), PI_OFFLINE="1",
                   PI_SKIP_VERSION_CHECK="1", PI_TELEMETRY="0", TERM="xterm-256color",
                   PI_LENS_FIXTURE_CLIPBOARD="1")
        command = [str(HOST / "pi-test.sh"), "--no-env", "--offline", "--no-extensions",
                   "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp",
                   "--no-approve", "--tui-mode", mode, "--session-dir", str(workspace / "sessions"),
                   "-e", str(ROOT / "src/index.ts"), "-e", str(ROOT / "tests/fixtures/provider.ts"),
                   "--model", "lens-fixture/gpt-6-astra-fixture"]
        voice = os.environ.get("PI_LENS_VOICE_EXTENSION")
        if voice:
            command.extend(["-e", voice])

        def assert_stage(fixture, stage):
            fixture.send(f"/fixture-clipboard-assert {stage}\r".encode())
            fixture.wait(filename=f"clipboard-{stage}.json")
            return json.loads((workspace / f"clipboard-{stage}.json").read_text())

        fixture = TerminalFixture(command, workspace, env)
        try:
            fixture.wait(filename="clipboard-ready")
            fixture.send(b"/fixture-clipboard-draft\r")
            fixture.wait(filename="clipboard-draft-ready")
            # Enter uses the actual native submission snapshot. No OS clipboard acquisition is claimed.
            fixture.send(b"\r")
            fixture.wait("Clipboard fixture complete.")
            closed = assert_stage(fixture, "closed")
            if mode == "fullscreen":
                opened = assert_stage(fixture, "open")
                detailed = assert_stage(fixture, "details")
                assert opened["protocolIds"] == detailed["protocolIds"]
                fixture.send(b"/reload\r")
                fixture.wait("Reloaded")
                reloaded = assert_stage(fixture, "reload")
                assert reloaded["inputId"] == closed["inputId"]
                assert reloaded["protocolIds"] == opened["protocolIds"]
            fixture.send(b"/lens raw\r")
            fixture.wait("View: raw")
            assert_stage(fixture, "raw")
            fixture.send(b"/lens normal\r")
            fixture.wait("View: normal")
            fixture.send(b"\x0f")
            assert_stage(fixture, "global")
            fixture.send(b"\x0f")
            assert_stage(fixture, "collapse")
            fixture.send(b"/lens clean\r")
            fixture.wait("View: clean")
            assert_stage(fixture, "clean")
            # Repeat global expansion in clean, with a new assertion file.
            (workspace / "clipboard-global.json").unlink()
            fixture.send(b"\x0f")
            assert_stage(fixture, "global")
        finally:
            fixture.close()
            Path(f"/tmp/pi-lens-clipboard-{mode}.ansi").write_bytes(fixture.transcript)

        sessions = list((workspace / "sessions").glob("*.jsonl"))
        assert len(sessions) == 1, sessions
        entries = [json.loads(line) for line in sessions[0].read_text().splitlines()]
        users = [entry for entry in entries if entry.get("message", {}).get("role") == "user"]
        assert len(users) == 1
        assert users[0]["message"]["content"] == EXPECTED
        display = users[0]["inputDisplay"]
        assert display["input"]["origin"] == "composer"
        assert display["input"]["id"] == closed["inputId"]
        assert [image["data"] for image in display["clipboard"]["images"]] == [PNG, PNG]
        assert [image["number"] for image in display["clipboard"]["images"]] == [1, 2]
        contexts = [json.loads(line) for line in (workspace / "fixture-context.jsonl").read_text().splitlines()]
        assert len(contexts) == 1, "Exactly one provider call is allowed"
        assert all("inputDisplay" not in message and "binding" not in message for message in contexts[0])
        assert [message["content"] for message in contexts[0] if message.get("role") == "user"] == [EXPECTED]

        fixture = TerminalFixture(command + ["--session", str(sessions[0])], workspace, env)
        try:
            fixture.wait("You")
            resumed = assert_stage(fixture, "resume")
            assert resumed["inputId"] == closed["inputId"]
            assert resumed["imageIds"] == closed["imageIds"]
        finally:
            fixture.close()
            Path(f"/tmp/pi-lens-clipboard-{mode}-resume.ansi").write_bytes(fixture.transcript)
        print(f"PASS {mode}: native editor capture, real bindings, previews, raw/global, reload/resume, unchanged context")


if __name__ == "__main__":
    for tui_mode in ("fullscreen", "regular"):
        run(tui_mode)
