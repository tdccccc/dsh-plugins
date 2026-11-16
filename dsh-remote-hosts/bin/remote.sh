#!/bin/sh
# Discover and manage a remote dsh web instance over ssh.
#
#   bin/remote.sh user@host probe                    # one JSON object describing it
#   bin/remote.sh user@host logs --lines 50          # tail its log
#   bin/remote.sh user@host service restart          # restart its unit
#   bin/remote.sh user@host service restart --dry-run
#
# The remote side is discovered rather than assumed: the service unit names the
# process that serves dsh web, that process names the Node installation, that
# Node's prefix owns the global @deepseek-ai/dsh package, and the package.json
# names the version. With no live process the ~/.local/bin/dsh launcher's own
# xtrace and then nvm/command -v stand in for it.
#
# One quoted heredoc is the whole remote payload; it reads its mode and
# arguments from "sh -s -- ..." so every mode runs the same discovery code.
# Progress goes to stdout and failures to stderr, like bin/sync.sh and
# bin/update.sh.
set -eu

# The plugin passes audited "-o Key=Value" options through this variable; only
# validated tokens, so the unquoted expansion is safe.
SSH_OPTS=${DSH_SSH_OPTIONS:-}

usage() {
  printf '%s\n' \
    'usage: remote.sh <ssh-host> probe   [--port N] [--unit U] [--kind KIND] [--log PATH] [--sessions-window N]' \
    '       remote.sh <ssh-host> service <start|stop|restart> [--port N] [--unit U] [--kind KIND] [--dry-run]' \
    '       remote.sh <ssh-host> logs    [--port N] [--log PATH] [--lines N] [--follow]' \
    'KIND is systemd-user (default), launchd-user, command, or external.' >&2
  exit 2
}

# -- arguments -------------------------------------------------------------
[ $# -ge 2 ] || usage
HOST=$1
CMD=$2
shift 2

PORT=27993
PORT_SET=0
UNIT=dsh-web
KIND=systemd-user
LOG=
LINES=200
DRY=0
FOLLOW=0
ACTION=
SESSION_WINDOW=10

case "$CMD" in
  probe|logs) ;;
  service)
    [ $# -ge 1 ] || usage
    ACTION=$1
    shift
    case "$ACTION" in
      start|stop|restart) ;;
      *) printf 'bad service action: %s\n' "$ACTION" >&2; usage ;;
    esac
    ;;
  *) printf 'unknown command: %s\n' "$CMD" >&2; usage ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --port)
      shift
      [ $# -gt 0 ] || { printf '%s\n' '--port needs a value' >&2; usage; }
      PORT=$1
      PORT_SET=1
      ;;
    --unit)
      case "$CMD" in probe|service) ;; *) printf -- '--unit is not valid for %s\n' "$CMD" >&2; usage ;; esac
      shift
      [ $# -gt 0 ] || { printf '%s\n' '--unit needs a value' >&2; usage; }
      UNIT=$1
      ;;
    --kind)
      case "$CMD" in probe|service) ;; *) printf -- '--kind is not valid for %s\n' "$CMD" >&2; usage ;; esac
      shift
      [ $# -gt 0 ] || { printf '%s\n' '--kind needs a value' >&2; usage; }
      KIND=$1
      case "$KIND" in
        systemd-user|launchd-user|command|external) ;;
        *) printf 'bad service kind: %s\n' "$KIND" >&2; usage ;;
      esac
      ;;
    --log)
      case "$CMD" in probe|logs) ;; *) printf -- '--log is not valid for %s\n' "$CMD" >&2; usage ;; esac
      shift
      [ $# -gt 0 ] || { printf '%s\n' '--log needs a value' >&2; usage; }
      LOG=$1
      ;;
    --lines)
      [ "$CMD" = logs ] || { printf -- '--lines is not valid for %s\n' "$CMD" >&2; usage; }
      shift
      [ $# -gt 0 ] || { printf '%s\n' '--lines needs a value' >&2; usage; }
      LINES=$1
      ;;
    --follow)
      [ "$CMD" = logs ] || { printf -- '--follow is not valid for %s\n' "$CMD" >&2; usage; }
      FOLLOW=1
      ;;
    --dry-run)
      [ "$CMD" = service ] || { printf -- '--dry-run is not valid for %s\n' "$CMD" >&2; usage; }
      DRY=1
      ;;
    --sessions-window)
      [ "$CMD" = probe ] || { printf -- '--sessions-window is not valid for %s\n' "$CMD" >&2; usage; }
      shift
      [ $# -gt 0 ] || { printf '%s\n' '--sessions-window needs a value' >&2; usage; }
      SESSION_WINDOW=$1
      ;;
    *) printf 'unknown option: %s\n' "$1" >&2; usage ;;
  esac
  shift
done

# Values travel inside the remote command string, so only plain hosts, units,
# paths, numbers, and kinds are accepted; none of them can become a second
# command or an ssh option.
case "$HOST" in
  -*) printf 'bad ssh host: %s\n' "$HOST" >&2; exit 2 ;;
  *[!A-Za-z0-9._@:-]*) printf 'bad ssh host: %s\n' "$HOST" >&2; exit 2 ;;
esac
case "$UNIT" in
  ''|-*|*[!A-Za-z0-9._@:-]*) printf 'bad unit: %s\n' "$UNIT" >&2; exit 2 ;;
esac
case "$PORT" in
  ''|0*|*[!0-9]*) printf 'bad port: %s\n' "$PORT" >&2; exit 2 ;;
esac
[ "$PORT" -le 65535 ] || { printf 'bad port: %s\n' "$PORT" >&2; exit 2; }
case "$LINES" in
  ''|0*|*[!0-9]*) printf 'bad lines: %s\n' "$LINES" >&2; exit 2 ;;
esac
[ "$LINES" -le 100000 ] || { printf 'bad lines: %s\n' "$LINES" >&2; exit 2; }
case "$SESSION_WINDOW" in
  ''|0*|*[!0-9]*) printf 'bad session window: %s\n' "$SESSION_WINDOW" >&2; exit 2 ;;
esac
[ "$SESSION_WINDOW" -le 1440 ] || { printf 'bad session window: %s\n' "$SESSION_WINDOW" >&2; exit 2; }
if [ -n "$LOG" ]; then
  case "$LOG" in
    -*) printf 'bad log path: %s\n' "$LOG" >&2; exit 2 ;;
    *[!A-Za-z0-9._/~:@+-]*) printf 'bad log path: %s\n' "$LOG" >&2; exit 2 ;;
  esac
fi

command -v ssh >/dev/null 2>&1 || { printf '%s\n' 'ssh is unavailable' >&2; exit 1; }

say() { printf '%s\n' "$*"; }

# -- remote payload --------------------------------------------------------
# Written once and fed to every ssh invocation on stdin. Quoted heredoc: nothing
# below expands on this side.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/payload.sh" <<'REMOTE'
# Runs on the remote host as "sh -s -- <mode> <args...>". Only this script's
# stdout is data for probe (flat KEY=VALUE records); service prints progress as
# it goes. No bashisms: the login shell there is not assumed to be anything.
set -u

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }
oneline() { printf '%s' "$1" | tr '\n\r\t' '   '; }
emit() { printf '%s=%s\n' "$1" "$(oneline "$2")"; }

# A configured log may start with ~; expand it without letting the shell parse
# the rest of the path.
expand_log() {
  case "$1" in
    '~') printf '%s' "$HOME" ;;
    '~/'*) printf '%s' "$HOME/${1#??}" ;;
    *) printf '%s' "$1" ;;
  esac
}

MODE=$1
case "$MODE" in
  probe) PORT=$2; UNIT=$3; KIND=$4; LOG=$5; SESSIONS_WINDOW=${6:-10} ;;
  logs) PORT=$2; LOG=$3; LINES=$4; FOLLOW=$5 ;;
  service) ACTION=$2; PORT=$3; UNIT=$4; KIND=$5; PORT_SET=$6 ;;
  *) die "unknown payload mode: $MODE" ;;
esac

# ---- probe ----
case "$MODE" in
probe)
  # Sentinel: if it appears, the payload ran; the local side prints JSON even
  # when ssh later reports a dropped connection and the records are partial.
  printf 'dsh-probe/1\n'

  HOSTNAME_R=$(hostname 2>/dev/null || uname -n 2>/dev/null || true)
  OS_R=
  if [ -r /etc/os-release ]; then
    OS_ID=$(sed -n 's/^ID=//p' /etc/os-release 2>/dev/null | head -1 | tr -d '"')
    OS_VER=$(sed -n 's/^VERSION_ID=//p' /etc/os-release 2>/dev/null | head -1 | tr -d '"')
    if [ -n "$OS_ID" ]; then
      OS_R=$OS_ID
      if [ -n "$OS_VER" ]; then OS_R="$OS_ID $OS_VER"; fi
    fi
  fi
  if [ -z "$OS_R" ]; then OS_R=$(uname -srm 2>/dev/null || true); fi
  emit HOSTNAME "$HOSTNAME_R"
  emit OS "$OS_R"

  # -- service state -------------------------------------------------------
  # systemd-user: the user unit is authoritative for state and for the process
  # that serves the port. launchd-user: the gui domain names the same process.
  # command/external say nothing, so the answer is a known unknown.
  SVC_STATE=unknown
  SVC_ACTIVE=null
  SVC_PID=
  case "$KIND" in
    systemd-user)
      if command -v systemctl >/dev/null 2>&1; then
        SHOW=$(systemctl --user show -p MainPID -p ActiveState "$UNIT" 2>/dev/null || true)
        STATE_R=$(printf '%s\n' "$SHOW" | sed -n 's/^ActiveState=//p' | head -1)
        PID_R=$(printf '%s\n' "$SHOW" | sed -n 's/^MainPID=//p' | head -1)
        case "$STATE_R" in
          '') ;;
          active) SVC_STATE=active; SVC_ACTIVE=true ;;
          *) SVC_STATE=$STATE_R; SVC_ACTIVE=false ;;
        esac
        case "$PID_R" in ''|0|*[!0-9]*) ;; *) SVC_PID=$PID_R ;; esac
      else
        emit WARNING "systemctl is unavailable; service state is unknown"
      fi
      ;;
    launchd-user)
      UID_R=$(id -u 2>/dev/null || true)
      PRINT=$(launchctl print "gui/$UID_R/$UNIT" 2>/dev/null || true)
      if [ -n "$PRINT" ]; then
        STATE_R=$(printf '%s\n' "$PRINT" | sed -n 's/^[[:space:]]*state = //p' | head -1)
        PID_R=$(printf '%s\n' "$PRINT" | sed -n 's/^[[:space:]]*pid = //p' | head -1)
        case "$STATE_R" in
          running) SVC_STATE=running; SVC_ACTIVE=true ;;
          '') ;;
          *) SVC_STATE=$STATE_R; SVC_ACTIVE=false ;;
        esac
        case "$PID_R" in ''|*[!0-9]*) ;; *) SVC_PID=$PID_R ;; esac
      else
        emit WARNING "launchctl print gui/$UID_R/$UNIT returned no service"
      fi
      ;;
    command|external)
      : # nothing to inspect; unknown state is the honest report
      ;;
  esac
  emit SERVICE_STATE "$SVC_STATE"
  emit SERVICE_ACTIVE "$SVC_ACTIVE"
  emit SERVICE_PID "$SVC_PID"

  # -- toolchain -----------------------------------------------------------
  # The live process is authoritative: its executable is the Node that loaded
  # the installed package, even when several Node versions share the host.
  NODE_DIR_R=
  if [ -n "$SVC_PID" ]; then
    if [ -r "/proc/$SVC_PID/exe" ]; then
      EXE=$(readlink -f "/proc/$SVC_PID/exe" 2>/dev/null || true)
      case "$EXE" in */bin/node) NODE_DIR_R=$(dirname "$EXE") ;; esac
    fi
    if [ -z "$NODE_DIR_R" ] && command -v lsof >/dev/null 2>&1; then
      EXE=$(lsof -p "$SVC_PID" -a -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
      case "$EXE" in */node) NODE_DIR_R=$(dirname "$EXE") ;; esac
    fi
    if [ -z "$NODE_DIR_R" ]; then
      EXE=$(ps -p "$SVC_PID" -o args= 2>/dev/null | awk '{print $1}' || true)
      case "$EXE" in */bin/node) NODE_DIR_R=$(dirname "$EXE") ;; esac
    fi
  fi

  # With the unit down the launcher pins the same toolchain. Follow the shell's
  # own trace of its exec instead of parsing the pin, so any form of it works.
  if [ -z "$NODE_DIR_R" ] && [ -x "$HOME/.local/bin/dsh" ]; then
    EXEC=$(sh -x "$HOME/.local/bin/dsh" -V 2>&1 >/dev/null | sed -n 's/^+ exec \(.*\)\/dsh .*/\1/p' | tail -1)
    case "$EXEC" in
      /*) if [ -x "$EXEC/node" ]; then NODE_DIR_R=$EXEC; fi ;;
    esac
  fi

  # Last resort: whatever nvm or PATH offers, as long as it is the toolchain
  # around the dsh that is installed.
  if [ -z "$NODE_DIR_R" ]; then
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
      . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
      nvm use 24 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
    fi
    DSH_CMD=$(command -v dsh 2>/dev/null || true)
    if [ -n "$DSH_CMD" ]; then
      DSH_REAL=$(readlink -f "$DSH_CMD" 2>/dev/null || true)
      if [ -n "$DSH_REAL" ]; then
        CAND=$(dirname "$DSH_REAL")
        if [ -x "$CAND/node" ]; then NODE_DIR_R=$CAND; fi
      fi
      if [ -z "$NODE_DIR_R" ]; then
        CAND=$(CDPATH= cd -- "$(dirname "$DSH_CMD")/.." 2>/dev/null && pwd -P || true)
        if [ -n "$CAND" ] && [ -x "$CAND/bin/node" ]; then NODE_DIR_R="$CAND/bin"; fi
      fi
    fi
  fi

  NODE_VER=
  NODE_EXE=
  DSH_VER=
  DSH_BIN_R=
  INST_KIND=unknown
  INST_PREFIX=
  if [ -n "$NODE_DIR_R" ]; then
    NODE_EXE="$NODE_DIR_R/node"
    NODE_VER=$("$NODE_EXE" -v 2>/dev/null || true)
    PREFIX_R=$(CDPATH= cd -- "$NODE_DIR_R/.." 2>/dev/null && pwd -P || printf '%s' "$NODE_DIR_R")

    # The installed CLI next to Node is the executable the unit starts through.
    if [ -x "$PREFIX_R/bin/dsh" ]; then
      DSH_BIN_R="$PREFIX_R/bin/dsh"
    else
      DSH_BIN_R=$(PATH="$NODE_DIR_R:$PATH" command -v dsh 2>/dev/null || true)
    fi

    # The package version comes from the copy this prefix owns, not from
    # whichever global package another Node version may also have installed.
    NPM_R="$NODE_DIR_R/npm"
    if [ -x "$NPM_R" ]; then
      NPM_PREFIX_R=$(PATH="$NODE_DIR_R:$PATH" "$NPM_R" prefix -g 2>/dev/null | tail -1 || true)
      if [ -n "$NPM_PREFIX_R" ]; then
        NPM_PREFIX_P=$(CDPATH= cd -- "$NPM_PREFIX_R" 2>/dev/null && pwd -P || printf '%s' "$NPM_PREFIX_R")
        if [ "$NPM_PREFIX_P" = "$PREFIX_R" ]; then
          INST_KIND=npm-global
          INST_PREFIX=$PREFIX_R
        else
          INST_KIND=npm-other
          INST_PREFIX=$NPM_PREFIX_P
          emit WARNING "npm installs into $NPM_PREFIX_P but dsh runs from $PREFIX_R"
        fi
      else
        emit WARNING "could not read the npm global prefix"
      fi
    else
      emit WARNING "missing npm under $NODE_DIR_R"
    fi

    PKG_R="$PREFIX_R/lib/node_modules/@deepseek-ai/dsh"
    if [ -f "$PKG_R/package.json" ]; then
      DSH_VER=$("$NODE_EXE" -p 'require(process.argv[1]).version' "$PKG_R/package.json" 2>/dev/null || true)
      if [ -z "$DSH_VER" ]; then
        DSH_VER=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$PKG_R/package.json" 2>/dev/null | head -1)
      fi
      if [ -z "$DSH_VER" ]; then
        emit WARNING "could not read the installed dsh version from $PKG_R/package.json"
      fi
    else
      emit WARNING "missing $PKG_R/package.json"
    fi
  else
    emit WARNING "could not find the Node installation that serves dsh"
  fi
  emit NODE_BIN "$NODE_EXE"
  emit NODE_VERSION "$NODE_VER"
  emit DSH_VERSION "$DSH_VER"
  emit DSH_BIN "$DSH_BIN_R"
  emit INSTALL_KIND "$INST_KIND"
  emit INSTALL_PREFIX "$INST_PREFIX"

  # -- port ----------------------------------------------------------------
  # An HTTP code other than 000 means the port is listening and speaking HTTP;
  # ss/lsof catch a listener that did not answer within two seconds.
  HTTP_R=000
  if command -v curl >/dev/null 2>&1; then
    HTTP_R=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)
    case "$HTTP_R" in ''|*[!0-9]*) HTTP_R=000 ;; esac
  else
    emit WARNING "curl is unavailable; port state is unknown"
  fi
  LISTENING_R=false
  case "$HTTP_R" in
    000) ;;
    *) LISTENING_R=true ;;
  esac
  if [ "$LISTENING_R" = false ]; then
    if command -v ss >/dev/null 2>&1; then
      if ss -ltn 2>/dev/null | grep -q "[:.]$PORT[[:space:]]"; then LISTENING_R=true; fi
    elif command -v lsof >/dev/null 2>&1; then
      if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then LISTENING_R=true; fi
    fi
  fi
  emit PORT_HTTP "$HTTP_R"
  emit PORT_LISTENING "$LISTENING_R"

  # -- log -----------------------------------------------------------------
  # The token count the local proxy needs comes from "token=" lines; a missing
  # log is reported instead of failing the probe.
  LOG_PATH_R=$LOG
  if [ -z "$LOG_PATH_R" ]; then LOG_PATH_R="~/.dsh/web-$PORT.log"; fi
  LOG_FILE_R=$(expand_log "$LOG_PATH_R")
  LOG_EXISTS_R=false
  LOG_TOKENS_R=null
  if [ -f "$LOG_FILE_R" ]; then
    LOG_EXISTS_R=true
    TOKENS_R=$(grep -c 'token=' "$LOG_FILE_R" 2>/dev/null || true)
    case "$TOKENS_R" in ''|*[!0-9]*) LOG_TOKENS_R=null ;; *) LOG_TOKENS_R=$TOKENS_R ;; esac
  else
    emit WARNING "log file not found: $LOG_PATH_R"
  fi
  emit LOG_PATH "$LOG_PATH_R"
  emit LOG_EXISTS "$LOG_EXISTS_R"
  emit LOG_TOKENS "$LOG_TOKENS_R"

  # -- sessions ------------------------------------------------------------
  # dsh stores sessions as ~/.dsh/sessions/<workspace>/<session-id>/<files>.
  # A file written inside the window means that session was active recently;
  # the local side uses the count and the ids to warn before it restarts the
  # unit. A missing or unreadable store reports zero instead of failing probe.
  SESSIONS_DIR_R="$HOME/.dsh/sessions"
  SESSIONS_ACTIVE_R=0
  SESSIONS_FILES_R=0
  SESSIONS_LATEST_AGE_R=null
  SESSIONS_IDS_R=
  SESSIONS_IDS_JSON_R=
  if [ -d "$SESSIONS_DIR_R" ]; then
    RECENT_R=$(find "$SESSIONS_DIR_R" -type f -mmin -"$SESSIONS_WINDOW" 2>/dev/null || true)
    if [ -n "$RECENT_R" ]; then
      SESSIONS_FILES_R=$(printf '%s\n' "$RECENT_R" | sed '/^$/d' | wc -l | tr -d ' ')
      SESSIONS_SUMMARY_R=$(printf '%s\n' "$RECENT_R" | awk -v base="$SESSIONS_DIR_R/" '
        {
          path = $0
          if (index(path, base) == 1) path = substr(path, length(base) + 1)
          n = split(path, part, "/")
          if (n >= 3) id = part[2]
          else if (n >= 2) id = part[1]
          else next
          gsub(/[^A-Za-z0-9._-]/, "", id)
          if (id == "" || id in seen) next
          seen[id] = 1
          ids[count++] = id
        }
        END {
          print count + 0
          if (count == 0) { print ""; print ""; exit }
          if (count == 1) { print ids[0]; printf "\"%s\"\n", ids[0]; exit }
          print ids[0] "," ids[1]
          printf "\"%s\",\"%s\"\n", ids[0], ids[1]
        }')
      SESSIONS_ACTIVE_R=$(printf '%s\n' "$SESSIONS_SUMMARY_R" | sed -n '1p')
      SESSIONS_IDS_R=$(printf '%s\n' "$SESSIONS_SUMMARY_R" | sed -n '2p')
      SESSIONS_IDS_JSON_R=$(printf '%s\n' "$SESSIONS_SUMMARY_R" | sed -n '3p')
      # ls -t over the matched files names the freshest write without relying
      # on GNU-only find -printf.
      NEWEST_R=$(printf '%s\n' "$RECENT_R" | sed '/^$/d' | tr '\n' '\0' | xargs -0 ls -td 2>/dev/null | head -1 || true)
      if [ -n "$NEWEST_R" ]; then
        NOW_R=$(date +%s 2>/dev/null || true)
        MTIME_R=$(stat -c %Y "$NEWEST_R" 2>/dev/null || stat -f %m "$NEWEST_R" 2>/dev/null || true)
        case "$NOW_R" in ''|*[!0-9]*) ;; *)
          case "$MTIME_R" in ''|*[!0-9]*) ;;
            *) AGE_R=$(( (NOW_R - MTIME_R) / 60 ))
               if [ "$AGE_R" -lt 0 ]; then AGE_R=0; fi
               SESSIONS_LATEST_AGE_R=$AGE_R ;;
          esac ;;
        esac
      fi
    fi
  fi
  case "$SESSIONS_ACTIVE_R" in ''|*[!0-9]*) SESSIONS_ACTIVE_R=0 ;; esac
  case "$SESSIONS_FILES_R" in ''|*[!0-9]*) SESSIONS_FILES_R=0 ;; esac
  case "$SESSIONS_LATEST_AGE_R" in ''|*[!0-9]*) SESSIONS_LATEST_AGE_R=null ;; esac
  emit SESSIONS_DIR "$SESSIONS_DIR_R"
  emit SESSIONS_WINDOW "$SESSIONS_WINDOW"
  emit SESSIONS_ACTIVE "$SESSIONS_ACTIVE_R"
  emit SESSIONS_FILES "$SESSIONS_FILES_R"
  emit SESSIONS_LATEST_AGE "$SESSIONS_LATEST_AGE_R"
  emit SESSIONS_IDS "$SESSIONS_IDS_R"
  emit SESSIONS_IDS_JSON "$SESSIONS_IDS_JSON_R"
  exit 0
  ;;
esac

# ---- logs ----
case "$MODE" in
logs)
  LOG_PATH_R=$LOG
  if [ -z "$LOG_PATH_R" ]; then LOG_PATH_R="~/.dsh/web-$PORT.log"; fi
  LOG_FILE_R=$(expand_log "$LOG_PATH_R")
  if [ ! -f "$LOG_FILE_R" ]; then
    printf 'log not found: %s\n' "$LOG_PATH_R" >&2
    exit 1
  fi
  if [ "$FOLLOW" = 1 ]; then
    # -F keeps reading across a rotation; the local ssh process is killed when
    # the follow request ends, which closes the channel and stops tail.
    exec tail -n "$LINES" -F "$LOG_FILE_R"
  fi
  tail -n "$LINES" "$LOG_FILE_R"
  exit 0
  ;;
esac

# ---- service ----
case "$MODE" in
service)
  UID_R=$(id -u 2>/dev/null || true)

  # A restart drops the login token the local proxy cached, so wait for the new
  # server to answer before reporting success.
  wait_http() {
    if ! command -v curl >/dev/null 2>&1; then
      say "   http:    not checked (curl is unavailable)"
      return 0
    fi
    n=0
    CODE=000
    while [ "$n" -lt 20 ]; do
      CODE=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)
      if [ -n "$CODE" ] && [ "$CODE" != 000 ]; then break; fi
      n=$((n + 1))
      sleep 1
    done
    if [ -z "$CODE" ]; then CODE=000; fi
    if [ "$CODE" = 000 ]; then
      die "$UNIT is up but 127.0.0.1:$PORT does not answer"
    fi
    say "   http:    $CODE on 127.0.0.1:$PORT after ${n}s"
  }

  summary() { printf '   summary: %s\n' "$*"; }

  CODE=
  case "$KIND" in
    systemd-user)
      command -v systemctl >/dev/null 2>&1 || die "systemctl is unavailable; cannot manage $UNIT"
      say "   run:     systemctl --user $ACTION $UNIT"
      systemctl --user "$ACTION" "$UNIT" || die "systemctl --user $ACTION $UNIT failed"
      n=0
      STATE=unknown
      PID=
      case "$ACTION" in
        start|restart)
          while [ "$n" -lt 30 ]; do
            STATE=$(systemctl --user is-active "$UNIT" 2>/dev/null || true)
            if [ "$STATE" = active ]; then break; fi
            n=$((n + 1))
            sleep 1
          done
          [ "$STATE" = active ] || die "$UNIT is not active after $ACTION"
          PID=$(systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null || true)
          case "$PID" in ''|0|*[!0-9]*) PID= ;; esac
          if [ -n "$PID" ]; then
            say "   $UNIT:  $STATE (pid $PID) after ${n}s"
          else
            say "   $UNIT:  $STATE after ${n}s"
          fi
          if [ "$PORT_SET" = 1 ]; then wait_http; fi
          ;;
        stop)
          while [ "$n" -lt 20 ]; do
            STATE=$(systemctl --user is-active "$UNIT" 2>/dev/null || true)
            if [ "$STATE" != active ]; then break; fi
            n=$((n + 1))
            sleep 1
          done
          if [ "$STATE" = active ]; then die "$UNIT is still active after stop"; fi
          say "   $UNIT:  $STATE after ${n}s"
          ;;
      esac
      if [ "$ACTION" = stop ]; then
        summary "stop $KIND $UNIT -> $STATE"
      elif [ -n "$PID" ]; then
        if [ "$PORT_SET" = 1 ] && [ -n "$CODE" ]; then
          summary "$ACTION $KIND $UNIT -> $STATE (pid $PID), http $CODE on 127.0.0.1:$PORT"
        else
          summary "$ACTION $KIND $UNIT -> $STATE (pid $PID)"
        fi
      else
        if [ "$PORT_SET" = 1 ] && [ -n "$CODE" ]; then
          summary "$ACTION $KIND $UNIT -> $STATE, http $CODE on 127.0.0.1:$PORT"
        else
          summary "$ACTION $KIND $UNIT -> $STATE"
        fi
      fi
      ;;
    launchd-user)
      command -v launchctl >/dev/null 2>&1 || die "launchctl is unavailable; cannot manage $UNIT"
      DOMAIN="gui/$UID_R/$UNIT"
      case "$ACTION" in
        start)
          say "   run:     launchctl kickstart $DOMAIN"
          launchctl kickstart "$DOMAIN" || die "launchctl kickstart $DOMAIN failed"
          ;;
        stop)
          say "   run:     launchctl bootout $DOMAIN"
          launchctl bootout "$DOMAIN" 2>/dev/null || true
          ;;
        restart)
          say "   run:     launchctl kickstart -k $DOMAIN"
          launchctl kickstart -k "$DOMAIN" || die "launchctl kickstart -k $DOMAIN failed"
          ;;
      esac
      n=0
      STATE=unknown
      PID=
      case "$ACTION" in
        start|restart)
          while [ "$n" -lt 30 ]; do
            STATE=$(launchctl print "$DOMAIN" 2>/dev/null | sed -n 's/^[[:space:]]*state = //p' | head -1)
            if [ "$STATE" = running ]; then break; fi
            n=$((n + 1))
            sleep 1
          done
          [ "$STATE" = running ] || die "$UNIT is not running after $ACTION"
          PID=$(launchctl print "$DOMAIN" 2>/dev/null | sed -n 's/^[[:space:]]*pid = //p' | head -1)
          case "$PID" in ''|*[!0-9]*) PID= ;; esac
          if [ -n "$PID" ]; then
            say "   $DOMAIN: running (pid $PID) after ${n}s"
          else
            say "   $DOMAIN: running after ${n}s"
          fi
          if [ "$PORT_SET" = 1 ]; then wait_http; fi
          ;;
        stop)
          while [ "$n" -lt 20 ]; do
            STATE=$(launchctl print "$DOMAIN" 2>/dev/null | sed -n 's/^[[:space:]]*state = //p' | head -1)
            if [ "$STATE" != running ]; then break; fi
            n=$((n + 1))
            sleep 1
          done
          if [ "$STATE" = running ]; then die "$UNIT is still running after stop"; fi
          say "   $DOMAIN: stopped after ${n}s"
          STATE=stopped
          ;;
      esac
      if [ "$ACTION" = stop ]; then
        summary "stop $KIND $UNIT -> $STATE"
      elif [ -n "$PID" ]; then
        if [ "$PORT_SET" = 1 ] && [ -n "$CODE" ]; then
          summary "$ACTION $KIND $UNIT -> $STATE (pid $PID), http $CODE on 127.0.0.1:$PORT"
        else
          summary "$ACTION $KIND $UNIT -> $STATE (pid $PID)"
        fi
      else
        if [ "$PORT_SET" = 1 ] && [ -n "$CODE" ]; then
          summary "$ACTION $KIND $UNIT -> $STATE, http $CODE on 127.0.0.1:$PORT"
        else
          summary "$ACTION $KIND $UNIT -> $STATE"
        fi
      fi
      ;;
    *)
      die "unsupported service kind: $KIND"
      ;;
  esac
  exit 0
  ;;
esac

die "unknown payload mode: $MODE"
REMOTE

# -- helpers ---------------------------------------------------------------
# JSON-escape a remote value: records are one line by construction, and control
# characters have no business in these fields anyway; backslash and quote are
# all that could break a JSON string once they are gone.
json_escape() {
  printf '%s' "$1" | tr -d '\r\n\t' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

WARN_JSON=
add_warn() {
  if [ -n "$WARN_JSON" ]; then WARN_JSON="$WARN_JSON,"; fi
  WARN_JSON="$WARN_JSON\"$(json_escape "$1")\""
}

# -- probe -----------------------------------------------------------------
do_probe() {
  OUT=
  RC=0
  OUT=$(ssh $SSH_OPTS -o BatchMode=yes -o ConnectTimeout=10 "$HOST" \
    "sh -s -- probe '$PORT' '$UNIT' '$KIND' '$LOG' '$SESSION_WINDOW'" \
    < "$TMP/payload.sh" 2>"$TMP/ssh.err") || RC=$?

  if ! printf '%s\n' "$OUT" | grep -q '^dsh-probe/1$'; then
    printf 'probe failed: the remote payload did not run on %s\n' "$HOST" >&2
    if [ -s "$TMP/ssh.err" ]; then cat "$TMP/ssh.err" >&2; fi
    if [ "$RC" -ne 0 ]; then exit "$RC"; fi
    exit 1
  fi

  # Defaults for every field: a partial payload still yields one complete
  # object, with the missing pieces marked by warnings.
  WARN_JSON=
  H_NAME=
  OS_NAME=
  SVC_STATE=unknown
  SVC_ACTIVE=null
  SVC_PID=null
  DSH_VER=
  DSH_BIN_R=
  INST_KIND=unknown
  INST_PREFIX=
  NODE_VER=
  NODE_BIN_R=
  PORT_HTTP=000
  PORT_LISTEN=false
  LOG_PATH_R=
  LOG_EXISTS=false
  LOG_TOKENS=null
  SESSIONS_DIR_R=
  SESSIONS_WINDOW_R=$SESSION_WINDOW
  SESSIONS_ACTIVE=0
  SESSIONS_FILES=0
  SESSIONS_LATEST_AGE=null
  SESSIONS_IDS=
  SESSIONS_IDS_JSON=

  if [ "$RC" -ne 0 ]; then
    add_warn "ssh exited $RC; findings may be incomplete"
  fi

  while IFS= read -r REC; do
    case "$REC" in
      *=*) ;;
      *) continue ;;
    esac
    KEY=${REC%%=*}
    VALUE=${REC#*=}
    case "$KEY" in
      HOSTNAME) H_NAME=$VALUE ;;
      OS) OS_NAME=$VALUE ;;
      SERVICE_STATE) SVC_STATE=$VALUE ;;
      SERVICE_ACTIVE) SVC_ACTIVE=$VALUE ;;
      SERVICE_PID) SVC_PID=$VALUE ;;
      DSH_VERSION) DSH_VER=$VALUE ;;
      DSH_BIN) DSH_BIN_R=$VALUE ;;
      INSTALL_KIND) INST_KIND=$VALUE ;;
      INSTALL_PREFIX) INST_PREFIX=$VALUE ;;
      NODE_VERSION) NODE_VER=$VALUE ;;
      NODE_BIN) NODE_BIN_R=$VALUE ;;
      PORT_HTTP) PORT_HTTP=$VALUE ;;
      PORT_LISTENING) PORT_LISTEN=$VALUE ;;
      LOG_PATH) LOG_PATH_R=$VALUE ;;
      LOG_EXISTS) LOG_EXISTS=$VALUE ;;
      LOG_TOKENS) LOG_TOKENS=$VALUE ;;
      SESSIONS_DIR) SESSIONS_DIR_R=$VALUE ;;
      SESSIONS_WINDOW) SESSIONS_WINDOW_R=$VALUE ;;
      SESSIONS_ACTIVE) SESSIONS_ACTIVE=$VALUE ;;
      SESSIONS_FILES) SESSIONS_FILES=$VALUE ;;
      SESSIONS_LATEST_AGE) SESSIONS_LATEST_AGE=$VALUE ;;
      SESSIONS_IDS) SESSIONS_IDS=$VALUE ;;
      SESSIONS_IDS_JSON) SESSIONS_IDS_JSON=$VALUE ;;
      WARNING) add_warn "$VALUE" ;;
    esac
  done <<EOF
$OUT
EOF

  case "$SVC_ACTIVE" in true|false) ;; *) SVC_ACTIVE=null ;; esac
  case "$SVC_PID" in ''|*[!0-9]*) SVC_PID=null ;; esac
  case "$PORT_HTTP" in ''|*[!0-9]*) PORT_HTTP=000 ;; esac
  case "$PORT_LISTEN" in true) ;; *) PORT_LISTEN=false ;; esac
  case "$LOG_EXISTS" in true) ;; *) LOG_EXISTS=false ;; esac
  case "$LOG_TOKENS" in ''|*[!0-9]*) LOG_TOKENS=null ;; esac
  if [ -z "$SVC_STATE" ]; then SVC_STATE=unknown; fi
  if [ -z "$LOG_PATH_R" ]; then LOG_PATH_R="~/.dsh/web-$PORT.log"; fi
  case "$SESSIONS_WINDOW_R" in ''|*[!0-9]*) SESSIONS_WINDOW_R=$SESSION_WINDOW ;; esac
  case "$SESSIONS_ACTIVE" in ''|*[!0-9]*) SESSIONS_ACTIVE=0 ;; esac
  case "$SESSIONS_FILES" in ''|*[!0-9]*) SESSIONS_FILES=0 ;; esac
  case "$SESSIONS_LATEST_AGE" in ''|*[!0-9]*) SESSIONS_LATEST_AGE=null ;; esac
  if [ -z "$SESSIONS_DIR_R" ]; then SESSIONS_DIR_R="~/.dsh/sessions"; fi

  E_HOST=$(json_escape "$H_NAME")
  E_OS=$(json_escape "$OS_NAME")
  E_KIND=$(json_escape "$KIND")
  E_UNIT=$(json_escape "$UNIT")
  E_SVC_STATE=$(json_escape "$SVC_STATE")
  E_DSH_VER=$(json_escape "$DSH_VER")
  E_DSH_BIN=$(json_escape "$DSH_BIN_R")
  E_INST_KIND=$(json_escape "$INST_KIND")
  E_INST_PREFIX=$(json_escape "$INST_PREFIX")
  E_NODE_VER=$(json_escape "$NODE_VER")
  E_NODE_BIN=$(json_escape "$NODE_BIN_R")
  E_LOG_PATH=$(json_escape "$LOG_PATH_R")
  E_SESSIONS_DIR=$(json_escape "$SESSIONS_DIR_R")

  printf '{"ok":true,"info":{"hostname":"%s","os":"%s","service":{"kind":"%s","unit":"%s","state":"%s","active":%s,"pid":%s},"dsh":{"version":"%s","bin":"%s","install":{"kind":"%s","prefix":"%s"},"node":{"version":"%s","bin":"%s"}},"port":{"number":%s,"listening":%s,"http":"%s"},"log":{"path":"%s","exists":%s,"tokens":%s},"sessions":{"dir":"%s","window":%s,"active":%s,"files":%s,"latestAge":%s,"ids":[%s]},"warnings":[%s]}}\n' \
    "$E_HOST" "$E_OS" "$E_KIND" "$E_UNIT" "$E_SVC_STATE" "$SVC_ACTIVE" "$SVC_PID" \
    "$E_DSH_VER" "$E_DSH_BIN" "$E_INST_KIND" "$E_INST_PREFIX" "$E_NODE_VER" "$E_NODE_BIN" \
    "$PORT" "$PORT_LISTEN" "$PORT_HTTP" "$E_LOG_PATH" "$LOG_EXISTS" "$LOG_TOKENS" \
    "$E_SESSIONS_DIR" "$SESSIONS_WINDOW_R" "$SESSIONS_ACTIVE" "$SESSIONS_FILES" "$SESSIONS_LATEST_AGE" "$SESSIONS_IDS_JSON" "$WARN_JSON"
  return 0
}

# -- logs ------------------------------------------------------------------
do_logs() {
  RC=0
  ssh $SSH_OPTS -o BatchMode=yes -o ConnectTimeout=10 "$HOST" \
    "sh -s -- logs '$PORT' '$LOG' '$LINES' '$FOLLOW'" \
    < "$TMP/payload.sh" || RC=$?
  if [ "$RC" -ne 0 ]; then
    if [ "$RC" -ne 255 ]; then
      printf 'could not read the log on %s\n' "$HOST" >&2
    fi
    exit "$RC"
  fi
}

# -- service ---------------------------------------------------------------
do_service() {
  case "$KIND" in
    command|external)
      printf 'unsupported service kind: %s\n' "$KIND" >&2
      exit 2
      ;;
  esac

  say "== $HOST =="

  # A dry run names the remote command and the waits without opening ssh at all.
  if [ "$DRY" = 1 ]; then
    case "$KIND" in
      systemd-user)
        PLAN="systemctl --user $ACTION $UNIT"
        ;;
      launchd-user)
        case "$ACTION" in
          start) PLAN="launchctl kickstart gui/\$(id -u)/$UNIT" ;;
          stop) PLAN="launchctl bootout gui/\$(id -u)/$UNIT" ;;
          restart) PLAN="launchctl kickstart -k gui/\$(id -u)/$UNIT" ;;
        esac
        ;;
    esac
    say "   [dry-run] would run: ssh $SSH_OPTS $HOST $PLAN"
    case "$ACTION" in
      start|restart)
        say "   [dry-run] would wait up to 30s for $UNIT to be running"
        if [ "$PORT_SET" = 1 ]; then
          say "   [dry-run] would wait up to 20s for 127.0.0.1:$PORT to answer"
        fi
        ;;
      stop)
        say "   [dry-run] would wait up to 20s for $UNIT to stop"
        ;;
    esac
    exit 0
  fi

  RC=0
  ssh $SSH_OPTS -o BatchMode=yes -o ConnectTimeout=10 "$HOST" \
    "sh -s -- service '$ACTION' '$PORT' '$UNIT' '$KIND' '$PORT_SET'" \
    < "$TMP/payload.sh" || RC=$?
  if [ "$RC" -ne 0 ]; then
    printf 'service %s failed on %s\n' "$ACTION" "$HOST" >&2
    exit "$RC"
  fi
}

case "$CMD" in
  probe) do_probe ;;
  logs) do_logs ;;
  service) do_service ;;
esac
