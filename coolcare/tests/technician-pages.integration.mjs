import { recordStockBatch,recordTransaction } from '../server/inventory.mjs';
import {getServiceProgress,updateServiceProgress} from '../server/service-progress.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import {
  getReport,
  saveReport,
  getProfile,
  saveProfile,
  changePassword,
} from '../server/technician-pages.mjs';
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
});
after(() => pool.end());
async function fixture(fn) {
  const c = await pool.getConnection();
  await c.beginTransaction();
  const h = {
    execute: c.execute.bind(c),
    query: c.query.bind(c),
    beginTransaction: () => c.query('SAVEPOINT pages'),
    commit: () => c.query('RELEASE SAVEPOINT pages'),
    rollback: () => c.query('ROLLBACK TO SAVEPOINT pages'),
    release() {},
  };
  const db = { ...h, getConnection: async () => h };
  try {
    const [[actor]] = await c.execute(
      `SELECT t.user_id AS userId,w.job_id AS jobId FROM technician t JOIN assignment a ON a.technician_id=t.technician_id JOIN work_order w ON w.assignment_id=a.assignment_id WHERE a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') LIMIT 1`,
    );
    assert.ok(actor);
    await c.execute(
      'UPDATE service_report SET customer_signature_url=NULL,technician_signature_url=NULL WHERE job_id=?',
      [actor.jobId],
    );
    await fn(db, c, actor);
  } finally {
    await c.rollback();
    c.release();
  }
}
const report = {
  workPerformed: 'Cleaned and checked the indoor unit.',
  problemFound: 'Dust buildup',
  solutionApplied: 'Cleaned filter',
  checklist: 'Cooling and drainage checked',
  customerSignatureUrl: '',
  technicianSignatureUrl: '',
};
test('report submission completes the visit, edits persist with audit and preserve completion time, retries are idempotent', () =>
  fixture(async (db, c, a) => {
    await c.execute(
      "UPDATE work_order SET current_status='In Progress' WHERE job_id=?",
      [a.jobId],
    );
    const initial = await getReport(db, a.userId, a.jobId);
    const input = {
      requestId: randomUUID(),
      expectedVersion: initial.version,
      report,
    };
    await saveReport(db, a.userId, a.jobId, input);
    const saved = await getReport(db, a.userId, a.jobId);
    assert.equal(saved.status, 'Completed');
    assert.equal(saved.report.workPerformed, report.workPerformed);
    assert.ok(saved.report.submittedAt);
    const edited = {
      requestId: randomUUID(),
      expectedVersion: saved.version,
      report: {
        ...report,
        workPerformed: 'Revised: cleaned filters and tested all controls.',
      },
    };
    await saveReport(db, a.userId, a.jobId, edited);
    assert.equal(
      (await saveReport(db, a.userId, a.jobId, edited)).replayed,
      true,
    );
    const updated = await getReport(db, a.userId, a.jobId);
    assert.equal(updated.report.completedAt, saved.report.completedAt);
    assert.equal(updated.report.submittedAt, saved.report.submittedAt);
    assert.equal(updated.history.length, saved.history.length + 1);
    assert.equal(updated.report.workPerformed, edited.report.workPerformed);
    await assert.rejects(
      saveReport(db, a.userId, a.jobId, { ...edited, report }),
      (e) => e.status === 409,
    );
    await assert.rejects(
      saveReport(db, a.userId, a.jobId, { ...input, requestId: randomUUID() }),
      (e) => e.status === 409,
    );
    const [[b]] = await c.execute(
      'SELECT b.booking_status,a.assignment_status FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN assignment a ON a.assignment_id=w.assignment_id WHERE w.job_id=?',
      [a.jobId],
    );
    assert.equal(b.booking_status, 'Completed');
    assert.equal(b.assignment_status, 'Completed');
  }));
test('reports reject another user and services that have not started', () =>
  fixture(async (db, c, a) => {
    await assert.rejects(
      getReport(db, 4294967295, a.jobId),
      (e) => e.status === 404,
    );
    const initial = await getReport(db, a.userId, a.jobId);
    await assert.rejects(
      saveReport(db, 4294967295, a.jobId, {
        requestId: randomUUID(),
        expectedVersion: initial.version,
        report,
      }),
      (e) => e.status === 404,
    );
    await c.execute(
      "UPDATE work_order SET current_status='Assigned' WHERE job_id=?",
      [a.jobId],
    );
    await assert.rejects(
      saveReport(db, a.userId, a.jobId, {
        requestId: randomUUID(),
        expectedVersion: initial.version,
        report,
      }),
      (e) => e.status === 409,
    );
  }));
test('profile edits persist, email cannot be edited, availability uses dispatch state and stale edits are rejected', () =>
  fixture(async (db, c, a) => {
    const p = await getProfile(db, a.userId);
    const input = {
      expectedVersion: p.version,
      fullName: p.fullName,
      phone: '91234567',
      primaryRegion: 'North District',
      basePostalCode:'018956',
      availability: 'Busy',
    };
    const saved = await saveProfile(db, a.userId, input);
    assert.equal(saved.primaryRegion, 'North District');
    assert.equal(saved.basePostalCode,'018956');
    assert.equal(saved.availability, 'Busy');
    assert.equal(saved.email, p.email);
    assert.equal(
      (await saveProfile(db, a.userId, input)).availability,
      'Busy',
    );
    await assert.rejects(
      saveProfile(db, a.userId, { ...input, fullName: 'Stale edit' }),
      (e) => e.status === 409,
    );
    await assert.rejects(
      saveProfile(db, a.userId, { ...input, email: 'x@example.test' }),
    );
  }));
test('password changes verify the current password and store a bcrypt hash', () =>
  fixture(async (db, c, a) => {
    await c.execute('UPDATE user_account SET password_hash=? WHERE user_id=?', [
      await bcrypt.hash('Old-Test-2026!', 4),
      a.userId,
    ]);
    await assert.rejects(
      changePassword(db, a.userId, {
        currentPassword: 'Wrong-Test-2026!',
        newPassword: 'New-Test-2026!',
        confirmPassword: 'New-Test-2026!',
      }),
      (e) => e.status === 400,
    );
    await changePassword(db, a.userId, {
      currentPassword: 'Old-Test-2026!',
      newPassword: 'New-Test-2026!',
      confirmPassword: 'New-Test-2026!',
    });
    const [[u]] = await c.execute(
      'SELECT password_hash FROM user_account WHERE user_id=?',
      [a.userId],
    );
    assert.ok(await bcrypt.compare('New-Test-2026!', u.password_hash));
    assert.notEqual(u.password_hash, 'New-Test-2026!');
  }));

test('private signatures bind to report content and require recollection after edits', () =>
  fixture(async (db, c, a) => {
    const {
      storeSignature,
      resolveSignature,
      signatureDirectory,
      signatureId,
    } = await import('../server/report-signatures.mjs');
    const { default: sharp } = await import('sharp'),
      { unlink } = await import('node:fs/promises'),
      { join } = await import('node:path');
    const pixels = Buffer.alloc(120 * 60 * 3, 255);
    for (let x = 20; x < 100; x++) {
      const k = (30 * 120 + x) * 3;
      pixels[k] = pixels[k + 1] = pixels[k + 2] = 0;
    }
    const image =
      'data:image/png;base64,' +
      (
        await sharp(pixels, { raw: { width: 120, height: 60, channels: 3 } })
          .png()
          .toBuffer()
      ).toString('base64');
    const content = (r) =>
        Object.fromEntries(
          ['workPerformed', 'problemFound', 'solutionApplied', 'checklist'].map(
            (k) => [k, r[k]],
          ),
        ),
      urls = [];
    const [[customer]] = await c.execute(
      'SELECT cu.user_id AS id FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id WHERE w.job_id=?',
      [a.jobId],
    );
    try {
      await c.execute(
        "UPDATE work_order SET current_status='Completed' WHERE job_id=?",
        [a.jobId],
      );
      const original = await getReport(db, a.userId, a.jobId),
        data = {
          image,
          expectedVersion: original.version,
          report: content(report),
        };
      await assert.rejects(
        storeSignature(db, 4294967295, a.jobId, 'customer', data),
        (e) => e.status === 404,
      );
      for (const who of ['customer', 'technician'])
        urls.push((await storeSignature(db, a.userId, a.jobId, who, data)).url);
      const signed = {
        ...report,
        customerSignatureUrl: urls[0],
        technicianSignatureUrl: urls[1],
      };
      assert.ok(
        await resolveSignature(
          db,
          { id: a.userId, role: 'Technician' },
          signatureId(urls[0]),
        ),
      );
      for (const user of [
        { id: customer.id, role: 'Customer' },
        { id: 1, role: 'Admin' },
        { id: 4294967295, role: 'Technician' },
      ])
        await assert.rejects(
          resolveSignature(db, user, signatureId(urls[0])),
          (e) => e.status === 404,
        );
      await saveReport(db, a.userId, a.jobId, {
        requestId: randomUUID(),
        expectedVersion: original.version,
        report: signed,
      });
      for (const user of [
        { id: customer.id, role: 'Customer' },
        { id: 1, role: 'Admin' },
      ])
        assert.ok(await resolveSignature(db, user, signatureId(urls[0])));
      await assert.rejects(
        resolveSignature(
          db,
          { id: 4294967295, role: 'Customer' },
          signatureId(urls[0]),
        ),
        (e) => e.status === 404,
      );
      const saved = await getReport(db, a.userId, a.jobId),
        changed = { ...report, workPerformed: 'Changed report details' };
      await assert.rejects(
        saveReport(db, a.userId, a.jobId, {
          requestId: randomUUID(),
          expectedVersion: saved.version,
          report: { ...signed, workPerformed: changed.workPerformed },
        }),
        /new customer signature/,
      );
      const fresh = [];
      for (const who of ['customer', 'technician']) {
        const s = await storeSignature(db, a.userId, a.jobId, who, {
          image,
          expectedVersion: saved.version,
          report: content(changed),
        });
        urls.push(s.url);
        fresh.push(s.url);
      }
      await saveReport(db, a.userId, a.jobId, {
        requestId: randomUUID(),
        expectedVersion: saved.version,
        report: {
          ...changed,
          customerSignatureUrl: fresh[0],
          technicianSignatureUrl: fresh[1],
        },
      });
      assert.equal(
        (await getReport(db, a.userId, a.jobId)).report.workPerformed,
        changed.workPerformed,
      );
      await assert.rejects(
        resolveSignature(
          db,
          { id: customer.id, role: 'Customer' },
          signatureId(urls[0]),
        ),
        (e) => e.status === 404,
      );
      const { createApp } = await import('../server/app.mjs');
      const server = createApp({
        pool: db,
        secret: process.env.SESSION_SECRET,
      }).listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      let cookie = '',
        csrf = '';
      const request = async (path, method = 'GET', body, token = csrf) => {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}${path}`,
          {
            method,
            headers: {
              Cookie: cookie,
              'X-CSRF-Token': token,
              'Content-Type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        if (response.headers.get('set-cookie'))
          cookie = response.headers.get('set-cookie').split(';')[0];
        return response;
      };
      try {
        assert.equal((await request(fresh[0])).status, 401);
        const [[account]] = await c.execute(
          'SELECT email FROM user_account WHERE user_id=?',
          [a.userId],
        );
        await c.execute(
          'UPDATE user_account SET password_hash=? WHERE user_id=?',
          [await bcrypt.hash('SignatureFixture2026!', 4), a.userId],
        );
        csrf = (await (await request('/api/session')).json()).csrf;
        const login = await request('/api/public/login', 'POST', {
          email: account.email,
          password: 'SignatureFixture2026!',
        });
        assert.equal(login.status, 200);
        csrf = (await login.json()).csrf;
        const media = await request(fresh[0]);
        assert.equal(media.status, 200);
        assert.equal(media.headers.get('content-type'), 'image/png');
        assert.equal(media.headers.get('cache-control'), 'private, no-store');
        assert.ok((await media.arrayBuffer()).byteLength > 30);
        const uploadPath = `/api/technician/reports/${a.jobId}/signatures/customer`;
        assert.equal((await request(uploadPath, 'POST', data, '')).status, 403);
        const uploaded = await request(uploadPath, 'POST', data);
        assert.equal(uploaded.status, 201);
        urls.push((await uploaded.json()).url);
        assert.equal(
          (
            await request(uploadPath, 'POST', {
              ...data,
              image: 'data:image/png;base64,ZmFrZQ==',
            })
          ).status,
          400,
        );
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      for (const url of urls)
        await unlink(join(signatureDirectory, signatureId(url) + '.png')).catch(
          () => {},
        );
    }
  }));

test('service photo uploads store notes, retry without duplication and serve private images through HTTP', () =>
  fixture(async (db, c, a) => {
    const { uploadServicePhoto, listServicePhotos } =
      await import('../server/service-photo-upload.mjs');
    const { resolveReportPhoto } =
      await import('../server/customer/report-photos.mjs');
    const { unlink } = await import('node:fs/promises');
    const { default: sharp } = await import('sharp');
    const { createApp } = await import('../server/app.mjs');
    const png = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#4488aa' },
    })
      .png()
      .toBuffer();
    const payload = {
      requestId: randomUUID(),
      description: 'Synthetic photo test note',
      image: 'data:image/png;base64,' + png.toString('base64'),
    };
    let path, server;
    try {
      await assert.rejects(
        uploadServicePhoto(db, 4294967295, a.jobId, payload),
        (e) => e.status === 404,
      );
      await c.execute(
        "UPDATE work_order SET current_status='In Progress' WHERE job_id=?",
        [a.jobId],
      );
      const result = await uploadServicePhoto(db, a.userId, a.jobId, payload);
      const [[record]] = await c.execute(
        'SELECT photo_url,description FROM photo WHERE photo_id=?',
        [result.photoId],
      );
      path = await resolveReportPhoto(record.photo_url);
      assert.ok(path);
      assert.equal(record.description, payload.description);
      assert.equal(
        (await uploadServicePhoto(db, a.userId, a.jobId, payload)).photoId,
        result.photoId,
      );
      await assert.rejects(
        uploadServicePhoto(db, a.userId, a.jobId, {
          ...payload,
          description: 'Different note',
        }),
        (e) => e.status === 409,
      );
      assert.ok(
        (await listServicePhotos(db, a.jobId)).some(
          (p) =>
            p.photoId === result.photoId &&
            p.description === payload.description,
        ),
      );
      server = createApp({
        pool: db,
        secret: process.env.SESSION_SECRET,
      }).listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      let cookie = '',
        csrf = '';
      const request = async (url, method = 'GET', body, token = csrf) => {
        const r = await fetch(
          `http://127.0.0.1:${server.address().port}${url}`,
          {
            method,
            headers: {
              Cookie: cookie,
              'X-CSRF-Token': token,
              'Content-Type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        if (r.headers.get('set-cookie'))
          cookie = r.headers.get('set-cookie').split(';')[0];
        return r;
      };
      const url = '/api/service-photos/' + result.photoId;
      assert.equal((await request(url)).status, 401);
      const [[u]] = await c.execute(
        'SELECT email FROM user_account WHERE user_id=?',
        [a.userId],
      );
      await c.execute(
        'UPDATE user_account SET password_hash=? WHERE user_id=?',
        [await bcrypt.hash('PhotoFixture2026!', 4), a.userId],
      );
      csrf = (await (await request('/api/session')).json()).csrf;
      const login = await request('/api/public/login', 'POST', {
        email: u.email,
        password: 'PhotoFixture2026!',
      });
      assert.equal(login.status, 200);
      csrf = (await login.json()).csrf;
      const image = await request(url);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('cache-control'), 'private, no-store');
      assert.equal(image.headers.get('content-type'), 'image/jpeg');
      await image.arrayBuffer();
      const route = `/api/technician/reports/${a.jobId}/photos`;
      assert.equal((await request(route, 'POST', payload, '')).status, 403);
      const retry = await request(route, 'POST', payload);
      assert.equal(retry.status, 201);
      assert.equal((await retry.json()).replayed, true);
      assert.equal(
        (await request(`/api/technician/reports/4294967295/photos`)).status,
        404,
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (path) await unlink(path);
    }
  }));

test('start and end service independently of report submission, with customer history visibility',()=>fixture(async(db,c,a)=>{
 const {updateTechnicianJobStatus}=await import('../server/technician.mjs');
 const {listBookings,getBookingReport}=await import('../server/customer/booking-service.mjs');
 await c.execute("UPDATE work_order SET current_status='Assigned' WHERE job_id=?",[a.jobId]);
 await c.execute('UPDATE service_report SET submitted_time=NULL,started_at=NULL,completed_at=NULL WHERE job_id=?',[a.jobId]);
 const [[owner]]=await c.execute('SELECT b.booking_id AS bookingId,cu.user_id AS userId FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id WHERE w.job_id=?',[a.jobId]);
 await updateTechnicianJobStatus(db,a.userId,a.jobId,{requestId:randomUUID(),expectedStatus:'Assigned',status:'In Progress'});
 const end={requestId:randomUUID(),expectedStatus:'In Progress',status:'Completed'};
 await updateTechnicianJobStatus(db,a.userId,a.jobId,end);
 assert.equal((await updateTechnicianJobStatus(db,a.userId,a.jobId,end)).replayed,true);
 const ended=await getReport(db,a.userId,a.jobId);
 assert.equal(ended.status,'Completed');assert.ok(ended.report.startedAt);assert.ok(ended.report.completedAt);assert.equal(ended.report.submittedAt,null);
 const bookings=await listBookings(db,'history',owner.userId);const history=bookings.find(b=>b.bookingId===owner.bookingId);
 assert.equal(history.status,'Completed');assert.equal(history.reportId,null);
 await assert.rejects(getBookingReport(db,owner.bookingId,owner.userId),e=>e.status===404||e.statusCode===404);
 await saveReport(db,a.userId,a.jobId,{requestId:randomUUID(),expectedVersion:ended.version,report});
 const submitted=await getReport(db,a.userId,a.jobId);assert.ok(submitted.report.submittedAt);assert.equal(submitted.report.completedAt,ended.report.completedAt);
 assert.ok((await getBookingReport(db,owner.bookingId,owner.userId)).reportId);
}));

test('batch parts issue is atomic, preserves descriptions, and retries without duplicate stock deductions', () =>
  fixture(async (db, c, a) => {
    const [parts] = await c.execute("SELECT part_id FROM part WHERE status='Active' ORDER BY part_id LIMIT 2");
    assert.equal(parts.length, 2);
    for (const p of parts) await c.execute('UPDATE part SET current_stock=20 WHERE part_id=?', [p.part_id]);
    const input = { request_id: randomUUID(), items: parts.map((p, i) => ({
      part_id: p.part_id, quantity: i + 1, expected_stock: 20,
      remarks: `Batch service part ${i + 1}`, acknowledge_excess: true,
    })) };
    const failed = structuredClone(input);
    failed.items[1].expected_stock = 19;
    await assert.rejects(recordStockBatch(db, failed, a.jobId, a.userId));
    for (const p of parts) {
      const [[stock]] = await c.execute('SELECT current_stock FROM part WHERE part_id=?', [p.part_id]);
      assert.equal(Number(stock.current_stock), 20);
    }
    const saved = await recordStockBatch(db, input, a.jobId, a.userId);
    assert.equal(saved.transactions.length, 2);
    assert.equal(saved.replayed, false);
    assert.equal((await recordStockBatch(db, input, a.jobId, a.userId)).replayed, true);
    for (let i = 0; i < parts.length; i++) {
      const [[stock]] = await c.execute('SELECT current_stock FROM part WHERE part_id=?', [parts[i].part_id]);
      assert.equal(Number(stock.current_stock), 19 - i);
      const [[tx]] = await c.execute('SELECT remarks FROM inventory_transaction WHERE transaction_id=?', [saved.transactions[i].transaction_id]);
      assert.equal(tx.remarks, input.items[i].remarks);
    }
    const changed = structuredClone(input);
    changed.items.pop();
    await assert.rejects(recordStockBatch(db, changed, a.jobId, a.userId));
    await assert.rejects(recordStockBatch(db, { request_id: randomUUID(), items: [input.items[0], input.items[0]] }, a.jobId, a.userId));
  }));

test('service extensions reserve actual time, reject conflicts and retain a single audit entry on retry',()=>fixture(async(db,c,a)=>{
 const [[work]]=await c.execute('SELECT w.booking_id,a.technician_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id WHERE w.job_id=?',[a.jobId]);
 const date='2035-02-05';
 await c.execute("UPDATE work_order SET current_status='In Progress',appointment_date=?,appointment_time='09:00:00' WHERE job_id=?",[date+' 09:00:00',a.jobId]);
 await c.execute("UPDATE booking SET booking_status='In Progress',preferred_service_date=?,slot_start='09:00:00',slot_end='10:00:00' WHERE booking_id=?",[date,work.booking_id]);
 const initial=await getServiceProgress(db,a.jobId);
 const input={requestId:randomUUID(),expectedVersion:initial.version,action:'extend',minutes:30,reason:'More cleaning required',notes:'Two units need additional drain cleaning.'};
 await assert.rejects(updateServiceProgress(db,4294967295,a.jobId,input),e=>e.status===404);
 const saved=await updateServiceProgress(db,a.userId,a.jobId,input);
 assert.equal((await updateServiceProgress(db,a.userId,a.jobId,input)).replayed,true);
 const after=await getServiceProgress(db,a.jobId);
 assert.equal(after.extensionMinutes,initial.extensionMinutes+30);assert.equal(after.expectedEndTime,'10:30:00');assert.equal(after.events.length,initial.events.length+1);
 assert.ok(after.events[0].reportId);assert.equal(saved.reportId,after.events[0].reportId);
 await assert.rejects(updateServiceProgress(db,a.userId,a.jobId,{...input,notes:'Different work details'}),e=>e.status===409);
 await assert.rejects(updateServiceProgress(db,a.userId,a.jobId,{...input,requestId:randomUUID()}),e=>e.status===409);
 const [[other]]=await c.execute('SELECT job_id,booking_id,assignment_id FROM work_order WHERE job_id<>? LIMIT 1',[a.jobId]);
 assert.ok(other);
 await c.execute("UPDATE assignment SET technician_id=?,assignment_status='Accepted' WHERE assignment_id=?",[work.technician_id,other.assignment_id]);
 await c.execute("UPDATE work_order SET current_status='Assigned',appointment_date=?,appointment_time='10:30:00' WHERE job_id=?",[date+' 10:30:00',other.job_id]);
 await c.execute("UPDATE booking SET booking_status='Assigned',preferred_service_date=?,slot_start='10:30:00',slot_end='12:00:00' WHERE booking_id=?",[date,other.booking_id]);
 await assert.rejects(updateServiceProgress(db,a.userId,a.jobId,{...input,requestId:randomUUID(),expectedVersion:after.version}),e=>e.status===409);
 assert.equal((await getServiceProgress(db,a.jobId)).expectedEndTime,'10:30:00');
 await c.execute("UPDATE booking SET slot_end='18:00:00' WHERE booking_id=?",[work.booking_id]);
 await assert.rejects(updateServiceProgress(db,a.userId,a.jobId,{...input,requestId:randomUUID(),expectedVersion:after.version}),e=>e.status===409);
 assert.equal((await getServiceProgress(db,a.jobId)).events.length,after.events.length);
}));

test('technicians cannot schedule return visits directly',()=>fixture(async(db,c,a)=>{
 await c.execute("UPDATE work_order SET current_status='Completed' WHERE job_id=?",[a.jobId]);
 const p=await getServiceProgress(db,a.jobId);
 await assert.rejects(updateServiceProgress(db,a.userId,a.jobId,{requestId:randomUUID(),expectedVersion:p.version,action:'schedule-return',date:'2035-02-06',start:'09:00',durationMinutes:60,notes:'Trying to bypass admin confirmation.'}),e=>e.status===409);
}));

test('technician repair quotes are audited without customer approval, and require own repair job and CSRF',()=>fixture(async(db,c,a)=>{
 const [[work]]=await c.execute('SELECT booking_id FROM work_order WHERE job_id=?',[a.jobId]);
 const [[repair]]=await c.execute("SELECT service_id FROM simple_service_catalog WHERE code='repair'");
 await c.execute("UPDATE work_order SET current_status='In Progress' WHERE job_id=?",[a.jobId]);
 await c.execute('UPDATE booking SET service_id=? WHERE booking_id=?',[repair.service_id,work.booking_id]);
 let progress=await getServiceProgress(db,a.jobId);
 const input={requestId:randomUUID(),expectedVersion:progress.version,action:'repair-quote',amount:85.5,notes:'Replacement capacitor and repair labour.'};
 await updateServiceProgress(db,a.userId,a.jobId,input);assert.equal((await updateServiceProgress(db,a.userId,a.jobId,input)).replayed,true);
 progress=await getServiceProgress(db,a.jobId);assert.equal(progress.additionalRepairFee,85.5);assert.equal(progress.repairQuoteNote,input.notes);
 await assert.rejects(updateServiceProgress(db,4294967295,a.jobId,{...input,requestId:randomUUID(),expectedVersion:progress.version}),e=>e.status===404);
 const {createApp}=await import('../server/app.mjs'),server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 let cookie='',csrf='';
 const request=async(path,method='GET',body,token=csrf)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Cookie:cookie,'X-CSRF-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
 try{
  const path=`/api/technician/jobs/${a.jobId}/service-progress`;
  csrf=(await(await request('/api/session')).json()).csrf;
  assert.equal((await request(path,'PATCH',input)).status,401);
  const [[account]]=await c.execute('SELECT email FROM user_account WHERE user_id=?',[a.userId]);
  await c.execute('UPDATE user_account SET password_hash=? WHERE user_id=?',[await bcrypt.hash('ProgressFixture2026!',4),a.userId]);
  const login=await request('/api/public/login','POST',{email:account.email,password:'ProgressFixture2026!'});assert.equal(login.status,200);csrf=(await login.json()).csrf;
  const changed={...input,requestId:randomUUID(),expectedVersion:progress.version,amount:95,notes:'Updated capacitor and labour quotation.'};
  assert.equal((await request(path,'PATCH',changed,'')).status,403);
  const response=await request(path,'PATCH',changed);assert.equal(response.status,200);assert.equal((await getServiceProgress(db,a.jobId)).additionalRepairFee,95);
  assert.equal((await request('/api/technician/jobs/4294967295/service-progress','PATCH',changed)).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));

test('stock issue checks the locked current assignment and cancelled work before any deduction',()=>fixture(async(db,c,a)=>{
 const [[part]]=await c.execute("SELECT part_id FROM part WHERE status='Active' LIMIT 1");await c.execute('UPDATE part SET current_stock=20 WHERE part_id=?',[part.part_id]);
 const item={part_id:part.part_id,quantity:1,expected_stock:20,acknowledge_excess:true};
 await c.execute("UPDATE work_order SET current_status='Cancelled' WHERE job_id=?",[a.jobId]);
 await assert.rejects(recordStockBatch(db,{request_id:randomUUID(),items:[item]},a.jobId,a.userId),e=>e.status===404);
 await assert.rejects(recordTransaction(db,{...item,request_id:randomUUID(),transaction_type:'Stock Out',job_id:a.jobId},null,a.userId),e=>e.status===404);
 const [[stock]]=await c.execute('SELECT current_stock FROM part WHERE part_id=?',[part.part_id]);assert.equal(stock.current_stock,20);
}));

test('profile leave changes reject active work, reserved return visits and insufficient capacity, but permit safe leave',()=>fixture(async(db,c,a)=>{
 const [[tech]]=await c.execute('SELECT technician_id FROM technician WHERE user_id=?',[a.userId]);
 const [[work]]=await c.execute('SELECT booking_id,assignment_id FROM work_order WHERE job_id=?',[a.jobId]);
 const [[other]]=await c.execute("SELECT t.technician_id FROM technician t JOIN user_account u ON u.user_id=t.user_id WHERE u.status='Active' AND t.technician_id<>? LIMIT 1",[tech.technician_id]);assert.ok(other);
 // All setup remains within this fixture's outer rollback transaction.
 await c.execute("UPDATE work_order w JOIN assignment a ON a.assignment_id=w.assignment_id SET w.current_status='Completed' WHERE a.technician_id=?",[tech.technician_id]);
 await c.execute("UPDATE assignment SET assignment_status='Accepted' WHERE assignment_id=?",[work.assignment_id]);
 await c.execute("UPDATE technician SET availability_status='Unavailable'");
 await c.execute("UPDATE technician SET availability_status='Available' WHERE technician_id IN (?,?)",[tech.technician_id,other.technician_id]);
 await c.execute("UPDATE booking SET booking_status='Cancelled' WHERE booking_status IN ('Submitted','Confirmed','Assigned','On The Way','In Progress')");
 await c.execute("UPDATE service_progress SET follow_up_status='Completed' WHERE follow_up_status IN ('Scheduled','In Progress')");
 const profile=await getProfile(db,a.userId),input={expectedVersion:profile.version,fullName:profile.fullName,phone:'91234567',primaryRegion:profile.primaryRegion,basePostalCode:profile.basePostalCode,availability:'On Leave'};
 await c.execute("UPDATE work_order SET current_status='In Progress',appointment_date='2000-01-01 09:00:00' WHERE job_id=?",[a.jobId]);
 await assert.rejects(saveProfile(db,a.userId,input),e=>e.status===409&&/work orders/.test(e.message));
 assert.equal((await getProfile(db,a.userId)).availability,'Available');
 await c.execute("UPDATE work_order SET current_status='Completed' WHERE job_id=?",[a.jobId]);
 await c.execute("INSERT INTO service_progress(job_id,follow_up_status,follow_up_date,follow_up_start,follow_up_end) VALUES (?,'Scheduled','2035-02-06','09:00:00','10:00:00') ON DUPLICATE KEY UPDATE follow_up_status='Scheduled',follow_up_date='2035-02-06',follow_up_start='09:00:00',follow_up_end='10:00:00'",[a.jobId]);
 await assert.rejects(saveProfile(db,a.userId,input),e=>e.status===409&&/work orders/.test(e.message));
 await c.execute("UPDATE service_progress SET follow_up_status='Completed' WHERE job_id=?",[a.jobId]);
 const insert=async(start,end)=>{const [result]=await c.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status) SELECT customer_id,address_id,service_id,'2035-02-06','09:00 - 11:00',?,?,'Submitted' FROM booking WHERE booking_id=?",[start,end,work.booking_id]);return result.insertId;};
 await insert('09:00:00','10:00:00');const second=await insert('09:15:00','09:45:00');
 await assert.rejects(saveProfile(db,a.userId,input),e=>e.status===409&&/reserved customer time slots/.test(e.message));
 await c.execute("UPDATE booking SET slot_start='10:00:00',slot_end='11:00:00' WHERE booking_id=?",[second]);
 assert.equal((await saveProfile(db,a.userId,input)).availability,'On Leave');
}));
