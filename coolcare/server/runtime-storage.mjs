import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const legacyDataDirectory = fileURLToPath(new URL('../.local/', import.meta.url));

export function runtimeDataDirectory(env = process.env) {
  if (env.COOLCARE_DATA_DIR) {
    if (!isAbsolute(env.COOLCARE_DATA_DIR)) throw new Error('COOLCARE_DATA_DIR must be an absolute private directory.');
    return resolve(env.COOLCARE_DATA_DIR);
  }
  // App Service deployments replace wwwroot. Keep private media outside it.
  if (env.WEBSITE_INSTANCE_ID || env.WEBSITE_HOSTNAME) return '/home/coolcare-data';
  return legacyDataDirectory;
}

export const dataDirectory = runtimeDataDirectory();
export const privateMediaDirectory = name => join(dataDirectory, name);

// Copy only ordinary media files. Never move/delete the legacy originals or
// overwrite another upload; a conflicting file needs operator investigation.
export async function prepareRuntimeStorage({ source = legacyDataDirectory, destination = dataDirectory } = {}) {
  let copied = 0;
  for (const folder of ['service-photos', 'report-signatures']) {
    const target = join(destination, folder);
    await mkdir(target, { recursive: true, mode: 0o700 });
    if (resolve(source) === resolve(destination)) continue;
    const original = join(source, folder);
    let entries;
    try {
      if ((await lstat(original)).isSymbolicLink()) throw new Error('Legacy media must not be a symbolic link.');
      entries = await readdir(original, { withFileTypes: true });
    } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(png|jpe?g|webp|gif)$/i.test(entry.name)) continue;
      const from = join(original, entry.name), to = join(target, entry.name);
      try { await copyFile(from, to, constants.COPYFILE_EXCL); copied++; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await lstat(to);
        if (!existing.isFile() || existing.isSymbolicLink() || !(await readFile(from)).equals(await readFile(to)))
          throw new Error('Private media migration found a conflicting file; originals were retained.');
      }
    }
  }
  return { copied };
}
