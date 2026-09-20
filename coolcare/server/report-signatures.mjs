import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, isAbsolute } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from './inventory.mjs';
import { sessionUser } from './public-site.mjs';
export const signatureDirectory = fileURLToPath(
  new URL('../.local/report-signatures/', import.meta.url),
);
export const signaturePrefix = '/api/report-signatures/';
export const signatureId = (url) =>
  typeof url === 'string' &&
  /^\/api\/report-signatures\/[0-9a-f-]{36}$/.test(url)
    ? url.slice(signaturePrefix.length)
    : null;
export const reportContentHash = (r) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        ['workPerformed', 'problemFound', 'solutionApplied', 'checklist'].map(
          (k) => (r?.[k] ?? '').trim(),
        ),
      ),
    )
    .digest('hex');
export async function normalizeSignature(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > 2 * 1024 * 1024 ||
    bytes.length < 16
  )
    throw new AppError('Choose a PNG or JPEG image up to 2 MB.', 400);
  try {
    const image = sharp(bytes, {
      limitInputPixels: 12000000,
      failOn: 'warning',
    });
    const meta = await image.metadata();
    if (
      !['png', 'jpeg'].includes(meta.format) ||
      meta.pages > 1 ||
      meta.width < 20 ||
      meta.height < 20
    )
      throw new Error('Invalid signature image');
    const png = await image
      .rotate()
      .resize({
        width: 1200,
        height: 600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    const { channels } = await sharp(png).stats();
    if (channels.every((c) => c.stdev < 1)) throw new Error('Blank signature');
    return png;
  } catch {
    throw new AppError(
      'Use a valid, non-blank PNG/JPEG signature image (up to 12 megapixels).',
      400,
    );
  }
}
export async function storeSignature(pool, userId, jobId, signer, raw) {
  const d = z
    .object({
      image: z.string().max(2800000),
      expectedVersion: z.string().length(64),
      report: z
        .object({
          workPerformed: z.string().max(5000),
          problemFound: z.string().max(5000),
          solutionApplied: z.string().max(5000),
          checklist: z.string().max(5000),
        })
        .strict(),
    })
    .strict()
    .parse(raw);
  z.enum(['customer', 'technician']).parse(signer);
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(d.image))
    throw new AppError('Choose a PNG or JPEG image.', 400);
  const [[owner]] = await pool.execute(
    `SELECT w.job_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id JOIN technician t ON t.technician_id=a.technician_id WHERE w.job_id=? AND t.user_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') AND w.current_status IN ('In Progress','Completed')`,
    [jobId, userId],
  );
  if (!owner) throw new AppError('Report not found for this technician.', 404);
  const png = await normalizeSignature(
    Buffer.from(d.image.split(',')[1], 'base64'),
  );
  const id = randomUUID();
  await mkdir(signatureDirectory, { recursive: true });
  const path = join(signatureDirectory, id + '.png');
  await writeFile(path, png, { flag: 'wx' });
  try {
    await pool.execute(
      'INSERT INTO report_signature(signature_id,job_id,uploaded_by_user_id,signer,content_hash,base_version) VALUES(?,?,?,?,?,?)',
      [
        id,
        jobId,
        userId,
        signer,
        reportContentHash(d.report),
        d.expectedVersion,
      ],
    );
  } catch (e) {
    await unlink(path).catch(() => {});
    throw e;
  }
  return { url: signaturePrefix + id };
}
export async function validateReportSignatures(
  c,
  userId,
  jobId,
  version,
  old,
  report,
) {
  const changed = reportContentHash(old) !== reportContentHash(report);
  for (const who of ['customer', 'technician']) {
    const key = who + 'SignatureUrl',
      url = report[key] || '',
      prior = old?.[key] || '';
    if (changed && prior && (!url || url === prior))
      throw new AppError(
        'Report content changed. Please collect a new ' + who + ' signature.',
        400,
      );
    if (!url) continue;
    if (!changed && url === prior) continue;
    const id = signatureId(url);
    if (!id)
      throw new AppError('Draw or upload a new ' + who + ' signature.', 400);
    const [[s]] = await c.execute(
      'SELECT * FROM report_signature WHERE signature_id=?',
      [id],
    );
    if (
      !s ||
      s.job_id !== jobId ||
      s.uploaded_by_user_id !== userId ||
      s.signer !== who ||
      s.content_hash !== reportContentHash(report) ||
      s.base_version !== version
    )
      throw new AppError(
        'This signature does not match this report. Please sign again.',
        400,
      );
  }
}
export async function resolveSignature(pool, user, id) {
  if (!z.uuid().safeParse(id).success)
    throw new AppError('Signature not found.', 404);
  const [[s]] = await pool.execute(
    `SELECT s.*,a.technician_id,t.user_id AS technicianUserId,c.user_id AS customerUserId,r.submitted_time,
 r.customer_signature_url,r.technician_signature_url FROM report_signature s JOIN work_order w ON w.job_id=s.job_id JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id JOIN technician t ON t.technician_id=a.technician_id JOIN booking b ON b.booking_id=w.booking_id JOIN customer c ON c.customer_id=b.customer_id LEFT JOIN service_report r ON r.job_id=w.job_id WHERE s.signature_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled')`,
    [id],
  );
  const linked =
    s &&
    [s.customer_signature_url, s.technician_signature_url].includes(
      signaturePrefix + id,
    );
  const allowed =
    s &&
    ((user.role === 'Technician' &&
      s.technicianUserId === user.id &&
      (linked || s.uploaded_by_user_id === user.id)) ||
      (linked &&
        s.submitted_time &&
        (user.role === 'Admin' ||
          (user.role === 'Customer' && s.customerUserId === user.id))));
  if (!allowed) throw new AppError('Signature not found.', 404);
  try {
    const root = await realpath(signatureDirectory),
      path = await realpath(join(root, id + '.png')),
      child = relative(root, path);
    if (child.startsWith('..') || isAbsolute(child))
      throw new Error('Invalid path');
    return path;
  } catch {
    throw new AppError('Signature image is unavailable.', 404);
  }
}
export function registerSignatureMedia(app, pool) {
  app.get('/api/report-signatures/:id', async (req, res) => {
    const user = await sessionUser(pool, req);
    const path = await resolveSignature(pool, user, req.params.id);
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(path, { dotfiles: 'allow' });
  });
}
