// Version comparison for the "update available" hint. The Host only advertises
// a badge when the remote version is older than the target: a newer remote
// (a nightly host while this app runs stable, for example) is not outdated.
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(value) {
  const match = VERSION.exec(String(value || '').trim());
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] || '',
  };
}

function compareIdentifier(left, right) {
  const leftNumber = /^\d+$/.test(left);
  const rightNumber = /^\d+$/.test(right);
  if (leftNumber && rightNumber) return Number(left) - Number(right);
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

// Semver precedence: numeric triple first, then semver's prerelease rules.
// Build metadata is not compared. A value that does not parse returns null so
// the caller can stay silent instead of guessing.
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1;
  }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const aParts = a.pre.split('.');
  const bParts = b.pre.split('.');
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    if (aParts[index] === undefined) return -1;
    if (bParts[index] === undefined) return 1;
    const order = compareIdentifier(aParts[index], bParts[index]);
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return 0;
}

// Target: an exact updateChannel, otherwise the version this app runs. A
// dist-tag (latest, next) has no target until the registry is resolved, so it
// never produces a badge from a local comparison.
export function updateState(info, channel, localVersion) {
  const remote = info && info.dsh && info.dsh.version;
  const rawChannel = typeof channel === 'string' ? channel.trim() : '';
  const target = rawChannel
    ? (/^[0-9]/.test(rawChannel) ? rawChannel : '')
    : String(localVersion || '').trim();
  if (!remote || !target) return null;
  const order = compareVersions(remote, target);
  if (order === null) return null;
  return { current: String(remote), target, available: order < 0 };
}
