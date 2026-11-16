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
- The overlay header carries back-to-conversation, a searchable host switcher
  (grouped by `sshHost`, with a connection dot and an update marker), the
  primary **同步配置** and **更新 dsh** actions, an actions menu (copy sync,
  preview sync, remote check, restart service, remote log, reload, open in
  browser), a status line, and a log toggle.
- Remote state (tunnel + proxy) shows *connecting / online / offline*, or
  *dormant* for a configured host nobody has opened yet; the actions menu
  reports the remote dsh version and service state once checked.
- Clicking the active sidebar row again or pressing Escape returns to the
  conversation; Escape first closes the actions menu when it is open. ⌘/Ctrl+1…9
  switches hosts. The browser half remembers the host that was on screen and
  reopens it after a reload, until you go back.
- Only the host you open gets an ssh tunnel and a proxy port. Other managed
  hosts stay dormant with no process and no bound port; a host you leave closes
  its **local** tunnel and proxy after `idleTimeout` (default 10 minutes, 0
  disables) and reconnects the next time it is opened. The remote dsh-web
  service and its sessions keep running.
- An empty server list renders no rows; add one in the plugin settings.

## Connections

A row with `sshHost` is fully managed: one
`ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remotePort>` tunnel per endpoint and an
auth-injecting proxy on a free loopback port. The proxy reads the launch token
from the remote log over SSH (using the row's `tokenPattern`, default
`token=([A-Za-z0-9_-]+)`), logs in, and attaches the cookie itself.
The row's `sshOptions` are added as audited `-o` flags to the tunnel and the
token read, and are passed to the helper scripts through `DSH_SSH_OPTIONS`, so a
jump host or a non-default port works without editing `~/.ssh/config`. It only
listens on 127.0.0.1 and refuses non-loopback Hosts, foreign Origins and
cross-site requests; frame navigation is the one allowed cross-site shape
because the desktop shell page runs on the `dsh-app://` scheme. Cross-site
fetches, XHR, WebSockets and subresources are still refused.

A tunnel is created when the browser opens the host, not when the plugin loads:
the overlay posts to `/api/remote-hosts/activate` when a row is selected, and
the Host starts that one link. Leaving the host releases it to the idle timer;
the 3s status poll is the on-screen host's heartbeat, so closing the window
also lets it go dormant. This only stops the local ssh process and proxy
listener; nothing on the remote is restarted or stopped. Tunnels and proxies
are stopped when the plugin unloads.

A row without `sshHost` is opened at its `url` as is (the old manual proxy).
A fixed `localPort` must be unique across rows; duplicates are reported in the
row status instead of letting the second tunnel fail to bind.

All Host routes live under `/api/remote-hosts/`: `status`, `activate`,
`reconnect`, `sync`, `update`, `probe`, `service`, `provision` and `logs`. The
platform requires a live browser session for that prefix, which is what stops
other local processes from triggering a sync, update or service restart. Each
handler then re-checks the request itself: the Host must be loopback, an attached
Origin must be loopback or the same authority, `sec-fetch-site: cross-site` is
refused (frame navigation included), and a request with a body must be
`application/json`. A refusal is a 403 before any route logic runs.

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
        # Installed by the provision action / provision.sh, once per host.
        bundles: "@deepseek-ai/dsh-experimental-plugin-market-bundle dsh-context@0.78.0"
        # Settings sync: source profile, key subset, and the two optional files.
        syncSourceProfile: desktop
        syncKeys: "KEY_A, KEY_B"
        syncAgents: true
        syncPatch: true
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
| `tokenPattern` | POSIX ERE that finds the launch token in that log; the first capture group is the token. Empty uses `token=([A-Za-z0-9_-]+)`. |
| `sshOptions` | Audited `Key=Value` lines passed as `-o` to the tunnel, token read and helper scripts: `ProxyJump`, `IdentityFile`, `Port`, `User`, timeouts, keepalives. Values cannot contain spaces. |
| `serviceKind` | `systemd-user` (default for ssh rows), `launchd-user`, `command`, or `external`. |
| `serviceUnit` | systemd unit or launchd label; defaults to `dsh-web` for the managed kinds. |
| `profile` | Remote profile directory under `~/.dsh/profiles`; default `web`. |
| `updateChannel` | Update target: empty mirrors this app's dsh version; otherwise an npm dist-tag (`latest`, `next`) or exact version. |
| `bundles` | Space-separated dsh profile bundles installed by the provision action, e.g. `"dsh-context@0.78.0"`. Empty provisions a plain web profile. |
| `syncSourceProfile` | Local profile under `~/.dsh/profiles` mirrored by **同步配置**; default `desktop`. |
| `syncKeys` | Comma- or space-separated credential keys to copy; empty copies every top-level key in `~/.dsh/.credentials.yaml`. |
| `syncAgents` | Copy `~/.dsh/AGENTS.md` to the remote profile (default true). |
| `syncPatch` | Copy the source profile's patch layer to the remote profile (default true). |
| `sidebar` | Show the host as a row in the left sidebar (default true). Hidden hosts stay configured and openable from the settings card or the overlay switcher. The settings pin icon writes this field. |

The plugin-level `sessionWindow` (minutes, 1–1440, default 10) is not a server
field: it is the window the probe uses to decide whether the remote is busy. It
is passed to `bin/remote.sh probe --sessions-window N`.

The plugin-level `idleTimeout` (minutes, 0–1440, default 10) is how long an
opened host keeps its tunnel and proxy after it leaves the screen. The host on
screen is never stopped while the browser polls; 0 keeps every opened host
connected until the plugin unloads.

In the app the same settings are a compact card list:

- a saved card starts collapsed; click its title or chevron to expand the fields,
  and a new card starts expanded;
- a card is added with one click and needs only a name plus **SSH-managed**
  host or **Direct URL**; the ID is derived from the name (or the target) when
  left empty, a derived ID that is already taken gets `-2`, `-3`, … and a
  typed ID still has to be unique;
- ports, remote log, service descriptor and update target live under
  **Advanced settings** and keep their defaults when untouched;
- the pin icon toggles the left-sidebar row without deleting the host,
  **Show all in sidebar** marks every card visible again, and the arrows reorder
  rows;
- a filter box narrows cards by name, ID, SSH host or URL; drag the handle on a
  card to reorder it, and the arrows remain as the keyboard fallback. The host
  switcher in the overlay has the same filter and groups rows by `sshHost`;
- every saved SSH card has **测试连接**: it probes the saved configuration and
  writes the dsh version, service state and port HTTP into the card, or the
  probe failure reason when it cannot reach the host. A new card must be saved
  first; URL-only rows are not probed;
- switching **SSH-managed** / **Direct URL** keeps the other address in the
  draft, so an accidental switch does not erase it; saving writes only the
  selected side.
- the remaining card actions open the host, or remove the card.

Saving re-applies the sidebar registration immediately; no restart is needed
for a visibility or ordering change.

### Two kinds of sidebar pin

The pin on a settings card writes the host's `sidebar` field. It is part of the
saved configuration (the profile patch), applied immediately and kept across
restarts. **Show all in sidebar** marks every card visible again; save to apply.

The pin that appears when hovering a row in the platform's own sidebar is
separate: it belongs to the platform's panel list, lives only in memory, and
resets when the app restarts. The plugin cannot read that state, so it cannot
tell whether a missing row was hidden by this setting or unpinned by the
platform, and it cannot restore a platform pin. If a row ignores the plugin
switch after using the platform pin, restart the app or re-pin the row from the
platform sidebar.

## Remote actions

The overlay's actions menu and the scripts share one behavior:

- **一键部署** — `bin/provision.sh`: bootstrap a fresh Linux host with Node
  (pinned 24.12.0, checksum verified), a global dsh (the app's version by
  default), the `dsh`/`dsh-web` launchers, the systemd user unit, optional
  profile `bundles`, then the usual settings sync. Idempotent: existing pieces
  are reused, and the same action repairs a half-provisioned host.
- **同步配置** — `bin/sync.sh`: mirror the selected local profile patch,
  AGENTS.md and credential keys, then restart the remote service (asks first).
  The row chooses the source profile (`syncSourceProfile`), the key subset
  (`syncKeys`, empty means every top-level key) and whether AGENTS.md / the
  patch travel (`syncAgents`, `syncPatch`). The menu also offers copy-only and
  `--dry-run` preview.
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
  shown in the same panel as streaming actions. **跟随** switches the panel to
  a long-lived stream that appends new lines until **停止跟随**; stopping aborts
  the request, which kills the local ssh tail.
- A failure shows the host's one-line summary (timeout, exit code, or the last
  lines of output) instead of a bare HTTP code.
- **Update badge** — once a probe knows the remote dsh version, an older remote
  shows **可更新** in the overlay header/switcher and on its settings card. The
  target is the row's exact `updateChannel`, otherwise the version this app
  runs. Dist-tags (`latest`, `next`) are not resolved locally, so they never
  produce a badge; a newer remote (nightly while the app is stable) stays quiet.
  Nothing installs automatically.
- **One action per host** — sync, update, service and provision take a per-host
  lock. A double click or a second window gets `409 action-in-progress` and the
  overlay says *another action is already running* instead of starting a
  duplicate install or restart.
- **Active-session guard** — before an update, a restarting sync, or a service
  restart/stop, the Host forces a fresh probe of `~/.dsh/sessions` (the top-level
  `sessionWindow`, default 10 minutes). When a session wrote a file inside that
  window the request stops with `code: "active-sessions"` plus the count and ids,
  and nothing runs. The overlay shows a second confirmation; choosing *run
  anyway* resends the request with `force: true`. An idle remote stays a
  one-click action, and an unreachable probe does not add a second step.

Scripts run without the UI too:

```sh
bin/provision.sh user@host --port 27993 --profile web --unit dsh-web \
  --bundles "dsh-context@0.78.0" --sync
bin/sync.sh user@host --restart --profile web --unit dsh-web --kind systemd-user
bin/sync.sh user@host --restart --source-profile desktop --keys "KEY_A,KEY_B" \
  --no-agents --no-patch --profile web --unit dsh-web --kind systemd-user
bin/update.sh user@host --version 0.2.2-rc.3 --unit dsh-web --port 27993 --dry-run
bin/remote.sh user@host probe --sessions-window 10
bin/remote.sh user@host logs --lines 50
bin/remote.sh user@host logs --follow
bin/remote.sh user@host service restart --dry-run
DSH_SSH_OPTIONS='-o ProxyJump=user@jump -o Port=2222' bin/remote.sh user@host probe
```

`provision.sh` is the only script that installs a remote from scratch; sync and
update assume the service already exists. It needs sudo-free SSH, `curl`,
`tar` and `sha256sum` on the remote, and only handles `systemd-user` hosts
(launchd or externally managed units keep their manual setup). It installs Node under
`~/.local/node/v<version>` and never touches a system Node.

The official Node tarball is glibc-based: Ubuntu 20.04+/Debian 10+ works, while
Alpine/musl or glibc older than 2.28 fails with an explicit message instead of a
broken runtime. When nodejs.org is unreachable the download retries the same
file from npmmirror and still verifies the official checksum.

`update.sh` discovers the remote install instead of assuming npm: the running
service names the Node, the dsh entry names the package root, and the global
root that owns that package (npm or pnpm) chooses the upgrade command. It only
installs and restarts when the target differs from what is installed. An
unknown layout prints the discovered Node, npm and pnpm roots plus the manual
`npm install -g` / `pnpm add -g` command instead of guessing. The host needs
Node >= 24.9.

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

Documentation and examples use placeholders only (`user@host`, `gpu-1`,
`/path/to`). Keep real hostnames, local paths, account names and tokens out of
the repository and its commit messages.

Known follow-ups and their priorities live in
[docs/issues/roadmap.md](docs/issues/roadmap.md).

## Install

```sh
dsh plugin --profile desktop add /path/to/dsh-plugins/dsh-remote-hosts
```

Quit the desktop app before installing and restart it afterwards. Changes to the
Host half need a restart; the browser half is served from the same plugin.
