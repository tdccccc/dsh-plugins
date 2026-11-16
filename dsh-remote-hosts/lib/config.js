// Pure parsing of the plugin's `servers` config. Kept out of index.js so the
// rules can be tested without mounting the Host half or an ssh connection.
//
// One row is one endpoint, not one machine: two rows may share an sshHost with
// different remotePort/unit/profile, which is how a machine that runs several
// dsh instances is represented.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const SERVICE_KINDS = new Set(['systemd-user', 'launchd-user', 'command', 'external']);
const UNIT_PATTERN = /^[A-Za-z0-9@._:-]{1,128}$/;
const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const CHANNEL_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/;

// A .volatile() Config field is a stable reference read with get(); an absent or
// plain value still works so the plugin runs before the settings service mounts.
export function configList(config) {
  const value = config && config.servers;
  const unwrapped = value && typeof value.get === 'function' ? value.get() : value;
  return Array.isArray(unwrapped) ? unwrapped : [];
}

export function toServer(row) {
  if (!row || typeof row !== 'object') return null;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!ID_PATTERN.test(id)) return null;
  const sshHost = typeof row.sshHost === 'string' ? row.sshHost.trim() : '';
  const raw = typeof row.url === 'string' ? row.url.trim() : '';
  let url = '';
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.href;
    } catch {}
  }
  // A managed host has no fixed address: its proxy port is picked at runtime.
  if (!url && !sshHost) return null;
  // Service ownership only exists for an ssh-managed row. An unknown kind or a
  // malformed unit/profile name falls back to the discovered default rather
  // than failing the row: the remote helper re-checks what it finds.
  const rawKind = typeof row.serviceKind === 'string' ? row.serviceKind.trim() : '';
  const kind = sshHost
    ? (SERVICE_KINDS.has(rawKind) ? rawKind : 'systemd-user')
    : 'external';
  const rawUnit = typeof row.serviceUnit === 'string' ? row.serviceUnit.trim() : '';
  const unit = (kind === 'systemd-user' || kind === 'launchd-user') && UNIT_PATTERN.test(rawUnit)
    ? rawUnit
    : (kind === 'systemd-user' || kind === 'launchd-user' ? 'dsh-web' : '');
  const rawProfile = typeof row.profile === 'string' ? row.profile.trim() : '';
  const rawChannel = typeof row.updateChannel === 'string' ? row.updateChannel.trim() : '';
  // Space-separated package specs installed on first provisioning; the script
  // validates each spec again before touching the remote profile.
  const bundles = typeof row.bundles === 'string' ? row.bundles.trim().slice(0, 500) : '';
  return {
    id,
    label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : id,
    url,
    sshHost,
    remotePort: Number(row.remotePort) || 27993,
    localPort: Number(row.localPort) || 0,
    remoteLog: typeof row.remoteLog === 'string' ? row.remoteLog.trim() : '',
    serviceKind: kind,
    serviceUnit: unit,
    profile: PROFILE_PATTERN.test(rawProfile) ? rawProfile : 'web',
    updateChannel: CHANNEL_PATTERN.test(rawChannel) ? rawChannel : '',
    bundles,
    // Sidebar visibility is a config choice so a configured host can stay out
    // of the left column without being deleted.
    sidebar: row.sidebar !== false,
  };
}

// The single source of truth: invalid rows are dropped, the first duplicate id
// wins, and an empty list stays empty (the plugin has no built-in host).
export function configuredServers(config) {
  const servers = [];
  const seen = new Set();
  for (const row of configList(config)) {
    const server = toServer(row);
    if (!server || seen.has(server.id)) continue;
    seen.add(server.id);
    servers.push(server);
  }
  return servers;
}
