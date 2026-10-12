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

Transcript integration and guarded native input bindings live in `src/adapter.ts`.
Tool data conversion lives in `src/pi-data.ts`.
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
Published Pi 1.1.0 input events lack reliable message-to-row correlation; its inputs keep neutral `Input` labels.
Origin-aware hosts expose native `binding` metadata with exact `message`, `inputDisplay`, optional `entryId`, and row `part`.
Lens validates identity structurally, preserving compatibility with the pinned published peers.
Clipboard normalization uses optional namespace access to the host helper, never a missing named runtime export.
The helper receives the binding's exact message; only normalized composer captures enter the clipboard renderer.

Only exact message-object bindings group skill and argument rows; text and timestamps never establish identity.
Composer-origin rows receive `You`; extension-origin rows receive an expandable `Extension input` header.
RPC, unknown, malformed, conflicting, and missing origins remain neutral and visible.
Extension origin identifies transport, not a particular extension, agent, or authenticated sender.
Hand-edited session metadata is not an authentication boundary.

Input disclosures use stable host input IDs, independently of Lens's bounded observed-message cache.
Expansion delegates to every original native row; raw always bypasses the projection.
Global expansion retains native rows except clipboard groups, whose sidecar previews need Lens rendering.
Lens neither duplicates subagent custom-message renderers nor hides native requests and approvals.
Live-voice controls and editors remain outside this boundary.

## Captured images stay separate from paths

`src/clipboard.ts` projects only host-validated UTF-16 spans and renders captured bytes through native `Image` components.
It never scans paths, infers attachment identity, or reads image files.
Equal-column placeholders preserve generated labels through native Markdown parsing, wrapping, and syntax styling.
Original transformers run before projection; changed documents retain native output rather than guessed offsets.
Reference definitions, marker-bearing OSC links, invisible destinations, and unsupported mappings retain native rendering and generic labels.
Secondary details expose attachment path, MIME type, and byte count, never repeated native input or base64 dumps.
Captured bytes stay intact in native previews and session metadata.

The adapter forwards native invalidation to projected components, including hidden image caches.
Session-local native image IDs survive reload; active-branch reconciliation removes abandoned choices and IDs.
Pi's renderer owns graphics placement and cleanup when previews disappear.

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
