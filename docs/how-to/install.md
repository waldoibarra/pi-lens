# Install and remove Lens

Use a local checkout while Pi Lens is unpublished.

Published Pi 1.1.0 supports Lens folds but lacks input-origin bindings.
`You` labels and extension-input folding additionally require the local Pi identity patch; installing Lens alone is insufficient.
Read [Views and compatibility](../reference/views.md#labels-and-retention) before relying on those labels.

## Load it for one invocation

From another project, pass the checkout directory:

```sh
pi -e "$HOME/projects/personal/pi-lens"
```

Replace that path if your checkout lives elsewhere.
Closing Pi unloads the extension. `/lens raw` restores native presentation without closing the session.

## Keep it installed

If your Pi settings are not managed elsewhere, run:

```sh
pi install "$HOME/projects/personal/pi-lens"
```

Restart Pi or run `/reload`. Enter `/lens` to verify the command is available.

To remove it:

```sh
pi remove "$HOME/projects/personal/pi-lens"
```

Restart Pi or run `/reload` again.

## Use it with managed dotfiles

Waldo's Pi settings link into `.dotfiles`. A package-install command therefore changes tracked configuration.

For a first trial, use the explicit `-e` invocation from the dotfiles checkout.
Do not run `dots`, overwrite settings, or remove another agent's changes.
Lens itself writes no settings files.

After accepting the trial, add the package through the dotfiles repository's documented provisioning workflow.
The local path is workstation-specific; use a published, pinned package source when one becomes available.

Read [Views and compatibility](../reference/views.md) before combining Lens with other transcript renderers.
