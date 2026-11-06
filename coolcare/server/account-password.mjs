import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './inventory.mjs';

export const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.'),
  confirmPassword: z.string(),
}).strict().refine(value => value.newPassword === value.confirmPassword, 'Passwords do not match.')
  .refine(value => value.newPassword !== value.currentPassword, 'Choose a different password.');

// Stored only in the server-side session, never returned to the browser. A login
// racing a password change retains its old fingerprint and cannot restore access.
export function credentialFingerprint(passwordHash) {
  return createHash('sha256').update(passwordHash).digest('hex');
}

const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));

/** Reject stale sessions even if a previously running request re-saved one. */
export function verifySessionCredential(pool) {
  return async (req, _res, next) => {
    const userId = req.session.portalUser?.id ?? req.session.user?.user_id;
    if (userId) {
      const [[row]] = await pool.execute("SELECT password_hash FROM user_account WHERE user_id=? AND status='Active'", [userId]);
      if (!row || req.session.credentialFingerprint !== credentialFingerprint(row.password_hash)) await regenerate(req);
    }
    next();
  };
}

/** The identity is supplied by authenticated server code, never from the body. */
export async function changePassword(pool, userId, raw) {
  const data = passwordSchema.parse(raw);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[account]] = await connection.execute("SELECT password_hash FROM user_account WHERE user_id=? AND status='Active' FOR UPDATE", [userId]);
    if (!account || !await bcrypt.compare(data.currentPassword, account.password_hash)) throw new AppError('Current password is incorrect.', 400);
    const next = await bcrypt.hash(data.newPassword, 12);
    await connection.execute("UPDATE user_account SET password_hash=? WHERE user_id=? AND password_hash=? AND status='Active'", [next, userId, account.password_hash]);
    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

/** Clear all current in-memory sessions for this account, preserving other users. */
export async function invalidateAccountSessions(req, userId) {
  const store = req.sessionStore;
  if (typeof store.all === 'function') {
    // Credential validation above remains authoritative if a session store cannot
    // enumerate sessions, or an in-flight old session is saved after this sweep.
    const sessions = await new Promise(resolve => store.all((error, value) => resolve(error ? {} : value ?? {})));
    await Promise.all(Object.entries(sessions)
      .filter(([, value]) => Number(value.portalUser?.id ?? value.user?.user_id) === Number(userId))
      .map(([id]) => new Promise(resolve => store.destroy(id, () => resolve()))));
  }
  await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
}
