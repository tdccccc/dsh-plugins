#!/bin/sh
# Mirror local dsh preferences and settings onto a remote host running dsh web.
#
#   bin/sync.sh a100-146            # copy files only
#   bin/sync.sh a100-146 --restart  # copy, then restart the remote dsh-web unit
#   bin/sync.sh a100-146 --dry-run  # show the plan
#
# What travels: ~/.dsh/AGENTS.md, the profile patch layer (desktop -> web),
# and the provider API keys that layer references.
#
# Progress goes to stdout; failures go to stderr so the plugin can show them.
set -eu

HOST=${1:?"usage: sync.sh <ssh-host> [--restart] [--dry-run]"}
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
die() { printf '%s\n' "$*" >&2; exit 1; }

LOCAL_PATCH="$HOME/.dsh/profiles/desktop/cordis.patch.yml"
[ -f "$LOCAL_PATCH" ] || die "missing $LOCAL_PATCH"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Cut the desktop patch into top-level entries. An entry starts with "- " in
# column one and owns every following line until the next one.
#   - insert: lists plugins installed on this machine; the remote host usually
#     has none of them, so those entries are skipped and counted.
#   - id: ui-settings-account is desktop-only and stays behind.
awk -v skip_id=ui-settings-account -v count_file="$TMP/skipped" '
  function flush() {
    if (!have) return
    if (drop) { skipped += 1 } else { printf "%s", buf }
    have = 0; drop = 0; buf = ""
  }
  /^- / {
    flush()
    have = 1
    buf = $0 "\n"
    if ($0 ~ /^- insert:/) { drop = 1; next }
    if ($0 ~ /^- id:/) {
      id = $0
      sub(/^- id:[[:space:]]*/, "", id)
      sub(/[[:space:]]+$/, "", id)
      if (id == skip_id) drop = 1
    }
    next
  }
  {
    # Comments and blank lines outside an entry belong to the local file header,
    # which is regenerated below; keep everything inside an entry.
    if (have) buf = buf $0 "\n"
    else if ($0 !~ /^[[:space:]]*#/ && $0 !~ /^[[:space:]]*$/) printf "%s\n", $0
  }
  END { flush(); print skipped > count_file }
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

keys=$(grep -c '=' "$TMP/remote.env" 2>/dev/null || true)
skipped=$(cat "$TMP/skipped" 2>/dev/null || echo 0)

say "== $HOST =="
say "   patch:  $(wc -l < "$TMP/web-patch.yml" | tr -d ' ') lines"
say "   keys:   ${keys:-0}"
say "   insert: ${skipped:-0} skipped (not installed on the remote)"

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
  # Report the unit state ourselves: a plain "is-active" failure prints to
  # stdout and would otherwise reach the UI without any context.
  ssh "$HOST" 'systemctl --user restart dsh-web; sleep 6; status=$(systemctl --user is-active dsh-web); printf "dsh-web: %s\n" "$status"; [ "$status" = active ] || exit 3'
  say "   dsh-web restarted"
else
  say "   files copied; pass --restart (or restart dsh-web) to apply"
fi
