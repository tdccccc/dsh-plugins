# dsh-remote-hosts

Left-sidebar entries that open remote dsh web instances in a full-height overlay
over the main area: a managed ssh tunnel and auth proxy per endpoint, live
connection state, remote dsh updates, settings sync, service control and log
tailing.

One row is one **endpoint**, not one machine. Several rows may share an
`sshHost` with different ports/units, which is how a host running multiple dsh
instances is managed.

## How it works

- Each left-sidebar row selects the `remote-hosts/<id>` main panel. While that
  panel is selected a fixed overlay covers the main area, inset to the right of
  the left sidebar; the sidebar and the window chrome stay usable.
- A visited remote page stays mounted while the conversation is shown, so
  switching back and forth does not reload it. Reload is explicit.
- The overlay header carries back-to-conversation, a host switcher with a
  connection dot, the primary **同步配置** and **更新 dsh** actions, an actions
  menu (copy sync, preview sync, remote check, restart service, remote log,
  reload, open in browser), a status line, and a log toggle.
- Remote state (tunnel + proxy) shows *connecting / online / offline*; the
  actions menu reports the remote dsh version and service state once checked.
- Clicking the active sidebar row again or pressing Escape returns to the
  conversation. ⌘/Ctrl+1…9 switches hosts. The browser half remembers the host
  that was on screen and reopens it after a reload, until you go back.
- An empty server list renders no rows; add one in the plugin settings.

## Connections

A row with `sshHost` is fully managed: one
`ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remotePort>` tunnel per endpoint and an
auth-injecting proxy on a free loopback port. The proxy reads the launch token
from the remote log over SSH, logs in, and attaches the cookie itself. It only
listens on 127.0.0.1 and refuses non-loopback Hosts, foreign Origins and
cross-site requests; frame navigation is the one allowed cross-site shape
because the desktop shell page runs on the `dsh-app://` scheme. Cross-site
fetches, XHR, WebSockets and subresources are still refused. Tunnels are
stopped when the plugin unloads.

A row without `sshHost` is opened at its `url` as is (the old manual proxy).
A fixed `localPort` must be unique across rows; duplicates are reported in the
row status instead of letting the second tunnel fail to bind.

All Host routes live under `/api/remote-hosts/`: `status`, `reconnect`,
`sync`, `update`, `probe`, `service` and `logs`. The platform requires a live
browser session for that prefix, which is what stops other local processes from
triggering a sync, update or service restart.

## Configuration

Edit the endpoints in the desktop app: **Plugins → Installed plugins →
dsh-remote-hosts → Configure**, or in the profile patch:

```yaml
- id: dsh-remote-hosts
  config:
    servers:
      - id: gpu-1
        label: GPU box
        sshHost: user@gpu-1
        remotePort: 27993
        profile: web
        serviceKind: systemd-user
        serviceUnit: dsh-web
      - id: gpu-1-nightly
        label: GPU box (nightly)
        sshHost: user@gpu-1
        remotePort: 27995
        profile: web-nightly
        serviceKind: systemd-user
        serviceUnit: dsh-web-nightly
        updateChannel: next
      - id: lab-proxy
        label: Lab (manual proxy)
        url: http://127.0.0.1:27996/
```

| Field | Meaning |
| --- | --- |
| `id` | Stable key for panel ids and requests; unique, letters/digits/dashes, max 63. |
| `label` | Text in the sidebar and the header switcher. |
| `url` | Address of the remote dsh web instance; required only when there is no `sshHost`. |
| `sshHost` | SSH destination for the managed tunnel, sync, update and service actions. Empty opens `url` directly. |
| `remotePort` | Remote dsh web port, default 27993. |
| `localPort` | Fixed local tunnel port; 0 picks a free one. Must be unique when set. |
| `remoteLog` | Remote log the login token is read from; defaults to `~/.dsh/web-<remotePort>.log`. |
| `serviceKind` | `systemd-user` (default for ssh rows), `launchd-user`, `command`, or `external`. |
| `serviceUnit` | systemd unit or launchd label; defaults to `dsh-web` for the managed kinds. |
| `profile` | Remote profile directory under `~/.dsh/profiles`; default `web`. |
| `updateChannel` | Update target: empty mirrors this app's dsh version; otherwise an npm dist-tag (`latest`, `next`) or exact version. |

The same fields are available in the in-app form. Service fields are only
editable when the row has an SSH host; `url` becomes optional then.

## Remote actions

The overlay's actions menu and the scripts share one behavior:

- **同步配置** — `bin/sync.sh`: mirror the local profile patch, AGENTS.md and
  provider keys, then restart the remote service (asks first). The menu also
  offers copy-only and `--dry-run` preview.
- **更新 dsh** — `bin/update.sh`: install the target dsh version with npm and
  restart the unit, then reload the frame. A per-row `updateChannel` overrides
  the "same as this app" default.
- **检测远端** — `bin/remote.sh probe`: one JSON summary with OS, dsh version,
  install path, node, service state/pid, port HTTP status and log token count.
  Cached for a minute; the Host also returns it in the status payload.
- **重启远端服务** — `bin/remote.sh service restart`: restart the unit and wait
  for it to answer. `service start|stop` are available from the CLI.
- **查看远端日志** — `bin/remote.sh logs`: the last 200 lines of the remote log,
  shown in the same panel as streaming actions.
- A failure shows the host's one-line summary (timeout, exit code, or the last
  lines of output) instead of a bare HTTP code.

Scripts run without the UI too:

```sh
bin/sync.sh a100-146 --restart --profile web --unit dsh-web --kind systemd-user
bin/update.sh a100-146 --version 0.2.2-rc.3 --unit dsh-web --port 27993 --dry-run
bin/remote.sh a100-146 probe
bin/remote.sh a100-146 logs --lines 50
bin/remote.sh a100-146 service restart --dry-run
```

`update.sh` discovers the remote toolchain instead of assuming one: the service
names the Node that serves it, that Node's prefix owns the global
`@deepseek-ai/dsh` package, and the package's own npm replaces it in place. It
only installs and restarts when the target differs from what is installed. The
host needs Node >= 24.9 and a global npm install; anything else fails with the
discovered paths instead of guessing.

Restarting a service drops the login token the local proxy cached. The next
frame request gets a 401, the proxy logs in again with the token the restarted
server wrote to its log, and the reloaded frame is back on the new version.

## Development

```sh
cd dsh-remote-hosts
npm install
npm test            # node --test: config parsing, routes, client module, scripts
```

GitHub Actions runs the same suite on Ubuntu with Node 24. The remote helper
scripts are plain POSIX sh; their argument validation is covered by the tests,
but anything that talks to a real remote stays out of CI.

## Install

```sh
dsh plugin --profile desktop add /path/to/dsh-plugins/dsh-remote-hosts
```

Quit the desktop app before installing and restart it afterwards. Changes to the
Host half need a restart; the browser half is served from the same plugin.
