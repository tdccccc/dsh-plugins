# dsh-plugins

Plugins for DeepSeek Harness. Each directory is a self-contained plugin package.

| Plugin | What it does |
| --- | --- |
| [dsh-remote-hosts](dsh-remote-hosts/README.md) | Manage multiple remote dsh web endpoints from the sidebar: managed ssh tunnels, connection state, settings sync, remote dsh updates, service control and log tailing. |

Install a plugin from this checkout with:

    dsh plugin --profile desktop add <path-to-plugin-directory>

Then quit and restart the desktop app.
