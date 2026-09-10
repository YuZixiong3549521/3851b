import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const cwd = resolve(import.meta.dirname, '..');
if (!existsSync(resolve(cwd, '.env.local'))) {
  console.error('Run npm run setup first.');
  process.exit(1);
}
const technicianBuild = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: resolve(cwd, 'technician'), stdio: 'inherit', windowsHide: true,
});
if (technicianBuild.error || technicianBuild.status !== 0) process.exit(1);
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 250);
}
for (const args of [
  ['--env-file=.env.local', 'server/index.mjs'],
  ['node_modules/vinext/dist/cli.js', 'dev'],
]) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 0);
  });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
