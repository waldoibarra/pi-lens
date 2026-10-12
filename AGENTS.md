# Pi Lens

Display-only Pi extension. Read [the behavior reference](docs/reference/views.md) before changing presentation.

## Commands

Run from the repository root:

- `bun install --frozen-lockfile --ignore-scripts`: install pinned development dependencies.
- `bun run check`: typecheck, tests, Prettier, and Markdown checks.
- `bun test tests/presentation.test.ts`: focused real-component tests.
- `bun run format`: format supported source and documentation files.
- `PATH="$PWD/node_modules/.bin:$PATH" python3 tests/terminal-smoke.py`: isolated real-loader TUI tests.
- `npm pack --dry-run`: inspect the publish payload without publishing.

No compilation step is required. Pi loads `src/index.ts` directly.

## Boundaries

- Preserve tool execution, model context, and stored messages; change presentation only.
- Keep private Pi access in the adapter and presentation boundary; retain native fallback.
- Keep the live-voice editor and controls untouched. Fold only its recognized transcript messages.
- Development copies of host packages stay in `devDependencies`; runtime hosts supply peers.
- Validate in disposable profiles; do not change a contributor's normal configuration.
- Keep operator-specific configuration, routing, usage records, and cross-repository plans outside this repository.

Read [Contribute](docs/how-to/contribute.md) before testing voice compatibility or preparing a package.
