# Try the views

You'll compare folded tool runs and native output without changing your installed package list.

Use this checkout with Pi 1.1.0 or 1.2.0, the verified hosts.
A normal conversation uses your configured model and credentials.

1. Start Pi from the checkout:

   ```sh
   pi -e .
   ```

2. Ask Pi to read `package.json` and `README.md`, then run `printf 'Lens test\n'`.

   Consecutive calls appear under a count line. Assistant prose starts another run.

3. Enter `/lens clean`.

   Each run shows its step count. Failed runs also retain their latest error.

4. Hover over a step or progress header in fullscreen mode.

   Its background highlights. Click a count line to open a run.

   The fold opens. Click a read step to see its returned contents.
   Click a command step to see its original command and output.

5. Press `Ctrl+O`, Pi's default tool-expansion shortcut.

   Native rows reveal full details, including custom renderers and images.
   Press it again to close individual details and return to folded rows.
   A custom keybinding takes precedence.

6. Enter `/lens raw`.

   Pi draws the transcript itself. If native thinking is hidden, press `Ctrl+T` to reveal it.
   Enter `/lens normal` to restore Lens's latest-heading progress view.

If `pi-live-codex` is already installed, its delegated requests also fold.
Click a voice-request line to reveal the original message.
The live-voice panel and its controls remain separate from the transcript.

Read [Install and remove Lens](../how-to/install.md) before making the trial persistent.
