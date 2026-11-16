// Session activity reported by `bin/remote.sh probe`. dsh writes session
// files under ~/.dsh/sessions; the probe counts the ones touched inside a
// window. The Host half reads that summary before it restarts or stops the
// remote unit, because those actions kill whatever the remote is running.
const DEFAULT_WINDOW_MINUTES = 10;
const MAX_WINDOW_MINUTES = 1440;

// The config may be a plain object or a schemastery reference read with get().
export function sessionWindowMinutes(config) {
  const raw = config && config.sessionWindow;
  const value = raw && typeof raw.get === 'function' ? raw.get() : raw;
  const minutes = Math.trunc(Number(value));
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_WINDOW_MINUTES
    ? minutes
    : DEFAULT_WINDOW_MINUTES;
}

// A null answer means "nothing to warn about": no session data, or no recent
// activity. The shape mirrors the probe payload so the browser can render the
// count, the window and up to two session ids without another round trip.
export function recentSessions(info, windowMinutes) {
  const sessions = info && info.sessions;
  if (!sessions || typeof sessions !== 'object') return null;
  const active = Math.trunc(Number(sessions.active));
  if (!Number.isFinite(active) || active <= 0) return null;
  const files = Math.trunc(Number(sessions.files));
  const window = Math.trunc(Number(sessions.window));
  const latestAge = sessions.latestAge === null || sessions.latestAge === undefined
    ? null
    : Math.trunc(Number(sessions.latestAge));
  const ids = Array.isArray(sessions.ids)
    ? sessions.ids
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim())
      .slice(0, 2)
    : [];
  return {
    active,
    files: Number.isFinite(files) && files > 0 ? files : 0,
    window: Number.isFinite(window) && window >= 1 && window <= MAX_WINDOW_MINUTES
      ? window
      : windowMinutes,
    latestAge: Number.isFinite(latestAge) && latestAge >= 0 ? latestAge : null,
    ids,
  };
}
