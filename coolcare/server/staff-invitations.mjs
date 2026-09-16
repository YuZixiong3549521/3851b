import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './inventory.mjs';
import { enqueueStaffInvitationEmail } from './booking-email.mjs';

const inviteSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    email: z.email().max(255),
    phone: z.string().trim().max(30).optional().default(''),
  })
  .strict();
const tokenSchema = z.string().min(32).max(256);
const activationSchema = z
  .object({
    token: tokenSchema,
    password: z.string().min(8).max(72),
    confirmPassword: z.string().min(8).max(72),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

async function invitationRow(executor, token, { lock = false } = {}) {
  const [[row]] = await executor.execute(
    `SELECT i.invitation_id AS invitationId,i.user_id AS userId,i.role_name AS roleName,
    i.expires_at AS expiresAt,i.accepted_at AS acceptedAt,i.revoked_at AS revokedAt,u.full_name AS fullName,u.email,u.status
    FROM staff_invitation i JOIN user_account u ON u.user_id=i.user_id WHERE i.token_hash=?${lock ? ' FOR UPDATE' : ''}`,
    [tokenHash(token)],
  );
  return row;
}

function assertUsable(row) {
  if (
    !row ||
    row.acceptedAt ||
    row.revokedAt ||
    row.status !== 'Inactive' ||
    new Date(`${String(row.expiresAt).replace(' ', 'T')}Z`).getTime() <=
      Date.now()
  ) {
    throw new AppError(
      'This invitation is invalid or has expired. Ask an administrator to send a new invitation.',
      410,
    );
  }
}

export async function inviteStaff(
  pool,
  actor,
  roleName,
  raw,
  { origin = process.env.WEB_ORIGIN } = {},
) {
  if (!['Admin', 'Technician'].includes(roleName))
    throw new AppError('Unsupported staff role.', 400);
  if (roleName === 'Admin' && actor.accessLevel !== 'Owner')
    throw new AppError('Only the Owner can invite administrators.', 403);
  const data = inviteSchema.parse(raw),
    email = data.email.trim().toLowerCase();
  const token = randomBytes(32).toString('base64url'),
    hash = tokenHash(token);
  // An unusable random password preserves the existing NOT NULL schema while
  // ensuring an invited account cannot sign in before activation.
  const placeholder = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[role]] = await connection.execute(
      'SELECT role_id AS roleId FROM role WHERE role_name=?',
      [roleName],
    );
    if (!role) throw new AppError('Staff role configuration is missing.', 503);
    let [[user]] = await connection.execute(
      `SELECT u.user_id AS userId,u.status,u.role_id AS roleId
      FROM user_account u WHERE u.email=? FOR UPDATE`,
      [email],
    );
    if (user) {
      if (user.roleId !== role.roleId || user.status !== 'Inactive')
        throw new AppError('An account with this email already exists.', 409);
      await connection.execute(
        'UPDATE user_account SET full_name=?,phone=?,password_hash=? WHERE user_id=?',
        [data.fullName, data.phone || null, placeholder, user.userId],
      );
      await connection.execute(
        'UPDATE staff_invitation SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND accepted_at IS NULL AND revoked_at IS NULL',
        [user.userId],
      );
    } else {
      const [created] = await connection.execute(
        `INSERT INTO user_account(role_id,full_name,email,password_hash,phone,status)
        VALUES (?,?,?,?,?,'Inactive')`,
        [role.roleId, data.fullName, email, placeholder, data.phone || null],
      );
      user = { userId: created.insertId };
    }
    if (roleName === 'Admin')
      await connection.execute(
        `INSERT INTO admin_profile(user_id,department,position,access_level)
      VALUES (?,NULL,NULL,'Admin') ON DUPLICATE KEY UPDATE access_level=IF(access_level='Owner','Owner','Admin')`,
        [user.userId],
      );
    else
      await connection.execute(
        `INSERT INTO technician(user_id,availability_status) VALUES (?,'Available')
      ON DUPLICATE KEY UPDATE availability_status='Available'`,
        [user.userId],
      );
    const [invitation] = await connection.execute(
      `INSERT INTO staff_invitation(user_id,role_name,token_hash,invited_by_user_id,expires_at)
      VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 48 HOUR))`,
      [user.userId, roleName, hash, actor.userId],
    );
    await enqueueStaffInvitationEmail(connection, {
      invitationId: invitation.insertId,
      roleName,
      recipient: email,
      fullName: data.fullName,
      token,
      origin,
    });
    await connection.commit();
    return {
      invitationId: invitation.insertId,
      userId: user.userId,
      fullName: data.fullName,
      email,
      roleName,
      status: 'Pending',
      expiresInHours: 48,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function validateStaffInvitation(pool, rawToken) {
  const token = tokenSchema.parse(rawToken);
  const row = await invitationRow(pool, token);
  assertUsable(row);
  return {
    fullName: row.fullName,
    email: row.email,
    roleName: row.roleName,
    expiresAt: row.expiresAt,
  };
}

export async function acceptStaffInvitation(pool, req, raw) {
  const data = activationSchema.parse(raw);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const connection = await pool.getConnection();
  let user;
  try {
    await connection.beginTransaction();
    const row = await invitationRow(connection, data.token, { lock: true });
    assertUsable(row);
    await connection.execute(
      "UPDATE user_account SET password_hash=?,status='Active' WHERE user_id=? AND status='Inactive'",
      [passwordHash, row.userId],
    );
    await connection.execute(
      'UPDATE staff_invitation SET accepted_at=UTC_TIMESTAMP() WHERE invitation_id=?',
      [row.invitationId],
    );
    await connection.execute(
      'UPDATE staff_invitation SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND invitation_id<>? AND accepted_at IS NULL AND revoked_at IS NULL',
      [row.userId, row.invitationId],
    );
    const [[profile]] =
      row.roleName === 'Admin'
        ? await connection.execute(
            'SELECT access_level AS accessLevel FROM admin_profile WHERE user_id=?',
            [row.userId],
          )
        : [[{}]];
    user = {
      id: row.userId,
      name: row.fullName,
      fullName: row.fullName,
      email: row.email,
      role: row.roleName,
      accessLevel: profile?.accessLevel ?? null,
    };
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await new Promise((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  req.session.portalUser = { id: user.id };
  req.session.csrf = randomBytes(24).toString('hex');
  if (user.role === 'Admin')
    req.session.user = {
      user_id: user.id,
      full_name: user.fullName,
      email: user.email,
      access_level: user.accessLevel,
    };
  return { success: true, user, csrf: req.session.csrf };
}
