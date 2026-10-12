# How display-only folding works

Lens draws a separate view of Pi's transcript components. Pi keeps the original messages and tool execution.

The adapter attaches to one chat-container instance through an invisible extension widget.
It does not replace the editor, footer, header, tools, or global component prototypes.
The projected container owns its rendered row heights and mouse routing together.

This boundary keeps the `pi-live-codex` visualizer outside Lens's control.
Voice delegation messages belong to the transcript, so Lens can fold them without touching audio or input handling.

## Why the adapter uses private fields

Pi's public tool-renderer API handles individual tools.
Mixed-tool runs and message footers also require access to neighboring transcript components.

Transcript integration lives in `src/adapter.ts`; host data conversion lives in `src/pi-data.ts`.
`src/progress.ts` projects thinking regions while retaining native prose, warnings, and message markers.
It exposes current thinking separately; presentation appends one inert activity summary after every transcript child.
`src/spacing.ts` removes verified `Spacer(1)` shell padding, never whitespace emitted by content renderers.
`src/hover.ts` observes mouse input before Pi's viewport listener consumes it.
The observer never consumes or rewrites input, captures a pointer, or changes keyboard focus.
Formatting, display state, presentation, and lifecycle wiring remain separate concerns.
The formatter ports behavior from `claude-code-lens` without depending on its checkout at runtime.

Unsupported hosts or rendering failures retain native output.
Teardown restores only methods still owned by Lens, preserving wrappers installed afterward.

## Input role is not authorship

Pi extensions can send user-role messages. That role does not prove human authorship.
Pi 1.1.0 input events expose source, but lack reliable message and rendered-row correlation.
Lens therefore uses neutral `Input` labels and never classifies authorship from message wording.
Distinct automation folds require an identity-bound origin contract; they are not implemented for ambiguous user-role input.

## State stays outside model context

Lens keeps observed metadata and expansion choices in memory.
A session-keyed slot preserves them across `/reload`; a new session clears them.
It neither writes transcript entries nor sends messages to the model.

Each open step uses the original native component with its expanded state enabled.
Image reads reuse native image components directly and keep technical output behind `Details`.
If Pi cannot render the image as graphics, Lens leaves the complete native row unchanged.
Lens retains no separate tool-detail copy and imposes no additional output cap.
Thinking history uses display-only native Markdown rendering, including when native thinking starts hidden.
Visible assistant prose splits activity into separate stable disclosures within the same native row.
Ordinary updates render separately with plain compact labels and bullet gutters; rich document context retains native whole-run rendering.
Stored message objects never change.
The original thinking-visibility settings remain unchanged.
Native mouse handlers keep their controls; collapsing a native body also closes its Lens disclosure.
Reload applies retained choices to rebuilt rows. Branch navigation discards abandoned disclosure choices.
Message shells and folded thinking drop verified boundary spacers, preserving prose and code whitespace.

Raw mode delegates to the original transcript renderer and clears Lens's activity status.
The public global-expansion flag distinguishes opening every row from opening an individual step.
Lens disclosure redraws pin the primary fullscreen viewport before the next layout pass.
Hover, streaming updates, mode commands, and raw rendering do not invoke that pin.
Pi 1.1 clears interior follow suppression during layout and resumes following after collapse clamping.
An instance-local layout guard preserves inspection through that clamp; explicit native scrolling still resumes follow-output.
Raw/global expansion and teardown remove the guard; unknown instance overrides are not patched.

Read [Views and compatibility](../reference/views.md) before relying on a particular interaction.
