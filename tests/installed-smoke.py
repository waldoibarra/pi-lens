"""Verify installed-package auto-loading without submitting a prompt or calling a provider."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
from terminal_fixture import TerminalFixture

ROOT = Path(__file__).resolve().parents[1]


def run(pi_binary, profile, mode):
    with tempfile.TemporaryDirectory(prefix="pi-lens-installed-") as directory:
        workspace = Path(directory)
        env = {
            "PATH": os.environ["PATH"],
            "HOME": os.environ["HOME"],
            "TERM": "xterm-256color",
            "PI_CODING_AGENT_DIR": str(profile),
            "PI_OFFLINE": "1",
            "PI_SKIP_VERSION_CHECK": "1",
            "PI_TELEMETRY": "0",
        }
        command = [pi_binary, "--offline", "--no-approve", "--no-session",
                   "--no-context-files", "--no-skills", "--no-prompt-templates",
                   "--no-mcp", "--tui-mode", mode,
                   "-e", str(ROOT / "tests/fixtures/provider.ts"),
                   "--model", "lens-fixture/gpt-6-astra-fixture"]
        # Lens is discovered only through settings. The fixture provider makes accidental requests local and detectable.
        fixture = TerminalFixture(command, workspace, env, deadline=60)
        try:
            # Input sent before raw terminal mode starts can become an unsubmitted multiline draft.
            fixture.wait("\x1b]0;")
            fixture.send(b"/lens\r")
            fixture.wait("View: normal.")
            for view in ("clean", "raw", "normal"):
                fixture.send(f"/lens {view}\r".encode())
                fixture.wait(f"View: {view}.")
            fixture.send(b"/reload\r")
            fixture.wait("Reloaded")
            fixture.send(b"/lens\r")
            fixture.wait("View: normal.")
            assert not (workspace / "fixture-context.jsonl").exists(), "A slash command reached the model"
            for warning in (b"Lens could not attach", b"Lens rendering failed",
                            b"Lens is unavailable", b"Lens supports Pi"):
                assert warning not in fixture.transcript, warning.decode()
        finally:
            fixture.close()
        print(f"PASS {mode}: installed auto-loading, normal/clean/raw, reload; no prompt submitted")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=Path,
                        help="Existing Pi profile with Lens already installed; never installs packages")
    parser.add_argument("--expected-version", required=True,
                        help="Exact Pi host version expected on PATH")
    args = parser.parse_args()
    # Preserve the profile's lexical base: resolving /tmp symlinks can relocate relative package paths.
    profile = args.profile.expanduser().absolute()
    assert (profile / "settings.json").is_file(), "An existing profile settings.json is required"
    pi_binary = shutil.which("pi")
    assert pi_binary, "Pi must be available on PATH"
    version = subprocess.run([pi_binary, "--version"], check=True, capture_output=True,
                             text=True, timeout=10).stdout.strip()
    assert version == args.expected_version, f"Expected Pi {args.expected_version}, got {version}"
    print(f"HOST Pi {version}", flush=True)
    for mode in ("fullscreen", "regular"):
        run(pi_binary, profile, mode)
