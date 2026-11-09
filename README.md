# dsh-remote-hosts

Left-sidebar entries that open a remote dsh web instance inside the desktop app,
plus a sync button that mirrors local settings onto that host.

## How it works

- Each left-sidebar row opens a persistent overlay to the right of the sidebar.
  The remote page stays mounted, so switching back and forth never reloads it.
- The overlay header carries a back-to-conversation button, one button per
  server, a sync button, and reload.
- The Host half registers POST /remote-hosts/sync, which runs
  bin/sync.sh with --restart for a host on its allowlist.

## Configuration

Servers live in client.js and in the HOSTS allowlist of index.js:

    { id: 'a100-146', label: 'A100-146', url: 'http://127.0.0.1:27994/' }

The URL is a local auth-injecting proxy in front of the remote dsh web instance.
bin/sync.sh mirrors the local profile patch, AGENTS.md, and provider keys.

## Install

    dsh plugin --profile desktop add /Users/tiandc/dsh

Quit the desktop app before installing and restart it afterwards.
