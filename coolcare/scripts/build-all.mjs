import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
for (const [cwd, args] of [
  [resolve(root,'technician'), ['node_modules/vite/bin/vite.js', 'build']],
  [root, ['node_modules/vinext/dist/cli.js', 'build']],
]) {
  const result = spawnSync(process.execPath, args, {cwd, stdio:'inherit', windowsHide:true});
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
