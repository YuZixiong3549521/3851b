import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { enqueueStaffInvitationEmail } from '../server/booking-email.mjs';

const root = resolve(import.meta.dirname, '..');
process.loadEnvFile(resolve(root, '.env.local'));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(process.argv[index], process.argv[index + 1]);
const email = String(args.get('--email') || '')
    .trim()
    .toLowerCase(),
  fullName = String(args.get('--name') || '').trim(),
  phone = String(args.get('--phone') || '').trim();
if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    'Usage: npm run staff:bootstrap-owner -- --name "Owner Name" --email owner@example.com [--phone 91234567]',
  );
  process.exit(1);
}
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
});
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [[owner]] = await connection.execute(
    "SELECT a.user_id FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id WHERE a.access_level='Owner' AND u.status='Active' LIMIT 1 FOR UPDATE",
  );
  if (owner)
    throw new Error(
      'An active Owner already exists. Transfer ownership from the Admin Console.',
    );
  const [[role]] = await connection.execute(
    "SELECT role_id FROM role WHERE role_name='Admin'",
  );
  let [[user]] = await connection.execute(
    `SELECT u.user_id,u.status,r.role_name FROM user_account u JOIN role r ON r.role_id=u.role_id WHERE u.email=? FOR UPDATE`,
    [email],
  );
  const placeholder = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
  if (user) {
    if (user.role_name !== 'Admin' || user.status !== 'Inactive')
      throw new Error(
        'This email belongs to an existing account that cannot become the bootstrap Owner.',
      );
    await connection.execute(
      'UPDATE user_account SET full_name=?,phone=?,password_hash=? WHERE user_id=?',
      [fullName, phone || null, placeholder, user.user_id],
    );
  } else {
    const [created] = await connection.execute(
      "INSERT INTO user_account(role_id,full_name,email,password_hash,phone,status) VALUES (?,?,?,?,?,'Inactive')",
      [role.role_id, fullName, email, placeholder, phone || null],
    );
    user = { user_id: created.insertId };
  }
  await connection.execute(
    "INSERT INTO admin_profile(user_id,access_level) VALUES (?,'Owner') ON DUPLICATE KEY UPDATE access_level='Owner'",
    [user.user_id],
  );
  await connection.execute(
    'UPDATE staff_invitation SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND accepted_at IS NULL AND revoked_at IS NULL',
    [user.user_id],
  );
  const token = randomBytes(32).toString('base64url'),
    hash = createHash('sha256').update(token).digest('hex');
  const [invitation] = await connection.execute(
    `INSERT INTO staff_invitation(user_id,role_name,token_hash,invited_by_user_id,expires_at)
    VALUES (?,'Admin',?,NULL,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 48 HOUR))`,
    [user.user_id, hash],
  );
  await enqueueStaffInvitationEmail(connection, {
    invitationId: invitation.insertId,
    roleName: 'Owner',
    recipient: email,
    fullName,
    token,
    origin: process.env.WEB_ORIGIN,
  });
  await connection.commit();
  console.log(
    `Owner activation email queued for ${email}. Open Mailpit or the configured mailbox within 48 hours.`,
  );
} catch (error) {
  await connection.rollback();
  console.error(error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
