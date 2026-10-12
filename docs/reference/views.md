# Views and compatibility

Pi Lens supports Pi **1.1.0**. Other host versions retain native rendering with a warning.
Origin-aware input labels and clipboard previews require the local host patches described below.

## Commands

| Command        | Behavior                                                |
| -------------- | ------------------------------------------------------- |
| `/lens`        | Reports the current view and available choices          |
| `/lens normal` | Counts mixed-tool runs and shows their first five steps |
| `/lens clean`  | Shows each run's count and latest failure               |
| `/lens raw`    | Restores native Pi rendering                            |

A run contains consecutive tool calls without visible assistant prose or thinking history between them.
Normal is the default for a new or resumed session. Reload preserves the view and expanded choices.
View changes redraw the existing transcript. Normal shows a single step without a redundant run header.

## Expansion

| Interaction                             | Result                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Click a clean fold                      | Lists its steps                                                                               |
| Click `+N more` or `show fewer`         | Changes the normal fold's visible step count; the toggle stays after the first five steps     |
| Click any tool step                     | Opens its original expanded row, including successful reads and historical calls              |
| Click an image read                     | Shows the native image first; `Details` opens the original technical read output              |
| Click a clipboard image                 | Shows its captured native image; `Details` exposes original input, path, MIME, and byte count |
| Click a question step                   | Shows the original row, plus recognized questions and answers when available                  |
| Click a voice request                   | Shows its original custom message                                                             |
| Click an extension input                | Shows every original native input row, including skill contents and arguments                 |
| Native tool expansion, default `Ctrl+O` | Reveals original tool rows and custom-message contents                                        |

Every Lens-collapsed tool step shows `▸` when closed and `▾` when open.
Reads, running tools, empty results, and waiting or skipped questions remain expandable.
Opening one step leaves its siblings folded. Click its header again to close it.
Normal-view run totals are informational: they neither toggle nor highlight. Use `+N more` for hidden steps.
Native global collapse closes individual tool, voice, clipboard, and extension-input details; run-fold choices remain unchanged.

Clickable headers highlight on hover using the current theme's selected background.
Hover requires fullscreen mode and terminal mouse-motion reporting; some multiplexer configurations suppress motion events.
Clicks require fullscreen mode. Regular mode retains native keyboard expansion and `/lens raw`.
Unlike Claude Code, Pi's `Ctrl+O` expands rows rather than opening a separate transcript screen.

Opening Lens details keeps the current fullscreen scroll position.
The clicked header and visible rows above it stay pinned where native scroll bounds allow.
Content expands below the header; scroll down to read it.
Collapse may clamp the viewport at its new bottom, but does not resume follow-output.
Streaming afterward preserves the clamped view until you scroll.
Scrolling back to the bottom resumes Pi's normal follow-output behavior.
Raw view and Pi's global expansion shortcut retain native scrolling behavior.

## Progress history

Each activity segment has one explicitly labeled thinking disclosure showing its latest provided update.
Visible prose and tool calls separate history segments; later activity stays below earlier work.
Live-voice delegation starts a separate request. Earlier headings remain available inside that segment's expanded history.

| State             | Display                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Closed            | `Thinking updates` plus the latest update and available count                               |
| Open              | Tight bulleted updates in chronological order, with details under each update               |
| New update        | Heading changes in place until visible prose starts a new segment                           |
| Thinking active   | One noninteractive `Thinking…` summary at the transcript tail, after notices and other work |
| Tools active      | The tail names observed running actions, including steps beyond the five-step preview       |
| Activity finishes | The active tail disappears; historical disclosures remain interactive                       |

Before thinking content arrives, Pi's native working indicator provides activity feedback.
Paragraph and code whitespace within an update is preserved.
Historical thinking remains expandable during streaming; opened details stay visible.
Verified native message-boundary spacers disappear in normal and clean views.
Markdown whitespace, tool output, image allocation, and unknown native spacing remain unchanged.
Document-wide references and content-changing Markdown transformers retain unsplit native rendering to preserve context.
Assistant prose, tool rows, errors, and truncation warnings stay visible outside the progress fold.
The heading comes from model-provided text; Lens makes no model calls to summarize it.
Later thinking after visible work starts a new historical disclosure instead of mutating earlier open history.
Keyboard access uses `/lens raw` and Pi's thinking toggle, normally `Ctrl+T`.

## Labels and retention

Normal shows one result fact per step when available. Clean omits facts but keeps delegated-agent model labels.
Known failures receive a plain explanation; normal also shows the first meaningful raw error line.

Observed replies and runs receive right-aligned timestamps. Bound native inputs use their exact message timestamp.
Published Pi 1.1.0 lacks native input-origin bindings; its inputs remain visible with neutral `Input` footers.
Lens does not match text, timestamps, or submission order to infer an input's origin.

The local Pi identity patch (`e988874`) binds input metadata to native message components.
With that patched host, normal and clean views use these rules:

| Bound origin                               | Presentation                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Composer                                   | Visible native input with one `You` footer                                   |
| Extension                                  | Collapsed `Extension input` header; click to reveal all original native rows |
| RPC, unknown, missing, or invalid metadata | Visible native input with a neutral `Input` footer                           |

Labels identify submission transport, not authenticated human or agent identity.
Header previews use original content; wording never determines origin or identifies a particular extension.
Skill contents and arguments share one disclosure only when bound to the exact same message object.
Host input IDs preserve disclosure choices across rebuilt rows and reload; branch changes prune abandoned choices.
Raw view and native global expansion recover the original rows, including regular-mode keyboard access.
Unknown inputs remain fully visible in both views. Native custom notices retain their own presentation.
Model labels come from the corresponding response, never the currently selected model.
Reply model labels use a warm accent with light/dark variants; folded tool-run labels remain muted grey.
Recognized model families use readable names, such as `GPT 6 Astra`, in reply, run, and delegated-agent labels.
Namespace prefixes and versions remain intact. Unfamiliar non-Claude identifiers remain unchanged.
Pi's bash tool lacks Claude Code's description field, so its fallback is `Ran a shell command`.

Lens retains metadata for 600 calls and 400 user and assistant timestamps.
Metadata limits do not restrict expansion. Old and resumed tool rows remain inspectable.
Lens adds no output-length or detail-age limits; expanded rows use their original native renderers.
Successful native image reads show the original image components before a secondary `Details` disclosure.
Their folded headers keep the submitted path, including directories when Pi received an ordinary file path.
Rows with failed, partial, unsupported, or conversion-unavailable images retain Pi's native rendering.
Unavailable image conversions retry after native invalidation; successful probes remain cached by width.
Unproven image reads keep their path labels; Lens never infers clipboard identity from read results.

Unobserved historical calls use individual fallback rows without invented timing or run grouping.
Lens cannot recover output the tool truncated or never stored, including unreported nested results.

## Clipboard images

Clipboard presentation requires the local host clipboard patch (`2572b39`), not published Pi 1.1.0 or identity-only hosts.
Those older hosts retain original input text without clipboard previews.

The host binds captured bytes and validated text ranges to the exact originating composer message.
Lens displays `[Image N]` only at those ranges; numbering belongs to that message, not visible-row order.
Typed paths, typed labels, Finder-copied files, and ordinary image reads remain unchanged.

Previews start collapsed in normal and clean views. Click the image header to open its native image.
`Details` reveals the complete original native input, original path, MIME type, and captured byte count.
Captured bytes remain in native previews and session metadata, never added as visible base64 text.
Lens renders captured bytes without reopening files, so deleted temporary files do not remove previews.
Unsupported image protocols use Pi's native image fallback.
Native global expansion exposes previews and details in both views, including regular-mode keyboard access.
`/lens raw` remains the original native transcript, without added clipboard previews.

Missing or invalid mappings retain original text and use the generic `Submitted clipboard image` label.
Changed Markdown, reference-dependent documents, and unsafe link destinations also retain native text and generic labels.
Other Markdown settings, transformers, code blocks, and references retain native rendering.
Input and attachment IDs preserve disclosure choices across reload; branch reconciliation prunes abandoned choices.
Stable native image IDs support resize, collapse, and Pi's own graphics cleanup.
Clipboard attribution shares the originating input's single `You` footer.

## Action summaries

Tool batches use observed nested-call metadata to describe their work, such as `Read AGENTS.md and state.ts`.
Mixed batches summarize their action counts. Nested failures remain visible even when the script catches them.
Expanding a batch reveals its native script, call list, and retained output.
When metadata is absent, Lens uses `Ran a tool batch` rather than guessing the script's purpose.

## Integrations

| Integration                | Contract                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pi-live-codex`            | Only `pi-live-codex-delegation` transcript messages fold; editor and voice controls remain native     |
| `pi-subagents`             | Single-model `details.results` metadata supplies delegated-model labels; mixed models are not guessed |
| Question tools             | Claude-compatible `questions` and `answers` records fold; unknown schemas retain native rendering     |
| Other custom tools         | Plain labels and generic counts; native expansion preserves their original renderer                   |
| Other transcript modifiers | Combination is unverified; do not stack competing grouping extensions                                 |

Live-voice request previews use the first text line. Expansion restores the entire native message.
Unknown custom messages, including warnings and permission prompts, remain untouched.
New `pi-subagents` wake inputs sent through `sendUserMessage` fold when the patched host binds extension origin.
Historical unbound wakes remain visible. Existing subagent custom-message folds and requests retain their native renderer.

## Parity limits

The target is Claude Code Lens at commit `ca16172`, with Pi-specific labels and controls.

- One transcript-tail summary owns Lens activity; the shared spinner remains native to protect other extensions.
- Fullscreen collapse protection wraps only Pi 1.1's recognized ScrollView instance; raw mode restores native layout.
- Unrecognized ScrollView overrides retain native behavior; exact collapse-follow suppression is not guaranteed there.
- Pi has no universal slash-command error hook; Lens leaves command notices native.
- Background-agent completion notices lack a universal model contract; Lens leaves those notices native.
- Unknown question schemas retain their original presentation.
- Raw presentation is Pi's rendering, including any other installed extensions.
- HTML export, RPC, JSON, and print output retain native behavior.

Read [How display-only folding works](../explanation/display-only.md) before changing these boundaries.
