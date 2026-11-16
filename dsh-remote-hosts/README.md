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
- Remote state (tunnel + proxy) shows *connecting / online / offline*, or
  *dormant* for a configured host nobody has opened yet; the actions menu
  reports the remote dsh version and service state once checked.
- Clicking the active sidebar row again or pressing Escape returns to the
  conversation; Escape first closes the actions menu when it is open. ⌘/Ctrl+1…9
  switches hosts. The browser half remembers the host that was on screen and
  reopens it after a reload, until you go back.
- Only the host you open gets an ssh tunnel and a proxy port. Other managed
  hosts stay dormant with no process and no bound port; a host you leave stops
  after `idleTimeout` (default 10 minutes, 0 disables) and reconnects the next
  time it is opened.
- An empty server list renders no rows; add one in the plugin settings.

## Connections

A row with `sshHost` is fully managed: one
`ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remotePort>` tunnel per endpoint and an
auth-injecting proxy on a free loopback port. The proxy reads the launch token
from the remote log over SSH, logs in, and attaches the cookie itself. It only
listens on 127.0.0.1 and refuses non-loopback Hosts, foreign Origins and
cross-site requests; frame navigation is the one allowed cross-site shape
because the desktop shell page runs on the `dsh-app://` scheme. Cross-site
fetches, XHR, WebSockets and subresources are still refused.

A tunnel is created when the browser opens the host, not when the plugin loads:
the overlay posts to `/api/remote-hosts/activate` when a row is selected, and
the Host starts that one link. Leaving the host releases it to the idle timer;
the 3s status poll is the on-screen host's heartbeat, so closing the window
also lets it go dormant. Tunnels and proxies are stopped when the plugin
unloads.

A row without `sshHost` is opened at its `url` as is (the old manual proxy).
A fixed `localPort` must be unique across rows; duplicates are reported in the
row status instead of letting the second tunnel fail to bind.

All Host routes live under `/api/remote-hosts/`: `status`, `activate`,
`reconnect`, `sync`, `update`, `probe`, `service` and `logs`. The platform requires a live
browser session for that prefix, which is what stops other local processes from
triggering a sync, update or service restart.

## Configuration

Edit the endpoints in the desktop app: **Plugins → Installed plugins →
dsh-remote-hosts → Configure**, or in the profile patch:

```yaml
- id: dsh-remote-hosts
  config:
    # Minutes of recent session writes counted before a restart is refused.
    sessionWindow: 10
    # Minutes an unused host keeps its tunnel before it goes dormant.
    idleTimeout: 10
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
| `sidebar` | Show the host as a row in the left sidebar (default true). Hidden hosts stay configured and openable from the settings card or the overlay switcher. The settings pin icon writes this field. |

The plugin-level `sessionWindow` (minutes, 1–1440, default 10) is not a server
field: it is the window the probe uses to decide whether the remote is busy. It
is passed to `bin/remote.sh probe --sessions-window N`.

The plugin-level `idleTimeout` (minutes, 0–1440, default 10) is how long an
opened host keeps its tunnel and proxy after it leaves the screen. The host on
screen is never stopped while the browser polls; 0 keeps every opened host
connected until the plugin unloads.

In the app the same settings are a compact card list:

- a card is added with one click and needs only a name plus **SSH-managed**
  host or **Direct URL**; the ID is derived from the name when left empty;
- ports, remote log, service descriptor and update target live under
  **Advanced settings** and keep their defaults when untouched;
- the pin icon toggles the left-sidebar row without deleting the host, and the
  arrows reorder it;
- the remaining card actions open the host, or remove the card.

Saving re-applies the sidebar registration immediately; no restart is needed
for a visibility or ordering change.

## Remote actions

The overlay's actions menu and the scripts share one behavior:

- **同步配置** — `bin/sync.sh`: mirror the local profile patch, AGENTS.md and
  provider keys, then restart the remote service (asks first). The menu also
  offers copy-only and `--dry-run` preview.
- **更新 dsh** — `bin/update.sh`: install the target dsh version with npm and
  restart the unit, then reload the frame. A per-row `updateChannel` overrides
  the "same as this app" default.
- **检测远端** — `bin/remote.sh probe`: one JSON summary with OS, dsh version,
  install path, node, service state/pid, port HTTP status, log token count and
  recent session activity (`sessions`: active count, files, newest age, up to
  two ids). Cached for a minute; the Host also returns it in the status payload.
- **重启/启动/停止远端服务** — `bin/remote.sh service restart|start|stop`: act
  on the unit and wait for it to settle. Start/stop appear once a check reports
  whether the service is currently active.
- **查看远端日志** — `bin/remote.sh logs`: the last 200 lines of the remote log,
  shown in the same panel as streaming actions.
- A failure shows the host's one-line summary (timeout, exit code, or the last
  lines of output) instead of a bare HTTP code.
- **Active-session guard** — before an update, a restarting sync, or a service
  restart/stop, the Host forces a fresh probe of `~/.dsh/sessions` (the top-level
  `sessionWindow`, default 10 minutes). When a session wrote a file inside that
  window the request stops with `code: "active-sessions"` plus the count and ids,
  and nothing runs. The overlay shows a second confirmation; choosing *run
  anyway* resends the request with `force: true`. An idle remote stays a
  one-click action, and an unreachable probe does not add a second step.

Scripts run without the UI too:

```sh
bin/sync.sh a100-146 --restart --profile web --unit dsh-web --kind systemd-user
bin/update.sh a100-146 --version 0.2.2-rc.3 --unit dsh-web --port 27993 --dry-run
bin/remote.sh a100-146 probe --sessions-window 10
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

Known follow-ups and their priorities live in
[docs/issues/roadmap.md](docs/issues/roadmap.md).

## Install

```sh
dsh plugin --profile desktop add /path/to/dsh-plugins/dsh-remote-hosts
```

Quit the desktop app before installing and restart it afterwards. Changes to the
Host half need a restart; the browser half is served from the same plugin.
