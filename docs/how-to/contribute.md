# Contribute

Run unit checks against the pinned development host and terminal checks against each verified runtime.

## Set up

Install Bun and Node.js 22.19 or newer, then run from the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
```

The development dependencies include Pi 1.1.0. Runtime installations use Pi's own peer packages.
Terminal fixtures also verify the installed Pi 1.2.0 host; CI checks both versions.
Set `PI_LENS_EXPECT_VERSION` to reject accidental testing against a different executable on `PATH`.
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

## Verify patched-host input provenance

Published Pi 1.1.0 cannot prove input origin. Use a source host implementing the documented input-binding contract.
Its dependencies and generated model data must already be hydrated; this fixture performs no installation or network access.

```sh
PI_LENS_SOURCE_HOST="/path/to/patched/pi" \
  PI_LENS_VOICE_EXTENSION="/path/to/pi-live-codex/index.ts" \
  python3 tests/input-origin-smoke.py
```

Omit the voice variable when that extension is unavailable. The default source-host path is the sibling `../pi`.
The fixture runs the actual `pi-test.sh --no-env` CLI in fullscreen and regular modes.
It submits identical composer and extension text through real host paths, then sends a multi-row skill input.
Assertions inspect host-created bindings, `You`, extension folds, native recovery, reload, and persistent cold resume.
No fixture assigns binding metadata. The deterministic provider makes no external model calls.
Input IDs must survive resume; origin metadata must remain absent from provider messages.
The fullscreen check also asserts that opening a fold preserves its header position and upper screen rows.

Both loader fixtures use disposable profiles and bounded process groups, terminated and killed during cleanup.
Each process has a 120-second deadline, eight-provider-call limit, and a 2 MiB terminal-output cap.
Context logs stop at 1 MiB. Bounded ANSI failure evidence remains under `/tmp/pi-lens-*`.
To prove an already-built patched bundle without the source resolver, pass its explicit CLI path:

```sh
PI_LENS_COMPILED_CLI="/path/to/pi/packages/coding-agent/dist/bundle/cli.js" \
  python3 tests/input-origin-smoke.py
```

The compiled entry runs with `node` and receives the same fixture arguments.
Source verification does not install the patched host or establish physical-terminal human acceptance.

## Verify clipboard presentation

Use a frozen source host implementing the documented clipboard metadata contract; avoid another writer's mutable checkout.
The portable component tests cover native images, Markdown, cache invalidation, and regular-renderer graphics cleanup.
Two additional contract tests load the source host's real normalizer when `PI_LENS_SOURCE_HOST` is set.

```sh
PI_LENS_SOURCE_HOST="/path/to/frozen/pi" bun test tests/clipboard.test.ts

PI_LENS_SOURCE_HOST="/path/to/frozen/pi" \
  PI_LENS_VOICE_EXTENSION="$HOME/.pi/agent/npm/node_modules/pi-live-codex/index.ts" \
  python3 tests/clipboard-smoke.py
```

The terminal fixture inserts valid synthetic PNG bytes through the actual native editor's clipboard insertion method.
Enter then exercises real submission snapshots, native bindings, persistence, and provider-message exclusion.
It never acquires or overwrites the OS clipboard, assigns binding metadata, or reads the missing image path.
Both modes cover collapsed previews, native global expansion in normal/clean, raw equality, and cold resume.
Assertions distinguish native graphics payloads from visible text; Details must never add base64 dumps.
Fullscreen additionally verifies image/Details peek anchoring and reload-stable image IDs.
Active-branch reconciliation retains capture choices; an empty branch prunes those choices and runtime image IDs.
The fixture uses the same deadlines, process-group cleanup, context limits, and output caps described above.
Physical-terminal image appearance and real clipboard acquisition remain separate manual acceptance checks.

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

## Verify installed package discovery

Install the candidate into a disposable Pi profile first, then test that profile without explicitly loading Lens:

```sh
python3 tests/installed-smoke.py --profile /path/to/profile --expected-version 1.2.0
```

This fixture never installs packages. It uses the supplied profile's ordinary extension discovery and tests both terminal modes.
Only `/lens` view commands and `/reload` are submitted; an injected deterministic provider detects accidental model requests.
The fixture checks that no request occurred. It does not copy credentials or open a microphone.
The profile's other extensions also load; use a normal profile only with explicit approval after isolated acceptance.
Owned processes are bounded and terminated on success or failure.

## Publish a release

Pi Lens is distributed as a Pi Git package, currently `git:github.com/waldoibarra/pi-lens@v0.2.0`.
Keep `package.json` private; the unscoped npm name belongs to another project.
Versioned tags are immutable. Only the `latest` release alias may move.

1. Update `package.json` and installation examples to the new version.
2. Run checks and inspect the package payload:

   ```sh
   bun run check
   PI_LENS_EXPECT_VERSION=1.1.0 PATH="$PWD/node_modules/.bin:$PATH" python3 tests/terminal-smoke.py
   npm pack --dry-run
   ```

   With Pi 1.2.0 first on `PATH`, run the fixture again with `PI_LENS_EXPECT_VERSION=1.2.0`.
   Run direct, batch (`PI_LENS_FIXTURE_BATCH=1`), and image (`PI_LENS_FIXTURE_IMAGE=1`) cases.
   No external provider calls are made. Unit and terminal checks do not establish human visual acceptance.

3. Commit the release and create its annotated version tag, for example:

   ```sh
   git tag -a v0.2.0 -m "Pi Lens 0.2.0"
   git push --atomic origin main refs/tags/v0.2.0
   ```

4. Confirm CI passes on the tagged commit, then publish its GitHub Release with compatibility notes.
5. Promote `latest` only after the versioned release is published and verified:

   ```sh
   git tag latest 'v0.2.0^{commit}'
   git push origin refs/tags/latest
   ```

   For subsequent releases, inspect `git ls-remote origin refs/tags/latest` first.
   Replace `OLD_OBJECT_ID` with that result and use the newly published version below:

   ```sh
   git tag -f latest 'v0.2.0^{commit}'
   git push --force-with-lease=refs/tags/latest:OLD_OBJECT_ID origin refs/tags/latest
   ```

   Never force a version tag or branch. If the lease fails, inspect the concurrent change before retrying.

6. Update managed installations' explicit version pins after verification; they do not follow `latest` automatically.
   Test the published package through normal package discovery, not only a development `-e` path.
   Keep a previous version pin available for rollback.

`npm pack --dry-run` reviews the payload; it does not publish to npm.

Read [How display-only folding works](../explanation/display-only.md) before changing private host integration.
