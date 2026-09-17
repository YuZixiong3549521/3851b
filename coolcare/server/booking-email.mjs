import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function mailMode() { return ['smtp', 'disabled'].includes(process.env.MAIL_MODE) ? process.env.MAIL_MODE : 'local'; }

export function buildBookingMail(booking, services) {
  const date = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${booking.preferred_date}T00:00:00Z`));
  const fields = [
    ['Booking reference', `#${booking.booking_id}`], ['Services', services || booking.service_name],
    ...(booking.package_name ? [['Package', booking.package_name]] : []),
    ...(booking.annual_series_id ? [['Annual bundle reference',`#${booking.annual_series_id}`],['Quarterly visit',`${booking.visit_number} of 4`]] : []),
    ['Preferred date', date], ['Preferred arrival', booking.time_window], ['Service address', booking.address_line],
    ['Aircon units', booking.unit_count], ['Status', booking.booking_status],
    [booking.annual_series_id?'Amount allocated to this visit':'Estimated amount', booking.total_amount == null ? 'To be confirmed' : `SGD ${Number(booking.total_amount).toFixed(2)}`],
    ...(booking.annual_series_id ? [['Total for all four visits',`SGD ${Number(booking.annual_total).toFixed(2)} (not an additional charge)`]] : []),
    ...(booking.problem_description ? [['Notes', booking.problem_description]] : []),
  ];
  const greeting = `Hi ${booking.full_name},`;
  const intro = 'Your CoolCare booking request has been saved. Our service team will confirm appointment availability. No payment has been taken.';
  return {
    subject: `CoolCare booking #${booking.booking_id}${booking.annual_series_id?` — annual visit ${booking.visit_number} of 4`:''} received`,
    text: `${greeting}\n\n${intro}\n\n${fields.map(([name, value]) => `${name}: ${value}`).join('\n')}\n\nYou can view this request in My Bookings.\nCoolCare`,
    html: `<div style="font:16px Arial,sans-serif;max-width:600px;color:#172b4d"><h1 style="color:#003f87">Booking request received</h1><p>${escapeHtml(greeting)}</p><p>${intro}</p><table style="width:100%;border-collapse:collapse">${fields.map(([name, value]) => `<tr><th style="padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd">${escapeHtml(name)}</th><td style="padding:10px;border-bottom:1px solid #ddd;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join('')}</table><p>You can view this request in My Bookings.</p><p>CoolCare</p></div>`,
  };
}

async function enqueueMail(connection,{eventKey,eventType,bookingId=null,invitationId=null,recipient,subject,text,html}) {
  const [[existing]] = await connection.execute('SELECT recipient,status,delivery_mode FROM booking_email_outbox WHERE event_key=?',[eventKey]);
  if(existing)return {status:existing.status==='Sent'?'sent':existing.delivery_mode==='disabled'?'disabled':'queued',mode:existing.delivery_mode,recipient:existing.recipient};
  const mode=mailMode();
  await connection.execute(`INSERT INTO booking_email_outbox
    (booking_id,invitation_id,event_type,event_key,recipient,subject,body_text,body_html,message_id,delivery_mode)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,[bookingId,invitationId,eventType,eventKey,recipient,subject,text,html,`<${randomUUID()}@coolcare.local>`,mode]);
  return {status:mode==='disabled'?'disabled':'queued',mode,recipient};
}

// Called inside the booking transaction: a failed booking never produces a mail.
export async function enqueueBookingEmail(connection, bookingId) {
  const [[booking]] = await connection.execute(`SELECT b.booking_id,u.full_name,u.email,b.preferred_service_date AS preferred_date,
    b.preferred_time_slot AS time_window,b.booking_status,b.total_amount,b.problem_description,sa.address_line,sc.service_name,
    bp.package_name,av.series_id AS annual_series_id,av.visit_number,abs.total_amount AS annual_total,
    (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=b.booking_id) AS unit_count
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    JOIN service_address sa ON sa.address_id=b.address_id JOIN service_catalog sc ON sc.service_id=b.service_id
    LEFT JOIN booking_package bp ON bp.booking_id=b.booking_id
    LEFT JOIN annual_booking_visit av ON av.booking_id=b.booking_id
    LEFT JOIN annual_booking_series abs ON abs.series_id=av.series_id WHERE b.booking_id=?`, [bookingId]);
  if (!booking) throw new Error('Cannot queue mail for a missing booking.');
  const [items] = await connection.execute('SELECT service_name FROM booking_service WHERE booking_id=? ORDER BY service_id', [bookingId]);
  const mail = buildBookingMail(booking, items.map(item => item.service_name).join(', '));
  return enqueueMail(connection,{eventKey:`booking.received:${bookingId}`,eventType:'booking.received',bookingId,recipient:booking.email,...mail});
}

export async function enqueueBookingLifecycleEmail(connection,bookingId,eventType,{technicianName='',eventKey=`${eventType}:${bookingId}`}={}) {
  if(eventType!=='booking.assigned')throw new Error('Unsupported booking mail event.');
  const [[booking]]=await connection.execute(`SELECT b.booking_id,b.preferred_service_date,b.preferred_time_slot,
    u.full_name,u.email,sa.address_line,COALESCE(GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', '),MAX(sc.service_name)) AS services
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    JOIN service_address sa ON sa.address_id=b.address_id JOIN service_catalog sc ON sc.service_id=b.service_id
    LEFT JOIN booking_service bs ON bs.booking_id=b.booking_id WHERE b.booking_id=?
    GROUP BY b.booking_id,b.preferred_service_date,b.preferred_time_slot,u.full_name,u.email,sa.address_line`,[bookingId]);
  if(!booking)throw new Error('Cannot queue mail for a missing booking.');
  const common=[['Booking reference',`#${booking.booking_id}`],['Services',booking.services],['Service date',booking.preferred_service_date],['Arrival window',booking.preferred_time_slot],['Service address',booking.address_line]];
  const variants={
    'booking.assigned':{heading:'Booking confirmed and technician assigned',subject:`CoolCare booking #${bookingId} confirmed`,intro:'Your booking has been reviewed, confirmed and assigned to a technician.',extra:[['Technician',technicianName]]},
  }[eventType];
  const fields=[...common,...variants.extra];
  const text=`Hi ${booking.full_name},\n\n${variants.intro}\n\n${fields.map(([name,value])=>`${name}: ${value}`).join('\n')}\n\nView the latest status in My Bookings.\nCoolCare`;
  const html=`<div style="font:16px Arial,sans-serif;max-width:600px;color:#172b4d"><h1 style="color:#003f87">${escapeHtml(variants.heading)}</h1><p>Hi ${escapeHtml(booking.full_name)},</p><p>${escapeHtml(variants.intro)}</p><table style="width:100%;border-collapse:collapse">${fields.map(([name,value])=>`<tr><th style="padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd">${escapeHtml(name)}</th><td style="padding:10px;border-bottom:1px solid #ddd">${escapeHtml(value)}</td></tr>`).join('')}</table><p>View the latest status in My Bookings.</p><p>CoolCare</p></div>`;
  return enqueueMail(connection,{eventKey,eventType,bookingId,recipient:booking.email,subject:variants.subject,text,html});
}

export async function enqueueStaffInvitationEmail(connection,{invitationId,roleName,recipient,fullName,token,origin}) {
  const activationUrl=`${String(origin||'http://localhost:3000').replace(/\/$/,'')}/activate?token=${encodeURIComponent(token)}`;
  const subject=`Activate your CoolCare ${roleName} account`;
  const text=`Hi ${fullName},\n\nYou have been invited to join CoolCare as ${roleName}. Activate your account within 48 hours:\n${activationUrl}\n\nIf you did not expect this invitation, you can ignore this email.\nCoolCare`;
  const html=`<div style="font:16px Arial,sans-serif;max-width:600px;color:#172b4d"><h1 style="color:#003f87">Activate your CoolCare account</h1><p>Hi ${escapeHtml(fullName)},</p><p>You have been invited to join CoolCare as <strong>${escapeHtml(roleName)}</strong>.</p><p><a href="${escapeHtml(activationUrl)}" style="display:inline-block;padding:12px 18px;background:#003f87;color:white;text-decoration:none;border-radius:8px">Set your password</a></p><p>This single-use link expires in 48 hours.</p><p>If you did not expect this invitation, you can ignore this email.</p></div>`;
  return enqueueMail(connection,{eventKey:`staff.invited:${invitationId}`,eventType:'staff.invited',invitationId,recipient,subject,text,html});
}

export function createMailTransport(mode = mailMode()) {
  if (mode === 'disabled') return null;
  if (mode === 'local') return nodemailer.createTransport({ host: '127.0.0.1', port: Number(process.env.LOCAL_SMTP_PORT || 1025), secure: false, ignoreTLS: true, connectionTimeout: 5000, socketTimeout: 15000, disableFileAccess: true, disableUrlAccess: true });
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) throw new Error('Configure SMTP_HOST and MAIL_FROM for external mail.');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.SMTP_SECURE !== 'true',
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10000, socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true,
  });
}

// Claim one committed message at a time, then release the DB lock before SMTP.
// A stable Message-ID is reused on retries; SMTP cannot guarantee exactly-once delivery after a connection loss.
export async function deliverPendingBookingEmails(pool, { transport, mode = mailMode(), limit = 10 } = {}) {
  if (mode === 'disabled') return 0;
  const sender = transport || createMailTransport(mode);
  let delivered = 0;
  for (let i = 0; i < limit; i++) {
    const c = await pool.getConnection();
    let row;
    try {
      await c.beginTransaction();
      [[row]] = await c.execute(`SELECT * FROM booking_email_outbox WHERE delivery_mode=? AND
        ((status='Pending' AND next_attempt_at<=NOW()) OR (status='Sending' AND locked_at<DATE_SUB(NOW(),INTERVAL 5 MINUTE)))
        ORDER BY email_id LIMIT 1 FOR UPDATE SKIP LOCKED`, [mode]);
      if (row) await c.execute("UPDATE booking_email_outbox SET status='Sending',locked_at=NOW(),attempts=attempts+1 WHERE email_id=?", [row.email_id]);
      await c.commit();
    } catch (error) { await c.rollback(); throw error; }
    finally { c.release(); }
    if (!row) break;
    try {
      const info = await sender.sendMail({
        from: mode === 'local' ? 'CoolCare Demo <bookings@coolcare.test>' : process.env.MAIL_FROM,
        to: { address: row.recipient }, subject: row.subject, text: row.body_text, html: row.body_html, messageId: row.message_id,
      });
      if (!info.accepted?.length) throw Object.assign(new Error('Recipient not accepted.'), { code: 'RECIPIENT_REJECTED' });
      await pool.execute("UPDATE booking_email_outbox SET status='Sent',sent_at=NOW(),locked_at=NULL,last_error=NULL WHERE email_id=?", [row.email_id]);
      delivered++;
    } catch (error) {
      // Store a bounded error code, never SMTP credentials or server transcript.
      const errorCode = String(error.code || 'DELIVERY_FAILED').replace(/[^A-Z0-9_]/gi, '').slice(0, 80);
      const delay = Math.min(3600, 30 * 2 ** Math.min(Number(row.attempts), 7));
      await pool.execute("UPDATE booking_email_outbox SET status='Pending',locked_at=NULL,last_error=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL ? SECOND) WHERE email_id=?", [errorCode, delay, row.email_id]);
    }
  }
  return delivered;
}

export function startBookingEmailWorker(pool) {
  let running = false;
  let stopped = false;
  let active = Promise.resolve();
  function tick() {
    if (running || stopped) return;
    running = true;
    active = deliverPendingBookingEmails(pool).catch(error => console.error('Booking mail worker:', error.code || error.name)).finally(() => { running = false; });
  }
  const interval = setInterval(tick, 5000);
  interval.unref();
  tick();
  return async () => { stopped = true; clearInterval(interval); await active; };
}
