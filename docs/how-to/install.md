# Install and remove Lens

Install Pi Lens from its pinned Git source.

Published Pi 1.1.0 and 1.2.0 support Lens folds but lack input-origin bindings.
`You` labels and extension-input folding require a host exposing input-origin bindings; installing Lens alone is insufficient.
Read [Views and compatibility](../reference/views.md#labels-and-retention) before relying on those labels.

## Load it for one invocation

From another project, pass the pinned Git source:

```sh
pi -e git:github.com/waldoibarra/pi-lens@v0.1.1
```

Closing Pi unloads the extension. `/lens raw` restores native presentation without closing the session.

## Keep it installed

If your Pi settings are not managed elsewhere, run:

```sh
pi install git:github.com/waldoibarra/pi-lens@v0.1.1
```

Restart Pi or run `/reload`. Enter `/lens` to verify the command is available.

To remove it:

```sh
pi remove git:github.com/waldoibarra/pi-lens@v0.1.1
```

Restart Pi or run `/reload` again.

## Managed configuration

If another tool manages your Pi settings, update that configuration source instead of its installed copy.
Use `-e` for temporary validation without changing the package list. Lens itself writes no settings files.
After validation, manage an accepted immutable source revision through your normal configuration workflow.
Pi Lens is a native Pi Git package; it is not published to npm.
Version tags are immutable. Update a configured version only after verifying the newer release.
The movable `latest` tag is a release alias; use a version tag for reproducible installations.

Read [Views and compatibility](../reference/views.md) before combining Lens with other transcript renderers.
