# Contribute

Run changes against the pinned Pi host before trying another version.

## Set up

Install Bun and Node.js 22.19 or newer, then run from the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
```

The development dependencies include Pi 1.1.0. Runtime installations use Pi's own peer packages.
No build step is required: Pi loads the TypeScript entry point.

## Change a behavior

1. Read the corresponding contract in [Views and compatibility](../reference/views.md).
2. Add a failing assertion in the affected test file.
3. Implement the smallest change that passes it.
4. Run the checks:

   ```sh
   bun run check
   ```

5. Run the real-loader terminal tests:

   ```sh
   PATH="$PWD/node_modules/.bin:$PATH" python3 tests/terminal-smoke.py
   ```

   The smoke test uses disposable profiles and a local deterministic provider.
   It makes no external model calls and leaves ordinary Pi settings unchanged.
   It compares model-visible messages, tool declarations, calls, and results with the Lens-free baseline.
   Native-row screen fixtures verify live activity after asynchronous notices and its removal after settlement.
   Fullscreen component tests compare header coordinates and upper rows through expansion, streaming, collapse, and renewed streaming.

6. Exercise real nested tool calls with the built-in batch executor:

   ```sh
   PI_LENS_FIXTURE_BATCH=1 PATH="$PWD/node_modules/.bin:$PATH" python3 tests/terminal-smoke.py
   ```

   This verifies action summaries and visible nested failures against the same Lens-free baseline.

7. Exercise the real image loader fixture:

   ```sh
   PI_LENS_FIXTURE_IMAGE=1 PATH="$PWD/node_modules/.bin:$PATH" python3 tests/terminal-smoke.py
   ```

   This verifies image-first expansion, Details, Kitty output, and unchanged model context.
   Regular-mode image expansion is skipped because the fixture has no safe native mouse dispatch there.

8. Update the relevant documentation in the same change.

## Check installed voice compatibility

If `pi-live-codex` is installed in Pi's normal npm directory:

```sh
PI_LENS_VOICE_ROOT="$HOME/.pi/agent/npm/node_modules/pi-live-codex" \
  bun test tests/voice-compat.test.ts

PI_LENS_VOICE_EXTENSION="$HOME/.pi/agent/npm/node_modules/pi-live-codex/index.ts" \
  python3 tests/terminal-smoke.py
```

The component test uses the installed visualizer source with the pinned host peers.
It verifies unchanged drawing and mute/stop callbacks without opening audio.
The terminal test co-loads the actual extension but never starts a voice session.
A real microphone and live connection still need human acceptance testing.

## Package a release candidate

Inspect the payload before creating a tarball:

```sh
npm pack --dry-run
```

Run `npm pack` only when you need a distributable tarball.
Publishing to npm or creating a remote repository requires separate approval.
The unscoped npm name is already occupied. Choose an available scoped name before removing `private: true`.

Read [How display-only folding works](../explanation/display-only.md) before changing private host integration.
