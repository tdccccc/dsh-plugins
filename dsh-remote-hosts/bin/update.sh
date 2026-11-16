#!/bin/sh
# Update the dsh CLI that serves a remote host, then restart its web unit.
#
#   bin/update.sh a100-146                       # latest published version
#   bin/update.sh a100-146 --version 0.2.2-rc.3  # the version this app runs
#   bin/update.sh a100-146 --tag next --dry-run
#   bin/update.sh a100-146 --no-restart
#   bin/update.sh a100-146 --unit dsh-web-2 --port 27995
#
# --unit NAME (default dsh-web), --kind KIND (systemd-user | launchd-user |
# command | external) and --port N follow the same service descriptor the
# plugin config uses.
#
# The remote side is discovered rather than assumed: the running unit names
# the Node that serves it, that Node's prefix owns the global @deepseek-ai/dsh
# package, and the package's own npm replaces it in place.
# Progress goes to stdout and failures to stderr so the plugin can show both.
set -eu

if [ $# -lt 1 ]; then
  printf 'usage: update.sh <ssh-host> [--version V | --tag T] [--port N] [--unit NAME] [--kind KIND] [--dry-run] [--no-restart]\n' >&2
  exit 2
fi
HOST=$1
shift

VERSION=""
TAG=""
PORT=27993
UNIT=dsh-web
KIND=systemd-user
DRY=0
RESTART=1
while [ $# -gt 0 ]; do
  case "$1" in
    --version) shift; [ $# -gt 0 ] || { printf '%s\n' '--version needs a value' >&2; exit 2; }; VERSION=$1 ;;
    --tag) shift; [ $# -gt 0 ] || { printf '%s\n' '--tag needs a value' >&2; exit 2; }; TAG=$1 ;;
    --port) shift; [ $# -gt 0 ] || { printf '%s\n' '--port needs a value' >&2; exit 2; }; PORT=$1 ;;
    --unit) shift; [ $# -gt 0 ] || { printf '%s\n' '--unit needs a value' >&2; exit 2; }; UNIT=$1 ;;
    --kind) shift; [ $# -gt 0 ] || { printf '%s\n' '--kind needs a value' >&2; exit 2; }; KIND=$1 ;;
    --dry-run) DRY=1 ;;
    --no-restart) RESTART=0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# The values travel inside the remote command string; only plain versions,
# tags, and ports are accepted so none of them can become a second command.
case "$VERSION" in *[!A-Za-z0-9._+-]*) printf 'bad version: %s\n' "$VERSION" >&2; exit 2 ;; esac
case "$TAG" in *[!A-Za-z0-9._+-]*) printf 'bad tag: %s\n' "$TAG" >&2; exit 2 ;; esac
case "$PORT" in ''|*[!0-9]*) printf 'bad port: %s\n' "$PORT" >&2; exit 2 ;; esac
case "$UNIT" in *[!A-Za-z0-9@._:-]*) printf 'bad unit: %s\n' "$UNIT" >&2; exit 2 ;; esac
case "$KIND" in systemd-user|launchd-user|command|external) ;; *) printf 'bad kind: %s\n' "$KIND" >&2; exit 2 ;; esac

printf '== %s ==\n' "$HOST"

# One remote shell carries the whole probe and update so every step sees the
# same toolchain; sh -s reads the payload below from stdin.
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "sh -s -- '$VERSION' '$TAG' '$PORT' '$RESTART' '$DRY' '$UNIT' '$KIND'" <<'REMOTE'
set -u
VERSION=$1
TAG=$2
PORT=$3
RESTART=$4
DRY=$5
UNIT=$6
KIND=$7

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

# -- toolchain -------------------------------------------------------------
# The running unit is authoritative: its MainPID is the interpreter that
# loaded the installed package, so that prefix owns the copy to replace even
# when several Node versions live side by side.
NODE_BIN=""
case "$KIND" in
  systemd-user)
    if command -v systemctl >/dev/null 2>&1; then
      PID=$(systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null || true)
    fi
    ;;
  launchd-user)
    if command -v launchctl >/dev/null 2>&1; then
      PID=$(launchctl print "gui/$(id -u)/$UNIT" 2>/dev/null | awk '/^[[:space:]]*pid = /{print $3; exit}' || true)
    fi
    ;;
  *) PID=""
     ;;
esac
case "$PID" in
  ''|0|*[!0-9]*) ;;
  *)
    EXE=$(readlink -f "/proc/$PID/exe" 2>/dev/null || true)
    case "$EXE" in
      */bin/node) NODE_BIN=$(dirname "$EXE") ;;
    esac
    ;;
esac

# With the unit down, the launcher pins the same toolchain. Follow the shell's
# own trace of its exec instead of parsing the pin, so any form of it works.
if [ -z "$NODE_BIN" ] && [ -x "$HOME/.local/bin/dsh" ]; then
  EXEC=$(sh -x "$HOME/.local/bin/dsh" -V 2>&1 >/dev/null | sed -n 's/^+ exec \(.*\)\/dsh .*/\1/p' | tail -1)
  case "$EXEC" in
    /*) [ -x "$EXEC/node" ] && NODE_BIN=$EXEC ;;
  esac
fi

# Last resort: whatever nvm or PATH offers, as long as it is new enough to run
# current dsh; the launcher above still decides which copy the unit starts.
if [ -z "$NODE_BIN" ]; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
    nvm use 24 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
  fi
  DSH_BIN=$(command -v dsh 2>/dev/null || true)
  [ -n "$DSH_BIN" ] || die "could not find dsh or the Node installation that serves it"
  EXE=$(readlink -f "$DSH_BIN" 2>/dev/null || true)
  [ -n "$EXE" ] || die "could not resolve the dsh executable"
  NODE_BIN=$(dirname "$EXE")
fi
[ -n "$NODE_BIN" ] || die "could not find the Node installation that serves dsh-web"

PATH="$NODE_BIN:$PATH"
export PATH
NODE="$NODE_BIN/node"
NPM="$NODE_BIN/npm"
[ -x "$NODE" ] || die "missing node under $NODE_BIN"
[ -x "$NPM" ] || die "missing npm under $NODE_BIN; update dsh manually"
NODE_VERSION=$("$NODE" -v 2>/dev/null || true)
NODE_MAJOR=$(printf '%s' "$NODE_VERSION" | sed 's/^v\([0-9]*\).*/\1/')
NODE_MINOR=$(printf '%s' "$NODE_VERSION" | sed 's/^v[0-9]*\.\([0-9]*\).*/\1/')
case "$NODE_MAJOR" in ''|*[!0-9]*) die "could not read the Node version" ;; esac
case "$NODE_MINOR" in ''|*[!0-9]*) NODE_MINOR=0 ;; esac
if [ "$NODE_MAJOR" -lt 24 ] || { [ "$NODE_MAJOR" -eq 24 ] && [ "$NODE_MINOR" -lt 9 ]; }; then
  die "dsh needs Node >= 24.9; $NODE is $NODE_VERSION"
fi

# -- installed package -----------------------------------------------------
NPM_PREFIX=$(PATH="$NODE_BIN:$PATH" "$NPM" prefix -g 2>/dev/null | tail -1 || true)
[ -n "$NPM_PREFIX" ] || die "could not read the npm global prefix"
NODE_PREFIX=$(CDPATH= cd -- "$NODE_BIN/.." && pwd -P)
NPM_PREFIX=$(CDPATH= cd -- "$NPM_PREFIX" 2>/dev/null && pwd -P || printf '%s' "$NPM_PREFIX")
[ "$NPM_PREFIX" = "$NODE_PREFIX" ] \
  || die "npm installs into $NPM_PREFIX but dsh runs from $NODE_PREFIX; align npm's prefix first"

PKG="$NODE_PREFIX/lib/node_modules/@deepseek-ai/dsh"
[ -f "$PKG/package.json" ] || die "missing $PKG/package.json; update dsh manually"
CURRENT=$("$NODE" -p 'require(process.argv[1]).version' "$PKG/package.json" 2>/dev/null || true)
[ -n "$CURRENT" ] || die "could not read the installed dsh version from $PKG/package.json"

if [ -n "$VERSION" ]; then
  SPEC="@deepseek-ai/dsh@$VERSION"
elif [ -n "$TAG" ]; then
  SPEC="@deepseek-ai/dsh@$TAG"
else
  SPEC="@deepseek-ai/dsh@latest"
fi
RESOLVED=$(PATH="$NODE_BIN:$PATH" "$NPM" view "$SPEC" version 2>/dev/null | tail -1 || true)
[ -n "$RESOLVED" ] || die "cannot resolve $SPEC on the remote registry"

say "   dsh:     $CURRENT ($PKG)"
say "   node:    $NODE_VERSION ($NODE_BIN)"
say "   target:  $RESOLVED ($SPEC)"

if [ "$RESOLVED" = "$CURRENT" ]; then
  say "   already at $CURRENT; nothing to do"
  exit 0
fi

if [ "$DRY" = 1 ]; then
  say "   [dry-run] would run: npm install -g $SPEC"
  [ "$RESTART" = 1 ] && say "   [dry-run] would restart dsh-web"
  exit 0
fi

# -- update ----------------------------------------------------------------
# npm 11 refuses lifecycle scripts unless they are allow-listed. The same
# packages the provisioning script allowed keep node-pty and friends working.
ALLOW=""
if PATH="$NODE_BIN:$PATH" "$NPM" install --help 2>/dev/null | grep -q -- '--allow-scripts'; then
  ALLOW="--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs"
fi

say "   installing $SPEC (this can take a few minutes)"
PATH="$NODE_BIN:$PATH" "$NPM" install -g --no-audit --no-fund --loglevel=warn $ALLOW "$SPEC" \
  || die "npm install failed; dsh may need a manual reinstall"
INSTALLED=$("$NODE" -p 'require(process.argv[1]).version' "$PKG/package.json" 2>/dev/null || true)
[ "$INSTALLED" = "$RESOLVED" ] || die "installed a different version than $RESOLVED"
say "   installed: $INSTALLED"

# -- restart ---------------------------------------------------------------
if [ "$RESTART" != 1 ]; then
  say "   files updated; restart $UNIT to apply"
  exit 0
fi
say "   restarting $UNIT (interrupts sessions running on the remote)"
case "$KIND" in
  systemd-user)
    command -v systemctl >/dev/null 2>&1 || die "systemctl is unavailable; restart $UNIT manually"
    systemctl --user restart "$UNIT" || die "could not restart $UNIT"
    n=0
    while [ "$n" -lt 30 ]; do
      [ "$(systemctl --user is-active "$UNIT" 2>/dev/null)" = active ] && break
      n=$((n + 1))
      sleep 1
    done
    STATE=$(systemctl --user is-active "$UNIT" 2>/dev/null || true)
    [ "$STATE" = active ] || die "$UNIT is not active after the restart"
    ;;
  launchd-user)
    command -v launchctl >/dev/null 2>&1 || die "launchctl is unavailable; restart $UNIT manually"
    launchctl kickstart -k "gui/$(id -u)/$UNIT" || die "could not restart $UNIT"
    STATE=active
    sleep 2
    ;;
  *)
    die "$KIND services cannot be restarted by this script; use bin/remote.sh service"
    ;;
esac
# A restart drops the launch token the local proxy cached. Wait until the new
# server answers, then let the caller reload the frame.
if command -v curl >/dev/null 2>&1; then
  n=0
  CODE=000
  while [ "$n" -lt 20 ]; do
    CODE=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)
    [ -n "$CODE" ] && [ "$CODE" != 000 ] && break
    n=$((n + 1))
    sleep 1
  done
  [ -n "$CODE" ] || CODE=000
  say "   http:    $CODE on 127.0.0.1:$PORT"
  [ "$CODE" = 000 ] && die "$UNIT is active but 127.0.0.1:$PORT does not answer"
fi
sleep 2
say "   $UNIT: $STATE"
REMOTE
