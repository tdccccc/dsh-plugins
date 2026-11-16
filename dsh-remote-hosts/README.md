# dsh-remote-hosts

Left-sidebar entries that open a remote dsh web instance in a full-height overlay
over the main area, with a managed ssh tunnel, live connection state, a sync
button that mirrors local settings onto that host, and an update action that
installs this app's dsh version there.

## How it works

- Each left-sidebar row selects the `remote-hosts/<id>` main panel. While that
  panel is selected a fixed overlay covers the main area, inset to the right of
  the left sidebar; the sidebar and the window chrome stay usable. The overlay
  does not use the right sidebar.
- A visited remote page stays mounted while the conversation is shown, so
  switching back and forth does not reload it. Reload is explicit.
- The overlay header carries back-to-conversation, one button per server with a
  connection dot, sync and update actions, a log toggle, reload and
  open-in-browser.
  Clicking the active sidebar row again or pressing Escape returns to the
  conversation. ⌘/Ctrl+1…9 switches hosts.
- The browser half remembers the host that was on screen and reopens it after a
  reload, until you go back to the conversation.

## Connections

A server with `sshHost` is fully managed by the plugin: it starts one
`ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remotePort>` tunnel per host and an
auth-injecting proxy on a free loopback port, shows *connecting / online /
offline* in the header, and replaces the frame with the error and a retry button
when the host is unreachable. Tunnels are stopped when the plugin unloads.

The proxy reads the launch token from the remote log over SSH, logs in, and
attaches the cookie itself, so no LaunchAgent or manual `ssh -L` is needed. It
only listens on 127.0.0.1 and refuses non-loopback Hosts, foreign Origins, and
cross-site requests. The frame navigation is the one exception: the desktop
shell page runs on the `dsh-app://` scheme, so its iframe is cross-site by
construction (navigate mode, `Sec-Fetch-Dest: iframe`). Cross-site fetches,
XHR, WebSockets, and subresources are still refused.

A server without `sshHost` is opened at its `url` as is (the old manual proxy).

All Host routes live under `/api/remote-hosts/` (`status`, `reconnect`,
`sync`, `update`). The platform requires a live browser session for that prefix,
which is what stops other local processes from triggering a sync, an update, or
a restart.

## Configuration

Edit the servers in the desktop app: **Plugins → Installed plugins →
dsh-remote-hosts → Configure** (or the bundle's page). The form writes the
plugin's `servers` config through the settings service. The same list can be
edited in the profile patch:

```yaml
- id: dsh-remote-hosts
  config:
    servers:
      - id: a100-146
        label: A100-146
        url: http://127.0.0.1:27994/
      - id: gpu-1
        label: GPU box
        url: http://127.0.0.1:27995/
        sshHost: user@gpu-1
```

- `id` is the stable key used by the sidebar panel and by the sync request; it
  must be unique and may contain letters, digits, and dashes (max 63).
- `label` is the text shown in the sidebar and the overlay header.
- `url` is the local address of the remote dsh web instance; optional for a
  managed host, whose address is the proxy the plugin picks.
- `sshHost` turns on the managed tunnel and the update action; empty uses
  `url` directly.
- `remotePort` is the dsh web port on the remote machine (default 27993),
  `localPort` a fixed tunnel port (0 picks a free one), and `remoteLog` the
  remote log the login token is read from (default
  `~/.dsh/web-<remotePort>.log`).
- `bin/sync.sh` runs against `sshHost`, or `id` when no sshHost is set.

An empty or unusable list falls back to the built-in `a100-146` entry. The
browser half keeps the same entry as a fallback when the Host route is
unavailable.

## Sync

`bin/sync.sh` mirrors the local profile patch, AGENTS.md and provider keys onto
the host. The overlay offers:

- **同步配置** — copy, restart `dsh-web`, then reload the frame. Asks first,
  because restarting interrupts sessions running on the remote.
- **只同步不重启** — copy only; the remote picks it up at its next restart.
- **预览** — `--dry-run`, shows the plan without copying anything.
- **日志** — streams the script's stdout/stderr live while it runs.
- A failure shows the host's one-line summary (timeout, exit code, or the last
  lines of output) instead of the old bare "HTTP 200".

## Update

The overlay's **更新 dsh / Update dsh** button installs the dsh version this
desktop app runs on the host, restarts its `dsh-web` unit, and reloads the
frame. It only shows for managed hosts (those with `sshHost`). The confirmation
names the version and warns that the restart interrupts sessions running on the
remote, so trigger it when that host is idle.

`bin/update.sh` is the same code without the button:

    bin/update.sh a100-146                        # latest published version
    bin/update.sh a100-146 --version 0.2.2-rc.3   # the version this app runs
    bin/update.sh a100-146 --tag next --dry-run   # resolve and print the plan
    bin/update.sh a100-146 --no-restart           # install only

It discovers the remote toolchain instead of assuming one: the running
`dsh-web` unit names the Node that serves it, that Node's prefix owns the global
`@deepseek-ai/dsh` package, and the package's own npm replaces it in place. The
script only installs and restarts when the target differs from the installed
version; a dry run touches nothing. `--port` selects the port checked after the
restart (the plugin passes the host's `remotePort`).

The host needs Node >= 24.9 and a global npm install of dsh. Anything else (pnpm
global layouts, mismatched npm prefixes) fails with the discovered paths instead
of guessing. Restarting `dsh-web` drops the login token the local proxy cached;
the next frame request gets a 401, the proxy logs in again with the token the
restarted server wrote to its log, and the reloaded frame is back on the new
version.

## Install

    dsh plugin --profile desktop add /Users/tiandc/dsh/dsh-remote-hosts

Quit the desktop app before installing and restart it afterwards.
