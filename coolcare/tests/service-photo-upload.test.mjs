import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  photoUploadSchema,
  normalizeServicePhoto,
} from '../server/service-photo-upload.mjs';
import { randomUUID } from 'node:crypto';
test('service photo requires note and validates bounds', () => {
  assert.ok(
    photoUploadSchema.safeParse({
      requestId: randomUUID(),
      description: ' Before cleaning ',
      image: 'x',
    }).success,
  );
  assert.equal(
    photoUploadSchema.safeParse({
      requestId: randomUUID(),
      description: ' ',
      image: 'x',
    }).success,
    false,
  );
  assert.equal(
    photoUploadSchema.safeParse({
      requestId: randomUUID(),
      description: 'x'.repeat(256),
      image: 'x',
    }).success,
    false,
  );
});
test('service photo re-encodes images and rejects fake, oversized and unsupported files', async () => {
  const png = await sharp({
    create: { width: 100, height: 100, channels: 3, background: 'blue' },
  })
    .png()
    .toBuffer();
  const output = await normalizeServicePhoto(
    'data:image/png;base64,' + png.toString('base64'),
  );
  assert.equal((await sharp(output).metadata()).format, 'jpeg');
  for (const image of [
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,ZmFrZQ==',
    'data:image/png;base64,' +
      Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
  ])
    await assert.rejects(normalizeServicePhoto(image), (e) => e.status === 400);
});
