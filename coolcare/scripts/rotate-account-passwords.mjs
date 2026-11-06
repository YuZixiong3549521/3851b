import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, open, lstat, chmod, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const privateRoot = fileURLToPath(new URL('../.local/credential-rotations/', import.meta.url));
const roles = ['Customer', 'Technician', 'Admin'];
const help = `Rotate existing account passwords through the authenticated CoolCare API.

node scripts/rotate-account-passwords.mjs --origin=https://your-site --input=C:/private/accounts.json
node scripts/rotate-account-passwords.mjs --origin=https://your-site --input=C:/private/accounts.json --apply
node scripts/rotate-account-passwords.mjs --origin=https://your-site --input=C:/private/accounts.json --resume=C:/absolute/manifest.json --apply

Input JSON: {"accounts":[{"email":"account@example.com","currentPassword":"...","expectedRole":"Customer"}]}
The default plan validates input without network requests or password changes.
--apply saves new passwords to a private ignored manifest BEFORE changing any account.
Keep this manifest private. Passwords and session cookies are never printed.
Resume verifies the saved new password first; an uncertain change is never sent twice.
HTTPS is required except for localhost development. No credentials are sent to redirects.
`;

export function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Provide a valid --origin.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Origin must be HTTPS (or HTTP localhost), with no credentials, path, query or fragment.');
  return url.origin;
}

export function validateAccounts(input) {
  if (!input || !Array.isArray(input.accounts) || input.accounts.length < 1 || input.accounts.length > 20)
    throw new Error('Input must contain 1–20 accounts.');
  const seen = new Set();
  return input.accounts.map(account => {
    const email = typeof account?.email === 'string' ? account.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || seen.has(email))
      throw new Error('Each account needs a valid, unique email address.');
    if (typeof account.currentPassword !== 'string' || !account.currentPassword || account.currentPassword.length > 1024)
      throw new Error('Each account needs a currentPassword string.');
    if (account.expectedRole !== undefined && !roles.includes(account.expectedRole))
      throw new Error('expectedRole must be Customer, Technician or Admin.');
    seen.add(email);
    return { email, currentPassword: account.currentPassword, ...(account.expectedRole ? { expectedRole: account.expectedRole } : {}) };
  });
}

async function regularFile(path) {
  if (!isAbsolute(path)) throw new Error('Input and manifest paths must be absolute.');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024)
    throw new Error('Use a regular JSON file no larger than 128 KB.');
}

let windowsSid;
async function restrictAccess(path, directory = false) {
  if (process.platform === 'win32') {
    windowsSid ??= (await exec('whoami', ['/user', '/fo', 'csv', '/nh'])).stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!windowsSid) throw new Error('Unable to determine the current account for private file permissions.');
    await exec('icacls', [path, '/inheritance:r', '/grant:r', `*${windowsSid}:${directory ? '(OI)(CI)' : ''}F`]);
  } else await chmod(path, directory ? 0o700 : 0o600);
}

async function ensureDirectory(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('The private manifest directory cannot be a symbolic link.');
  await restrictAccess(root, true);
}

export async function savePrivateManifest(path, data, { create = false } = {}) {
  if (!isAbsolute(path)) throw new Error('Manifest path must be absolute.');
  await ensureDirectory(dirname(path));
  if (!create) await regularFile(path);
  const target = create ? path : path + '.' + randomUUID() + '.tmp';
  const file = await open(target, 'wx', 0o600);
  try {
    await restrictAccess(target);
    await file.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8');
    await file.sync();
  } finally { await file.close(); }
  if (!create) {
    try { await rename(target, path); }
    catch (error) { await unlink(target).catch(() => {}); throw error; }
  }
}

function httpError(status) {
  const error = new Error('The server did not accept the request.');
  error.status = status;
  return error;
}

export function apiClient(origin, request = fetch) {
  let cookie = '', csrf = '';
  async function call(path, body) {
    const headers = { Accept: 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) };
    if (body) Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf });
    const response = await request(origin + path, {
      method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0];
      if (pair.startsWith('coolcare.sid=')) cookie = pair.slice('coolcare.sid='.length) ? pair : '';
    }
    if (!response.ok) throw httpError(response.status);
    const data = await response.json();
    if (typeof data.csrf === 'string') csrf = data.csrf;
    return data;
  }
  return {
    async login(email, password, expectedRole) {
      await call('/api/session');
      const data = await call('/api/public/login', { email, password, rememberMe: false });
      if (!data.success || !Number.isSafeInteger(Number(data.user?.id)) || Number(data.user.id) <= 0 ||
          data.user.email?.toLowerCase() !== email || !roles.includes(data.user.role) || (expectedRole && data.user.role !== expectedRole))
        throw new Error('The authenticated account does not match the requested account and role.');
      return data.user;
    },
    async change(userId, currentPassword, newPassword) {
      await call('/api/session');
      const result = await call('/api/public/account/password', { expectedUserId: Number(userId), currentPassword, newPassword, confirmPassword: newPassword });
      if (result.success !== true || result.signInRequired !== true) throw new Error('Password change result could not be confirmed.');
    },
    async logout() {
      try { await call('/api/session'); await call('/api/logout', {}); } catch { /* Session expires independently; never repeat a password change. */ }
    },
  };
}

export async function rotateAccounts({ origin, accounts, manifest, manifestPath, resuming = false, request = fetch, save = savePrivateManifest }) {
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index], entry = manifest.accounts[index];
    if (resuming || entry.status !== 'prepared') {
      const probe = apiClient(origin, request);
      try {
        const user = await probe.login(entry.email, entry.newPassword, entry.expectedRole);
        if (entry.userId !== undefined && Number(user.id) !== entry.userId) throw new Error('Account identity changed.');
        entry.status = 'verified'; entry.userId = Number(user.id); entry.verifiedAt = new Date().toISOString();
        await save(manifestPath, manifest); await probe.logout();
        continue;
      } catch (error) {
        await probe.logout();
        if (error.status !== 401 || ['changing', 'uncertain', 'verified'].includes(entry.status)) {
          entry.status = 'uncertain'; await save(manifestPath, manifest); return;
        }
      }
    }
    const client = apiClient(origin, request);
    try {
      const user = await client.login(account.email, account.currentPassword, account.expectedRole);
      entry.userId = Number(user.id); entry.status = 'changing';
      await save(manifestPath, manifest); // Durable new password must exist before the write is sent.
      await client.change(user.id, account.currentPassword, entry.newPassword);
    } catch (error) {
      entry.status = entry.status === 'changing' && (!error.status || error.status >= 500) ? 'uncertain' : 'rejected';
      if (Number.isInteger(error.status)) entry.httpStatus = error.status;
      await save(manifestPath, manifest); await client.logout();
      return;
    }
    const verify = apiClient(origin, request);
    try {
      const user = await verify.login(account.email, entry.newPassword, account.expectedRole);
      if (Number(user.id) !== entry.userId) throw new Error('Account identity changed.');
      entry.status = 'verified'; entry.verifiedAt = new Date().toISOString();
    } catch { entry.status = 'uncertain'; }
    await save(manifestPath, manifest); await verify.logout();
    if (entry.status !== 'verified') return;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { console.log(help); return; }
  const options = {};
  for (const argument of args) {
    const match = /^(--origin|--input|--resume)=(.+)$/.exec(argument);
    const key = match?.[1] ?? argument;
    if (Object.hasOwn(options, key) || !['--origin', '--input', '--resume', '--apply', '--plan'].includes(key) || (!match && !['--apply', '--plan'].includes(key)))
      throw new Error('Unknown, incomplete or repeated option. Use --help.');
    options[key] = match?.[2] ?? true;
  }
  if (options['--plan'] && options['--apply']) throw new Error('Choose --plan or --apply.');
  const origin = normalizeOrigin(options['--origin']);
  await regularFile(String(options['--input'] || ''));
  const accounts = validateAccounts(JSON.parse(await readFile(options['--input'], 'utf8')));
  if (!options['--apply']) {
    console.log(JSON.stringify({ mode: 'plan', origin, accounts: accounts.map(({ email, expectedRole }) => ({ email, expectedRole })), changes: 0 }, null, 2));
    return;
  }
  await ensureDirectory(privateRoot);
  let manifest, manifestPath;
  if (options['--resume']) {
    manifestPath = options['--resume']; await regularFile(manifestPath);
    const rel = relative(await realpath(privateRoot), await realpath(manifestPath));
    if (!rel || rel.startsWith('..' + sep) || isAbsolute(rel) || dirname(rel) !== '.') throw new Error('Resume a manifest from the private credential-rotations directory.');
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== 1 || manifest.origin !== origin || !Array.isArray(manifest.accounts) || manifest.accounts.length !== accounts.length ||
        manifest.accounts.some((entry, i) => entry.email !== accounts[i].email || entry.expectedRole !== accounts[i].expectedRole ||
          typeof entry.newPassword !== 'string' || !/^[A-Za-z0-9_-]{40,72}$/.test(entry.newPassword) || !['prepared', 'changing', 'verified', 'uncertain', 'rejected'].includes(entry.status)))
      throw new Error('The saved manifest does not match this origin and account input.');
    await restrictAccess(manifestPath);
  } else {
    manifestPath = resolve(privateRoot, randomUUID() + '.json');
    manifest = { version: 1, origin, createdAt: new Date().toISOString(), accounts: accounts.map(({ email, expectedRole }) => ({ email, expectedRole, newPassword: randomBytes(36).toString('base64url'), status: 'prepared' })) };
    await savePrivateManifest(manifestPath, manifest, { create: true });
  }
  // This path is printed before requests so an interrupted run can be resumed safely.
  console.log(JSON.stringify({ manifest: manifestPath }));
  await rotateAccounts({ origin, accounts, manifest, manifestPath, resuming: Boolean(options['--resume']) });
  console.log(JSON.stringify({ manifest: manifestPath, verified: manifest.accounts.filter(a => a.status === 'verified').length, accounts: manifest.accounts.map(({ email, status, httpStatus }) => ({ email, status, httpStatus })) }, null, 2));
  if (manifest.accounts.some(account => account.status !== 'verified')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Errors may contain URLs, response bodies or private JSON. Never print them.
    console.error('Password rotation stopped. Check input, origin and private file access. If a manifest path was printed, preserve it and use --resume; do not start a new rotation for an uncertain result. Use --help for usage.');
    process.exitCode = 1;
  });
}
