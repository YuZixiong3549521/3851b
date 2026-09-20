import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  normalizeSignature,
  reportContentHash,
  validateReportSignatures,
} from '../server/report-signatures.mjs';
const r = {
  workPerformed: 'Cleaned filters',
  problemFound: 'Dust',
  solutionApplied: 'Cleaning',
  checklist: 'All checked',
};
async function signature() {
  const pixels = Buffer.alloc(120 * 60 * 3, 255);
  for (let i = 20; i < 100; i++) {
    const k = (30 * 120 + i) * 3;
    pixels[k] = pixels[k + 1] = pixels[k + 2] = 0;
  }
  return sharp(pixels, { raw: { width: 120, height: 60, channels: 3 } })
    .png()
    .toBuffer();
}
test('signature image validation fully decodes PNG/JPEG, re-encodes PNG and rejects blank/corrupt/oversized/non-image input', async () => {
  const png = await normalizeSignature(await signature());
  assert.equal((await sharp(png).metadata()).format, 'png');
  const jpeg = await sharp(await signature())
    .jpeg()
    .toBuffer();
  assert.equal(
    (await sharp(await normalizeSignature(jpeg)).metadata()).format,
    'png',
  );
  for (const bad of [
    Buffer.from('<svg onload="alert(1)"></svg>'),
    Buffer.alloc(2 * 1024 * 1024 + 1),
    Buffer.from('not a real image file'),
  ])
    await assert.rejects(normalizeSignature(bad), (e) => e.status === 400);
  await assert.rejects(
    normalizeSignature(
      await sharp({
        create: { width: 100, height: 60, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer(),
    ),
    (e) => e.status === 400,
  );
});
test('content hashes normalize field order and whitespace but bind every service field', () => {
  assert.equal(
    reportContentHash(r),
    reportContentHash({ ...r, workPerformed: '  Cleaned filters  ' }),
  );
  assert.notEqual(
    reportContentHash(r),
    reportContentHash({ ...r, checklist: 'Changed checks' }),
  );
});
test('changed signed reports require fresh signatures and cannot reuse URLs', async () => {
  const db = { execute: async () => [[]] };
  const old = { ...r, customerSignatureUrl: 'https://example.test/old.png' };
  await assert.rejects(
    validateReportSignatures(db, 3, 1, 'a'.repeat(64), old, {
      ...r,
      workPerformed: 'Updated cleaning',
      customerSignatureUrl: '',
    }),
    /new customer signature/,
  );
  await assert.rejects(
    validateReportSignatures(db, 3, 1, 'a'.repeat(64), old, {
      ...r,
      workPerformed: 'Updated cleaning',
      customerSignatureUrl: old.customerSignatureUrl,
    }),
    /new customer signature/,
  );
});
test('signatures are bound to job, uploader, signer, report content and base version', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    version = 'b'.repeat(64);
  const row = {
    job_id: 1,
    uploaded_by_user_id: 3,
    signer: 'customer',
    content_hash: reportContentHash(r),
    base_version: version,
  };
  const form = {
    ...r,
    customerSignatureUrl: '/api/report-signatures/' + id,
    technicianSignatureUrl: '',
  };
  await validateReportSignatures(
    { execute: async () => [[row]] },
    3,
    1,
    version,
    null,
    form,
  );
  for (const patch of [
    { job_id: 2 },
    { uploaded_by_user_id: 4 },
    { signer: 'technician' },
    { content_hash: 'x' },
    { base_version: 'x' },
  ])
    await assert.rejects(
      validateReportSignatures(
        { execute: async () => [[{ ...row, ...patch }]] },
        3,
        1,
        version,
        null,
        form,
      ),
      /does not match/,
    );
});
