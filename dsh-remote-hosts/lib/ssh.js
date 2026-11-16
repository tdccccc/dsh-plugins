// Audited SSH options for one endpoint. Values are restricted to a shell-safe
// charset so the generated "-o Key=Value" list can be passed to ssh (and to the
// helper scripts through DSH_SSH_OPTIONS) without quoting games. Anything not
// on the list is dropped instead of becoming an arbitrary ssh directive.
const OPTION_KEYS = new Set([
  'ProxyJump',
  'IdentityFile',
  'IdentitiesOnly',
  'User',
  'Port',
  'ConnectTimeout',
  'ServerAliveInterval',
  'ServerAliveCountMax',
  'StrictHostKeyChecking',
  'UserKnownHostsFile',
  'PreferredAuthentications',
  'PubkeyAuthentication',
  'HostKeyAlgorithms',
  'AddressFamily',
]);
const VALUE_PATTERN = /^[A-Za-z0-9@._,:/~+=-]{1,200}$/;

export function normalizeSshOptions(value) {
  const rows = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split('\n') : [];
  const options = [];
  for (const raw of rows) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) continue;
    const at = text.indexOf('=');
    if (at <= 0) continue;
    const key = text.slice(0, at).trim();
    const optionValue = text.slice(at + 1).trim();
    if (!OPTION_KEYS.has(key) || !VALUE_PATTERN.test(optionValue)) continue;
    const option = key + '=' + optionValue;
    if (!options.includes(option)) options.push(option);
  }
  return options;
}

export function sshArgs(options) {
  const args = [];
  for (const option of Array.isArray(options) ? options : []) args.push('-o', option);
  return args;
}

// Helper scripts read this as an unquoted word list. Only validated options are
// allowed here, so the expansion cannot introduce a second command.
export function sshEnv(options) {
  const args = sshArgs(normalizeSshOptions(options));
  if (!args.length) return null;
  return { ...process.env, DSH_SSH_OPTIONS: args.join(' ') };
}
