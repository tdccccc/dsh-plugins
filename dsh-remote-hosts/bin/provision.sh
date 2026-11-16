#!/bin/sh
# Provision a fresh Linux host for dsh web: a pinned Node >= 24.9 toolchain, a
# global dsh install, the dsh/dsh-web launchers, a systemd user unit, optional
# profile bundles, and an optional settings/keys sync.
#
#   bin/provision.sh <ssh-host> [--port N] [--unit U] [--profile NAME]
#     [--node-version V] [--dsh-version V|next|latest]
#     [--bundles "pkg[@ver] ..."] [--sync] [--force] [--dry-run]
#
# Only systemd-user hosts are provisioned. The command is idempotent: existing
# Node, dsh, unit, and bundles are reused unless --force is given.
set -eu

# The plugin passes audited "-o Key=Value" options through this variable; only
# validated tokens, so the unquoted expansion is safe.
SSH_OPTS=${DSH_SSH_OPTIONS:-}

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

if [ $# -lt 1 ]; then
  printf 'usage: provision.sh <ssh-host> [--port N] [--unit U] [--profile NAME] [--node-version V] [--dsh-version V] [--bundles "pkg[@ver] ..."] [--sync] [--force] [--dry-run]\n' >&2
  exit 2
fi

HOST=$1
shift
PORT=27993
UNIT=dsh-web
PROFILE=web
NODE_VERSION=24.12.0
DSH_VERSION=next
BUNDLES=
SYNC=0
FORCE=0
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT=${1:?"--port needs a value"} ;;
    --unit) shift; UNIT=${1:?"--unit needs a value"} ;;
    --profile) shift; PROFILE=${1:?"--profile needs a value"} ;;
    --node-version) shift; NODE_VERSION=${1:?"--node-version needs a value"} ;;
    --dsh-version) shift; DSH_VERSION=${1:?"--dsh-version needs a value"} ;;
    --bundles) shift; BUNDLES=${1:?"--bundles needs a value"} ;;
    --sync) SYNC=1 ;;
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

case "$PORT" in ''|*[!0-9]*) die "bad port: $PORT" ;; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "bad port: $PORT"
case "$UNIT" in *[!A-Za-z0-9@._:-]*) die "bad unit: $UNIT" ;; esac
case "$PROFILE" in *[!A-Za-z0-9._-]*) die "bad profile: $PROFILE" ;; esac
case "$NODE_VERSION" in ''|*[!0-9.]*) die "bad node version: $NODE_VERSION" ;; esac
case "$DSH_VERSION" in next|latest) ;; *[!A-Za-z0-9.+-]*) die "bad dsh version: $DSH_VERSION" ;; esac
if [ -n "$BUNDLES" ]; then
  for spec in $BUNDLES; do
    case "$spec" in *[!A-Za-z0-9@/._:+-]*) die "bad bundle spec: $spec" ;; esac
  done
fi
if [ "$SYNC" = 1 ] && [ ! -x "$(dirname "$0")/sync.sh" ]; then
  die "bin/sync.sh is missing; cannot --sync"
fi

REMOTE=$(mktemp)
trap 'rm -f "$REMOTE"' EXIT
cat > "$REMOTE" <<'REMOTE'
#!/bin/sh
set -eu

PORT=$1
UNIT=$2
PROFILE=$3
NODE_VERSION=$4
DSH_VERSION=$5
BUNDLES=$6
FORCE=$7
DRY=$8

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

NODE_BIN="$HOME/.local/node/v$NODE_VERSION/bin"
NODE_ARCHIVE="node-v$NODE_VERSION-linux"
NODE_BASE=https://nodejs.org/dist
NODE_MIRROR=https://npmmirror.com/mirrors/node
LOG="$HOME/.dsh/web-$PORT.log"
UNIT_FILE="$HOME/.config/systemd/user/$UNIT.service"

[ "$(uname -s)" = Linux ] || die "provisioning supports Linux hosts with systemd --user only"
command -v systemctl >/dev/null 2>&1 || die "systemd is required on the remote host"

# The official Node tarball is built against glibc: Ubuntu 20.04+/Debian 10+
# works, Alpine/musl and older distros need Node installed another way.
LIBC=$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')
if [ -z "$LIBC" ]; then
  LIBC_RAW=$( (ldd --version 2>&1 || true) | head -1)
  case "$LIBC_RAW" in
    *musl*) die "this host uses musl libc (Alpine?); install Node 24 manually and rerun without --node-version" ;;
    *) LIBC=$(printf '%s' "$LIBC_RAW" | sed -n 's/.*GLIBC [^0-9]*\([0-9][0-9.]*\).*/\1/p') ;;
  esac
fi
[ -n "$LIBC" ] || die "could not detect the libc version; the official Node 24 build needs glibc 2.28+"
awk -v v="$LIBC" 'BEGIN { split(v, p, "."); exit !(p[1] > 2 || (p[1] == 2 && p[2] >= 28)) }' \
  || die "glibc $LIBC is too old for Node 24 (needs 2.28+; Ubuntu 20.04+/Debian 10+)"

if [ "$DRY" = 1 ]; then
  say "host:      $(hostname)"
  say "os:        $(grep -m1 PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '\"')"
  say "libc:      glibc $LIBC"
  say "node:      $(if [ -x "$NODE_BIN/node" ]; then "$NODE_BIN/node" -v; else echo missing; fi)"
  say "dsh:       $(if [ -x "$NODE_BIN/dsh" ]; then PATH="$NODE_BIN:$PATH" "$NODE_BIN/dsh" --version 2>&1 || echo broken; else echo missing; fi)"
  say "unit:      $(if [ -f "$UNIT_FILE" ]; then echo present; else echo missing; fi)"
  say "service:   $(systemctl --user is-active "$UNIT" 2>/dev/null || true)"
  say "bundles:   $(if [ -n "$BUNDLES" ]; then echo "$BUNDLES"; else echo none; fi)"
  say "plan:      node $NODE_VERSION, dsh $DSH_VERSION, port $PORT, profile $PROFILE"
  exit 0
fi

if [ "$FORCE" = 1 ] || [ ! -x "$NODE_BIN/node" ]; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
  command -v tar >/dev/null 2>&1 || die "tar is required"
  say "== node $NODE_VERSION =="
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  cd "$TMP"
  FILE="$NODE_ARCHIVE-$ARCH.tar.gz"
  BASE=$NODE_BASE
  if ! curl -fsSL --retry 3 -o "$FILE" "$BASE/v$NODE_VERSION/$FILE"; then
    say "nodejs.org unreachable; retrying the same file from npmmirror"
    BASE=$NODE_MIRROR
    curl -fsSL --retry 3 -o "$FILE" "$BASE/v$NODE_VERSION/$FILE" || die "could not download $FILE"
  fi
  curl -fsSL --retry 3 -o SHASUMS256.txt "$BASE/v$NODE_VERSION/SHASUMS256.txt" || die "could not download node checksums"
  grep " $FILE\$" SHASUMS256.txt | sha256sum -c - >/dev/null || die "node checksum mismatch"
  tar -xzf "$FILE"
  rm -rf "$HOME/.local/node/v$NODE_VERSION"
  mkdir -p "$HOME/.local/node"
  mv "$NODE_ARCHIVE-$ARCH" "$HOME/.local/node/v$NODE_VERSION"
  cd "$HOME"
  say "node:      $("$NODE_BIN/node" -v)"
else
  say "node:      $("$NODE_BIN/node" -v) (reused)"
fi

export PATH="$NODE_BIN:$PATH"

if [ "$DSH_VERSION" = next ] || [ "$DSH_VERSION" = latest ]; then
  DSH_VERSION=$("$NODE_BIN/npm" view "@deepseek-ai/dsh@$DSH_VERSION" version 2>/dev/null | tail -1)
  [ -n "$DSH_VERSION" ] || die "could not resolve the dsh version"
fi
CURRENT=$("$NODE_BIN/dsh" --version 2>/dev/null || true)
if [ "$FORCE" = 0 ] && [ "$CURRENT" = "$DSH_VERSION" ]; then
  say "dsh:       $CURRENT (reused)"
else
  say "== dsh $DSH_VERSION =="
  ALLOW=
  if "$NODE_BIN/npm" install --help 2>/dev/null | grep -q -- '--allow-scripts'; then
    ALLOW=--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs
  fi
  "$NODE_BIN/npm" install -g --no-audit --no-fund $ALLOW "@deepseek-ai/dsh@$DSH_VERSION" || die "dsh install failed"
  CURRENT=$("$NODE_BIN/dsh" --version)
  [ "$CURRENT" = "$DSH_VERSION" ] || die "installed dsh is $CURRENT, expected $DSH_VERSION"
  say "dsh:       $CURRENT"
fi

mkdir -p "$HOME/.local/bin" "$HOME/.dsh"
cat > "$HOME/.local/bin/dsh" <<LAUNCHER
#!/bin/sh
# dsh 0.2.x requires Node >= 24.9; pin the provisioned Node toolchain.
NODE_BIN="\$HOME/.local/node/v$NODE_VERSION/bin"
PATH="\$NODE_BIN:\$PATH"
export PATH
exec "\$NODE_BIN/dsh" "\$@"
LAUNCHER
cat > "$HOME/.local/bin/dsh-web" <<LAUNCHER
#!/bin/sh
# Launch the dsh web UI provisioned for this host.
# Older layouts keep DEEPSEEK_API_KEY in ~/.dsh/.credentials.yaml; never clobber
# a value the systemd environment already provides.
if [ -z "\${DEEPSEEK_API_KEY:-}" ]; then
  DEEPSEEK_API_KEY=$(grep -m1 'DEEPSEEK_API_KEY' "\$HOME/.dsh/.credentials.yaml" 2>/dev/null | sed -E 's/.*DEEPSEEK_API_KEY: *//')
  export DEEPSEEK_API_KEY
fi
export DSH_PERMISSION_MODE="\${DSH_PERMISSION_MODE:-danger-full-access}"
exec "\$HOME/.local/bin/dsh" --profile "$PROFILE" --port "$PORT" --no-open "\$@"
LAUNCHER
chmod +x "$HOME/.local/bin/dsh" "$HOME/.local/bin/dsh-web"

mkdir -p "$HOME/.config/systemd/user"
if [ -f "$UNIT_FILE" ] && [ "$FORCE" = 0 ]; then
  say "unit:      $UNIT_FILE (kept; pass --force to rewrite)"
else
  cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=DeepSeek Harness web UI ($(hostname))
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=-%h/.dsh/remote.env
Type=simple
# stdout is unbuffered so the auth proxy can read the launch token from this log.
ExecStart=/bin/sh -c 'exec "\$HOME/.local/bin/dsh-web" >> "\$HOME/.dsh/web-$PORT.log" 2>&1'
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=20

[Install]
WantedBy=default.target
UNIT
  say "unit:      $UNIT_FILE"
fi

loginctl enable-linger "$(whoami)" 2>/dev/null || say "linger:    could not enable (service stops after logout)"
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null 2>&1 || die "could not enable $UNIT"
systemctl --user restart "$UNIT" || die "could not start $UNIT"

wait_health() {
  i=0
  while [ $i -lt 40 ]; do
    state=$(systemctl --user is-active "$UNIT" 2>/dev/null || true)
    token=$(grep -o 'token=[A-Za-z0-9_-]*' "$LOG" 2>/dev/null | tail -1 || true)
    # An old token line proves nothing: the log survives restarts, so wait for
    # the port to answer before calling the service healthy.
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$PORT/" || true)
    if [ "$state" = active ] && [ -n "$token" ] && [ "$code" != "000" ]; then
      say "service:   $state, http $code on 127.0.0.1:$PORT"
      return 0
    fi
    i=$((i+1))
    sleep 1
  done
  die "service did not become healthy; check: journalctl --user -u $UNIT"
}
wait_health

if [ -n "$BUNDLES" ]; then
  say "== profile bundles =="
  if ! command -v pnpm >/dev/null 2>&1; then
    "$NODE_BIN/npm" install -g --no-audit --no-fund pnpm@10 >/dev/null || die "could not install pnpm"
  fi
  node - "$HOME/.dsh/profiles/$PROFILE" $BUNDLES <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [dir, ...specs] = process.argv.slice(2);
const file = path.join(dir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [];
pkg.dependencies = pkg.dependencies || {};
for (const spec of specs) {
  const match = /^(@[^/]+\/[^@]+|[^@]+)(?:@(.+))?$/.exec(spec);
  if (!match) throw new Error('bad bundle spec: ' + spec);
  const name = match[1];
  if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name);
  if (match[2]) pkg.dependencies[name] = match[2];
}
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
NODE
  "$HOME/.local/bin/dsh" plugin --profile "$PROFILE" install || die "profile bundle install failed"
  systemctl --user restart "$UNIT" || die "could not restart $UNIT after bundles"
  wait_health
fi
REMOTE

quote() { printf "'%s'" "$1"; }
ARGV="$(quote "$PORT") $(quote "$UNIT") $(quote "$PROFILE") $(quote "$NODE_VERSION") $(quote "$DSH_VERSION") $(quote "$BUNDLES") $(quote "$FORCE") $(quote "$DRY")"

say "== $HOST =="
ssh $SSH_OPTS -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "sh -s -- $ARGV" < "$REMOTE" || die "provisioning failed on $HOST"

if [ "$SYNC" = 1 ] && [ "$DRY" = 0 ]; then
  HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  "$HERE/sync.sh" "$HOST" --restart --profile "$PROFILE" --port "$PORT" --unit "$UNIT" --kind systemd-user || die "settings sync after provisioning failed"
fi
say "done:      $HOST"
