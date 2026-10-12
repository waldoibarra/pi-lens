"""Prove provenance using a patched source CLI, real submissions, and cold session resume."""
import json
import os
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode = True
from terminal_fixture import TerminalFixture

ROOT = Path(__file__).resolve().parents[1]
HOST = Path(os.environ.get("PI_LENS_SOURCE_HOST", ROOT.parent / "pi")).resolve()
TEXT = b"Inspect subagent updates above.\nORIGIN_FULL_BODY"
# Independent literal expectations catch identically corrupted composer/extension records.
EXPECTED_USER_CONTENTS = [
    [{"type": "text", "text": "Inspect subagent updates above.\nORIGIN_FULL_BODY"}],
    [{"type": "text", "text": "Inspect subagent updates above.\nORIGIN_FULL_BODY"}],
    [{"type": "text", "text": '<skill name="origin-demo" location="/fixture/SKILL.md">\n'
      'ORIGIN_SKILL_BODY\n</skill>\n\nORIGIN_SKILL_ARGUMENTS'}],
]


def run(mode):
    with tempfile.TemporaryDirectory(prefix="pi-lens-origin-") as directory:
        workspace = Path(directory)
        profile = workspace / "profile"
        profile.mkdir()
        (profile / "settings.json").write_text(json.dumps({"quietStartup": True}))
        env = dict(os.environ, PI_CODING_AGENT_DIR=str(profile), PI_OFFLINE="1",
                   PI_SKIP_VERSION_CHECK="1", PI_TELEMETRY="0", TERM="xterm-256color",
                   PI_LENS_FIXTURE_ORIGIN="1")
        command = [str(HOST / "pi-test.sh"), "--no-env", "--offline", "--no-extensions",
                   "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp",
                   "--no-approve", "--tui-mode", mode, "--session-dir", str(workspace / "sessions"),
                   "-e", str(ROOT / "src/index.ts"), "-e", str(ROOT / "tests/fixtures/provider.ts"),
                   "--model", "lens-fixture/gpt-6-astra-fixture"]
        voice = os.environ.get("PI_LENS_VOICE_EXTENSION")
        if voice:
            command.extend(["-e", voice])

        def assert_stage(fixture, stage):
            fixture.send(f"/fixture-origin-assert {stage}\r".encode())
            fixture.wait(filename=f"origin-{stage}.json")
            return json.loads((workspace / f"origin-{stage}.json").read_text())

        fixture = TerminalFixture(command, workspace, env)
        try:
            fixture.wait(filename="origin-ready")
            # Bracketed paste exercises the real composer, not a CLI or extension origin substitute.
            fixture.send(b"\x1b[200~" + TEXT + b"\x1b[201~\r")
            fixture.wait("Origin fixture complete.")
            fixture.send(b"/fixture-origin-wake\r")
            fixture.wait("Origin fixture complete.")
            fixture.send(b"/fixture-origin-skill\r")
            fixture.wait("Origin fixture complete.")
            closed = assert_stage(fixture, "closed")
            if mode == "fullscreen":
                assert_stage(fixture, "open")
                fixture.send(b"/reload\r")
                fixture.wait("Reloaded")
                assert assert_stage(fixture, "reload")["ids"] == closed["ids"]
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
        finally:
            fixture.close()
            Path(f"/tmp/pi-lens-origin-{mode}.ansi").write_bytes(fixture.transcript)

        sessions = list((workspace / "sessions").glob("*.jsonl"))
        assert len(sessions) == 1, sessions
        entries = [json.loads(line) for line in sessions[0].read_text().splitlines()]
        users = [entry for entry in entries if entry.get("message", {}).get("role") == "user"]
        assert [entry["inputDisplay"]["input"]["origin"] for entry in users] == [
            "composer", "extension", "extension"]
        assert [entry["inputDisplay"]["input"]["id"] for entry in users] == closed["ids"][:3]
        assert [entry["message"]["content"] for entry in users] == EXPECTED_USER_CONTENTS
        contexts = [json.loads(line) for line in (workspace / "fixture-context.jsonl").read_text().splitlines()]
        assert len(contexts) == 3, "Exactly three deterministic provider calls are allowed"
        for index, context in enumerate(contexts):
            assert all("inputDisplay" not in message and "binding" not in message for message in context)
            assert [message["content"] for message in context if message.get("role") == "user"] == \
                EXPECTED_USER_CONTENTS[:index + 1]

        # New process, same persistent session; no metadata is manufactured by the fixture.
        fixture = TerminalFixture(command + ["--session", str(sessions[0])], workspace, env)
        try:
            fixture.wait("You")
            fixture.send(b"/fixture-origin-assert resume\r")
            fixture.wait(filename="origin-resume.json")
            resumed = json.loads((workspace / "origin-resume.json").read_text())
            assert resumed["ids"] == closed["ids"]
        finally:
            fixture.close()
            Path(f"/tmp/pi-lens-origin-{mode}-resume.ansi").write_bytes(fixture.transcript)
        print(f"PASS {mode}: actual source bindings, composer You, extension folds, skills, raw/global, cold resume")


if __name__ == "__main__":
    for tui_mode in ("fullscreen", "regular"):
        run(tui_mode)
