import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { AppError, idSchema } from './inventory.mjs';
import { sessionUser } from './public-site.mjs';
import {
  reportPhotoDirectory,
  resolveReportPhoto,
} from './customer/report-photos.mjs';
export const photoUploadSchema = z
  .object({
    requestId: z.uuid(),
    description: z
      .string()
      .trim()
      .min(1, 'Add a note for this photo.')
      .max(255),
    image: z.string().max(7000000),
  })
  .strict();
async function owned(c, userId, jobId, lock = false) {
  const [[w]] = await c.execute(
    `SELECT w.job_id,w.current_status FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id WHERE w.job_id=? AND t.user_id=? AND u.status='Active' AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') ${lock ? 'FOR UPDATE' : ''}`,
    [jobId, userId],
  );
  if (!w) throw new AppError('Work order not found for this technician.', 404);
  return w;
}
export async function normalizeServicePhoto(image) {
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(image))
    throw new AppError('Choose a PNG or JPEG photo.', 400);
  const bytes = Buffer.from(image.split(',')[1], 'base64');
  if (bytes.length > 5 * 1024 * 1024)
    throw new AppError('Each photo must be 5 MB or smaller.', 400);
  try {
    const img = sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning' }),
      m = await img.metadata();
    if (
      !['png', 'jpeg'].includes(m.format) ||
      m.pages > 1 ||
      m.width < 20 ||
      m.height < 20
    )
      throw new Error();
    return await img
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#fff' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new AppError(
      'This photo is invalid. Use PNG/JPEG up to 40 megapixels.',
      400,
    );
  }
}
export async function listServicePhotos(pool, jobId) {
  const [rows] = await pool.execute(
    'SELECT photo_id AS photoId,photo_url AS storedPath,description,UNIX_TIMESTAMP(captured_time) AS uploadedAt FROM photo WHERE job_id=? ORDER BY captured_time,photo_id',
    [jobId],
  );
  return Promise.all(
    rows.map(async ({ storedPath, uploadedAt, ...r }) => ({
      ...r,
      uploadedAt: new Date(Number(uploadedAt) * 1000).toISOString(),
      url: (await resolveReportPhoto(storedPath))
        ? '/api/service-photos/' + r.photoId
        : null,
    })),
  );
}
export async function uploadServicePhoto(pool, userId, jobId, raw) {
  const d = photoUploadSchema.parse(raw);
  await owned(pool, userId, jobId);
  const hash = createHash('sha256')
    .update(JSON.stringify({ userId, jobId, ...d }))
    .digest('hex');
  const image = await normalizeServicePhoto(d.image);
  const c = await pool.getConnection();
  let path,
    committing = false;
  try {
    await c.beginTransaction();
    const w = await owned(c, userId, jobId, true);
    if (!['In Progress', 'Completed'].includes(w.current_status))
      throw new AppError(
        'Start the service before uploading process photos.',
        409,
      );
    const [[prior]] = await c.execute(
      'SELECT photo_id,payload_hash FROM service_photo_upload WHERE request_id=?',
      [d.requestId],
    );
    if (prior) {
      if (prior.payload_hash !== hash)
        throw new AppError(
          'This upload request was used for different content.',
          409,
        );
      await c.commit();
      return { photoId: prior.photo_id, replayed: true };
    }
    const [[count]] = await c.execute(
      'SELECT COUNT(*) AS total FROM photo WHERE job_id=?',
      [jobId],
    );
    if (count.total >= 30)
      throw new AppError('A report can contain up to 30 photos.', 400);
    const filename = 'service-' + randomUUID() + '.jpg';
    await mkdir(reportPhotoDirectory, { recursive: true });
    path = join(reportPhotoDirectory, filename);
    await writeFile(path, image, { flag: 'wx' });
    const [p] = await c.execute(
      'INSERT INTO photo(job_id,photo_url,description) VALUES(?,?,?)',
      [jobId, filename, d.description],
    );
    await c.execute(
      'INSERT INTO service_photo_upload(request_id,photo_id,uploaded_by_user_id,payload_hash) VALUES(?,?,?,?)',
      [d.requestId, p.insertId, userId, hash],
    );
    committing = true;
    await c.commit();
    return { photoId: p.insertId, replayed: false };
  } catch (e) {
    await c.rollback().catch(() => {});
    if (path && !committing) await unlink(path).catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export function registerTechnicianPhotos(router, pool) {
  router.get('/reports/:jobId/photos', async (req, res) => {
    const id = idSchema.parse(req.params.jobId);
    await owned(pool, req.technicianUser.id, id);
    res.json({ photos: await listServicePhotos(pool, id) });
  });
  router.post(
    '/reports/:jobId/photos',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 60 }),
    async (req, res) =>
      res
        .status(201)
        .json(
          await uploadServicePhoto(
            pool,
            req.technicianUser.id,
            idSchema.parse(req.params.jobId),
            req.body,
          ),
        ),
  );
}
export function registerServicePhotoMedia(app, pool) {
  app.get('/api/service-photos/:photoId', async (req, res) => {
    const user = await sessionUser(pool, req);
    const [[p]] = await pool.execute(
      `SELECT p.photo_url,t.user_id AS technicianUserId,cu.user_id AS customerUserId,r.submitted_time FROM photo p JOIN work_order w ON w.job_id=p.job_id JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id JOIN technician t ON t.technician_id=a.technician_id JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id LEFT JOIN service_report r ON r.job_id=w.job_id WHERE p.photo_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled')`,
      [idSchema.parse(req.params.photoId)],
    );
    if (
      !p ||
      !(
        user.role === 'Admin' ||
        (user.role === 'Technician' && user.id === p.technicianUserId) ||
        (user.role === 'Customer' &&
          user.id === p.customerUserId &&
          p.submitted_time)
      )
    )
      throw new AppError('Photo not found.', 404);
    const path = await resolveReportPhoto(p.photo_url);
    if (!path) throw new AppError('Photo is unavailable.', 404);
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(path, { dotfiles: 'allow' });
  });
}
