import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { productionConfig } from '../server/production-config.mjs';
import { createProductionGateway } from '../server/production-gateway.mjs';

const cwd = resolve(import.meta.dirname, '..');
process.env.NODE_ENV = 'production';
let config;
try {
  config = productionConfig();
  if (!existsSync(resolve(cwd, 'dist/server/index.js')) && !existsSync(resolve(cwd, 'dist/server/entry.js')))
    throw new Error('Production web build is missing. Run npm run build before deployment.');
  if (!existsSync(resolve(cwd, 'public/technician/index.html')))
    throw new Error('Technician build is missing. Run npm run build before deployment.');
} catch (error) {
  console.error(`CoolCare startup failed: ${error.message}`);
  process.exit(1);
}
const env = { ...process.env, WEB_ORIGIN: config.origin, API_PORT: String(config.apiPort),
  VINEXT_TRUST_PROXY: '1', VINEXT_TRUSTED_HOSTS: new URL(config.origin).host };
const children = [];
const gateway = createProductionGateway(config);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  gateway.close();
  for (const child of children) child.kill('SIGTERM');
  const deadline = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 10000);
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise(done => child.once('exit', done))))
    .then(() => { clearTimeout(deadline); process.exit(code); });
}
for (const args of [
  ['server/index.mjs'],
  ['node_modules/vinext/dist/cli.js', 'start', '--hostname', '127.0.0.1', '--port', String(config.webPort)],
]) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(`CoolCare child startup failed: ${error.code}`); stop(1); });
  child.on('exit', code => {
    if (!stopping) { console.error(`CoolCare service exited (${code ?? 'signal'}).`); stop(1); }
  });
}
gateway.on('error', error => { console.error(`CoolCare listener failed: ${error.code}`); stop(1); });
gateway.listen(config.port, '0.0.0.0', () => console.log(`CoolCare production listener: 0.0.0.0:${config.port}`));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
// Node process managers can request graceful shutdown over their private IPC channel.
if (process.channel) process.on('message', message => { if (message === 'shutdown') stop(); });
