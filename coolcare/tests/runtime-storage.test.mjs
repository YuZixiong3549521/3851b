import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeDataDirectory, prepareRuntimeStorage, legacyDataDirectory } from '../server/runtime-storage.mjs';

test('media stays local by default and outside deployment on App Service', () => {
  assert.equal(runtimeDataDirectory({}), legacyDataDirectory);
  assert.equal(runtimeDataDirectory({ WEBSITE_HOSTNAME: 'coolcare.azurewebsites.net' }), '/home/coolcare-data');
  const directory = join(tmpdir(), 'private-media');
  assert.equal(runtimeDataDirectory({ COOLCARE_DATA_DIR: directory }), directory);
  assert.throws(() => runtimeDataDirectory({ COOLCARE_DATA_DIR: 'public/uploads' }), /absolute private directory/);
});

test('media migration preserves originals, skips non-media, replays, and refuses overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coolcare-media-'));
  const source = join(root, 'old-app', '.local'), destination = join(root, 'persistent');
  try {
    await mkdir(join(source, 'service-photos'), { recursive: true });
    await mkdir(join(source, 'report-signatures'), { recursive: true });
    await writeFile(join(source, 'service-photos', 'test.jpg'), 'test photo');
    await writeFile(join(source, 'report-signatures', 'test.png'), 'test signature');
    await writeFile(join(source, 'service-photos', 'secret.txt'), 'not a photo');
    assert.deepEqual(await prepareRuntimeStorage({ source, destination }), { copied: 2 });
    assert.deepEqual(await prepareRuntimeStorage({ source, destination }), { copied: 0 });
    assert.equal(await readFile(join(source, 'service-photos', 'test.jpg'), 'utf8'), 'test photo');
    await assert.rejects(readFile(join(destination, 'service-photos', 'secret.txt')), { code: 'ENOENT' });
    // Simulate a replacement application directory without touching persistent media.
    const newSource = join(root, 'new-app', '.local');
    assert.deepEqual(await prepareRuntimeStorage({ source: newSource, destination }), { copied: 0 });
    assert.equal(await readFile(join(destination, 'report-signatures', 'test.png'), 'utf8'), 'test signature');
    await writeFile(join(destination, 'service-photos', 'test.jpg'), 'different existing photo');
    await assert.rejects(prepareRuntimeStorage({ source, destination }), /conflicting file/);
    assert.equal(await readFile(join(destination, 'service-photos', 'test.jpg'), 'utf8'), 'different existing photo');
  } finally { await rm(root, { recursive: true, force: true }); }
});
