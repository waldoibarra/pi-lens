# Install and remove Lens

Use a local checkout while Pi Lens is unpublished.

Published Pi 1.1.0 supports Lens folds but lacks input-origin bindings.
`You` labels and extension-input folding require a host exposing input-origin bindings; installing Lens alone is insufficient.
Read [Views and compatibility](../reference/views.md#labels-and-retention) before relying on those labels.

## Load it for one invocation

From another project, pass the checkout directory:

```sh
pi -e /path/to/pi-lens
```

Replace `/path/to/pi-lens` with your checkout path.
Closing Pi unloads the extension. `/lens raw` restores native presentation without closing the session.

## Keep it installed

If your Pi settings are not managed elsewhere, run:

```sh
pi install /path/to/pi-lens
```

Restart Pi or run `/reload`. Enter `/lens` to verify the command is available.

To remove it:

```sh
pi remove /path/to/pi-lens
```

Restart Pi or run `/reload` again.

## Managed configuration

If another tool manages your Pi settings, update that configuration source instead of its installed copy.
Use `-e` for temporary validation without changing the package list. Lens itself writes no settings files.
After validation, manage an accepted immutable source revision through your normal configuration workflow.

Read [Views and compatibility](../reference/views.md) before combining Lens with other transcript renderers.
