# dsh-plugins

Plugins for DeepSeek Harness. Each directory is a self-contained plugin package.

| Plugin | What it does |
| --- | --- |
| [dsh-remote-hosts](dsh-remote-hosts/README.md) | Left-sidebar entries that open a remote dsh web instance in an overlay, with a managed ssh tunnel, connection state, settings sync, and remote dsh updates. |

Install a plugin from this checkout with:

    dsh plugin --profile desktop add <path-to-plugin-directory>

Then quit and restart the desktop app.
