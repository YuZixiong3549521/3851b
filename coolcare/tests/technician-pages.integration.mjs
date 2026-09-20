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
      availability: 'On Leave',
    };
    const saved = await saveProfile(db, a.userId, input);
    assert.equal(saved.primaryRegion, 'North District');
    assert.equal(saved.availability, 'On Leave');
    assert.equal(saved.email, p.email);
    assert.equal(
      (await saveProfile(db, a.userId, input)).availability,
      'On Leave',
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
