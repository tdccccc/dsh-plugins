#!/bin/sh
# Mirror local dsh preferences and settings onto a remote host running dsh web.
#
#   ./dsh-sync.sh a100-146            # copy files only
#   ./dsh-sync.sh a100-146 --restart  # copy, then restart the remote dsh-web unit
#   ./dsh-sync.sh a100-146 --dry-run  # show the plan
#
# What travels: ~/.dsh/AGENTS.md, the profile patch layer (desktop -> web),
# and the provider API keys that layer references.
set -eu

HOST=${1:?"usage: dsh-sync.sh <ssh-host> [--restart] [--dry-run]"}
shift
RESTART=0
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --restart) RESTART=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
LOCAL_PATCH="$HOME/.dsh/profiles/desktop/cordis.patch.yml"
[ -f "$LOCAL_PATCH" ] || { say "missing $LOCAL_PATCH"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Desktop-only entries stay behind; everything else carries over verbatim.
awk '
  function flush() { if (block != "" && keep) printf "%s", block }
  /^- id: / {
    flush()
    id = $0; sub(/^- id: */, "", id)
    keep = (id != "ui-settings-account")
    block = $0 "\n"
    next
  }
  { block = block $0 "\n" }
  END { flush() }
' "$LOCAL_PATCH" > "$TMP/patch.yml"

{
  say '# Your patch layer for this dsh profile, applied after every bundle layer:'
  say '# a top-level YAML array of loader patch entries (id-targeted config'
  say '# overrides, disables, and insert lists; JS expressions allowed).'
  printf '%s\n' '- id: ui-settings-general'
  printf '%s\n' '  name: "@deepseek-ai/dsh-client-ui-settings-general"'
  printf '%s\n' '  config:'
  printf '%s\n' '    welcomeNoticeVersion: 2026-09-28.1'
  cat "$TMP/patch.yml"
} > "$TMP/web-patch.yml"

KEYS=""
for name in OPENCODE_GO_API_KEY VPS_CC_API_KEY; do
  value=$(grep -m1 "^  $name:" "$HOME/.dsh/.credentials.yaml" 2>/dev/null | sed -E "s/^  $name: *//" || true)
  [ -n "$value" ] && KEYS="$KEYS$name=$value
"
done
printf '%s' "$KEYS" > "$TMP/remote.env"

say "== $HOST =="
say "   patch:  $(wc -l < "$TMP/web-patch.yml" | tr -d ' ') lines"
say "   keys:   $(grep -c '=' "$TMP/remote.env" 2>/dev/null || echo 0)"

if [ -n "${PRINT_PATCH:-}" ]; then cat "$TMP/web-patch.yml"; fi

if [ "$DRY" = 1 ]; then
  say "   [dry-run] would copy AGENTS.md, profile patch, keys"
  exit 0
fi

rsync -az "$HOME/.dsh/AGENTS.md" "$HOST:.dsh/AGENTS.md"
rsync -az "$TMP/web-patch.yml" "$HOST:.dsh/profiles/web/cordis.patch.yml"
rsync -az "$TMP/remote.env" "$HOST:.dsh/remote.env"
ssh "$HOST" 'chmod 600 ~/.dsh/remote.env'

if [ "$RESTART" = 1 ]; then
  say "   restarting dsh-web"
  ssh "$HOST" 'systemctl --user restart dsh-web && sleep 6 && systemctl --user is-active dsh-web'
else
  say "   files copied; pass --restart (or restart dsh-web) to apply"
fi
