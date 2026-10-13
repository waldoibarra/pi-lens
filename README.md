# Pi Lens

A calmer Pi transcript: folded tool runs, plain errors, and details when you need them.

```text
• Read 2 files, ran 1 command (1 failed)
  ▸ ✓ Read config.ts · 34 lines
  ▸ ✓ Read package.json · 41 lines
  ▸ ✗ Ran a shell command · exit 1
    The command failed (exit 1). Press Ctrl+O to see its output.
```

## Try it

With Pi **1.1.0** installed, load the release from Git:

```sh
pi -e git:github.com/waldoibarra/pi-lens@v0.1.0
```

This loads Lens for one invocation without changing your package list.
This package is distributed as a Pi Git package, not an npm package.
npm's `pi-lens` name belongs to an unrelated project; do not install it.

## Choose your view

- **Normal:** counts each tool run, showing five steps before an expandable remainder.
- **Clean:** keeps each run's count and latest failure.
- **Raw:** restores Pi's own transcript rendering.
- **Thinking updates:** shows the latest update; expand it for a compact bulleted history.

Switch with `/lens normal`, `/lens clean`, or `/lens raw`.
Hover over a clickable header in fullscreen mode to highlight it.
Click any tool step, including reads, to reveal its original native details.
Tool batches summarize their observed actions instead of showing `Codemode`.
Opening a Lens step keeps your scroll position; its details extend below the header.
Pi's native tool-expansion shortcut opens all rows.

Live-voice delegation messages also fold to one line. Their original contents remain available on expansion.
Lens leaves the voice editor, visualizer, microphone, and controls alone.

## What stays unchanged

Lens changes the display, not tool execution, stored messages, or model context. It makes no model calls.

Transcript grouping uses a guarded private Pi adapter. Other Pi versions retain native rendering.
On stock Pi 1.1.0, native inputs keep neutral `Input` labels and clipboard metadata is unavailable.
Compatible patched hosts can add origin-aware input labels and clipboard previews.

- Read [Try the views](docs/tutorials/try-the-views.md) before your first trial.
- Read [Install and remove Lens](docs/how-to/install.md) before making it persistent.
- Read [Views and compatibility](docs/reference/views.md) before relying on expansion or historical labels.
- Read [How display-only folding works](docs/explanation/display-only.md) before changing the adapter.
- Read [Contribute](docs/how-to/contribute.md) before developing or packaging a change.
- Read the sibling [Claude Lens](https://github.com/waldoibarra/claude-lens) for the closest Claude implementation.

## License

MIT. Formatting behavior is ported from Waldo Ibarra's `claude-lens`.
