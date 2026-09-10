import express from 'express';
import { createCustomerRouter } from './customer/router.mjs';
import { createTechnicianRouter } from './technician.mjs';
import { createPublicRouter } from './public-site.mjs';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  AppError,
  idSchema,
  savePart,
  recordTransaction,
  toCsv,
} from './inventory.mjs';

const transactionSelect = `SELECT t.*, p.part_name, u.full_name AS admin_name, o.stock_before, o.stock_after,
 COALESCE(o.stock_delta, CASE WHEN t.transaction_type IN ('Stock In', 'Return') THEN t.quantity WHEN t.transaction_type = 'Stock Out' THEN -t.quantity ELSE NULL END) AS stock_delta
 FROM inventory_transaction t JOIN part p ON p.part_id=t.part_id
 LEFT JOIN user_account u ON u.user_id=t.admin_user_id
 LEFT JOIN inventory_web_operation o ON o.transaction_id=t.transaction_id`;
const pageNumber = z.coerce.number().int().min(1).max(1000000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(10);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
function partFilter(query, threshold) {
  const data = z
    .object({
      q: z.string().max(120).default(''),
      status: z.enum(['', 'Active', 'Inactive', 'Discontinued']).default(''),
      stock: z.enum(['', 'low', 'out', 'healthy']).default(''),
      sort: z.enum(['name', 'id', 'stock', 'value', 'price']).default('name'),
      order: z.enum(['asc', 'desc']).default('asc'),
      page: pageNumber,
      pageSize,
    })
    .parse(query);
  const clauses = [],
    values = [];
  if (data.q) {
    clauses.push('(part_name LIKE ? OR CAST(part_id AS CHAR) = ?)');
    values.push(`%${data.q}%`, data.q.replace(/^PT-0*/i, ''));
  }
  if (data.status) {
    clauses.push('status = ?');
    values.push(data.status);
  }
  if (data.stock === 'low') {
    clauses.push('current_stock <= ?');
    values.push(threshold);
  }
  if (data.stock === 'out') clauses.push('current_stock = 0');
  if (data.stock === 'healthy') {
    clauses.push('current_stock > ?');
    values.push(threshold);
  }
  return {
    data,
    values,
    where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
    sort:
      {
        name: 'part_name',
        id: 'part_id',
        stock: 'current_stock',
        value: 'stock_value',
        price: 'unit_price',
      }[data.sort] +
      ' ' +
      data.order.toUpperCase() +
      ', part_id ASC',
  };
}
function transactionFilter(query) {
  const data = z
    .object({
      q: z.string().max(120).default(''),
      type: z
        .enum(['', 'Stock In', 'Stock Out', 'Return', 'Adjustment'])
        .default(''),
      part: z.union([z.literal(''), idSchema]).default(''),
      from: date.optional(),
      to: date.optional(),
      page: pageNumber,
      pageSize,
    })
    .parse(query);
  if (data.from && data.to && data.from > data.to)
    throw new AppError('Start date must be on or before end date.');
  const clauses = [],
    values = [];
  if (data.q) {
    clauses.push(
      '(p.part_name LIKE ? OR t.remarks LIKE ? OR CAST(t.transaction_id AS CHAR) = ?)',
    );
    values.push(`%${data.q}%`, `%${data.q}%`, data.q.replace(/^TX-0*/i, ''));
  }
  if (data.type) {
    clauses.push('t.transaction_type = ?');
    values.push(data.type);
  }
  if (data.part) {
    clauses.push('t.part_id = ?');
    values.push(data.part);
  }
  if (data.from) {
    clauses.push('t.created_at >= ?');
    values.push(data.from);
  }
  if (data.to) {
    clauses.push('t.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(data.to);
  }
  return {
    data,
    values,
    where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
  };
}
export function createApp({
  pool,
  secret,
  origin = 'http://localhost:3000',
  threshold = 15,
}) {
  if (!secret || secret.length < 32)
    throw new Error('Set a strong local SESSION_SECRET.');
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname))
      return res.status(403).json({ error: 'Only localhost is allowed.' });
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    if (req.headers.origin && req.headers.origin !== origin)
      return res.status(403).json({ error: 'Untrusted request origin.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  // Memory sessions are intentional for this local-only edition. Restart => sign in again.
  app.use(
    session({
      name: 'coolcare.sid',
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1 FROM inventory_web_operation LIMIT 1');
      res.json({ ready: true });
    } catch {
      res
        .status(503)
        .json({
          ready: false,
          error:
            'MySQL connection is unavailable. Check the local service and setup.',
        });
    }
  });
  app.get('/api/session', async (req, res) => {
    req.session.csrf ??= randomBytes(24).toString('hex');
    res.json({
      user: req.session.user ?? null,
      csrf: req.session.csrf,
      low_stock_threshold: threshold,
    });
  });
  app.use('/api', (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (!req.session.csrf || req.get('X-CSRF-Token') !== req.session.csrf)
    )
      return res
        .status(403)
        .json({
          error: 'Session expired. Refresh the page and sign in again.',
        });
    next();
  });
  app.use('/api/public', createPublicRouter(pool));
  app.use('/api/customer', createCustomerRouter(pool));
  app.use('/api/technician', createTechnicianRouter(pool));
  app.post(
    '/api/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 15,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many attempts. Please try again in 15 minutes.' },
    }),
    async (req, res) => {
      const data = z
        .object({
          email: z.email().max(255),
          password: z.string().min(1).max(128),
        })
        .parse(req.body);
      const [[user]] = await pool.execute(
        `SELECT u.user_id, u.full_name, u.email, u.password_hash, u.status, r.role_name FROM user_account u JOIN role r ON u.role_id=r.role_id JOIN admin_profile a ON a.user_id=u.user_id WHERE u.email=?`,
        [data.email.trim().toLowerCase()],
      );
      const hash =
        user?.password_hash ||
        '$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.';
      const matches = await bcrypt.compare(data.password, hash);
      if (
        !user ||
        !matches ||
        user.status !== 'Active' ||
        user.role_name !== 'Admin'
      )
        throw new AppError(
          'Incorrect credentials or inactive admin account.',
          401,
        );
      await new Promise((resolve, reject) =>
        req.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      req.session.user = {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
      };
      req.session.portalUser = { id: user.user_id };
      req.session.csrf = randomBytes(24).toString('hex');
      res.json({ user: req.session.user, csrf: req.session.csrf });
    },
  );
  app.post('/api/logout', (req, res, next) =>
    req.session.destroy((error) =>
      error ? next(error) : res.clearCookie('coolcare.sid').json({ ok: true }),
    ),
  );
  app.use('/api', async (req, res, next) => {
    if (!req.session.user)
      throw new AppError('Please sign in with an admin account.', 401);
    const [[user]] = await pool.execute(
      `SELECT u.user_id FROM user_account u JOIN role r ON r.role_id=u.role_id JOIN admin_profile a ON a.user_id=u.user_id WHERE u.user_id=? AND u.status='Active' AND r.role_name='Admin'`,
      [req.session.user.user_id],
    );
    if (!user) throw new AppError('Admin access is no longer available.', 403);
    next();
  });
  app.get('/api/overview', async (req, res) => {
    const [[summary]] = await pool.execute(
      `SELECT COUNT(*) AS total_parts, COALESCE(SUM(current_stock),0) AS total_units, COALESCE(SUM(current_stock*unit_price),0) AS stock_value, COALESCE(SUM(current_stock<=?),0) AS low_stock, COALESCE(SUM(current_stock=0),0) AS out_of_stock FROM part`,
      [threshold],
    );
    const [parts] = await pool.query(
      'SELECT *, current_stock * unit_price AS stock_value FROM part ORDER BY current_stock ASC, part_id ASC LIMIT 8',
    );
    const [recent] = await pool.query(
      transactionSelect +
        ' ORDER BY t.created_at DESC,t.transaction_id DESC LIMIT 6',
    );
    res.json({ summary, parts, recent, threshold });
  });
  app.get('/api/options', async (req, res) => {
    const [parts] = await pool.query(
      'SELECT * FROM part ORDER BY part_name LIMIT 10000',
    );
    const [jobs] = await pool.query(
      'SELECT job_id,current_status FROM work_order ORDER BY job_id DESC LIMIT 500',
    );
    res.json({ parts, jobs });
  });
  app.get('/api/parts', async (req, res) => {
    const f = partFilter(req.query, threshold);
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM part' + f.where,
      f.values,
    );
    const page = Math.min(
      f.data.page,
      Math.max(1, Math.ceil(total / f.data.pageSize)),
    );
    const [rows] = await pool.query(
      'SELECT *, current_stock * unit_price AS stock_value FROM part' +
        f.where +
        ' ORDER BY ' +
        f.sort +
        ' LIMIT ? OFFSET ?',
      [...f.values, f.data.pageSize, (page - 1) * f.data.pageSize],
    );
    res.json({ rows, total, page, pageSize: f.data.pageSize });
  });
  app.get('/api/parts/export', async (req, res) => {
    const f = partFilter(req.query, threshold);
    const [rows] = await pool.query(
      'SELECT *,current_stock*unit_price AS stock_value FROM part' +
        f.where +
        ' ORDER BY ' +
        f.sort +
        ' LIMIT 10001',
      f.values,
    );
    if (rows.length > 10000)
      throw new AppError(
        'Narrow the filters to export at most 10,000 records.',
      );
    res
      .type('text/csv')
      .attachment('coolcare-parts.csv')
      .send(
        toCsv(
          [
            'Part ID',
            'Part name',
            'Unit price',
            'Status',
            'Current stock',
            'Stock value',
          ],
          rows.map((p) => [
            p.part_id,
            p.part_name,
            p.unit_price,
            p.status,
            p.current_stock,
            p.stock_value,
          ]),
        ),
      );
  });
  app.get('/api/parts/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const [[part]] = await pool.execute(
      'SELECT *, current_stock * unit_price AS stock_value FROM part WHERE part_id=?',
      [id],
    );
    if (!part) throw new AppError('Part not found.', 404);
    res.json(part);
  });
  app.post('/api/parts', async (req, res) =>
    res.status(201).json(await savePart(pool, req.body)),
  );
  app.put('/api/parts/:id', async (req, res) =>
    res.json(await savePart(pool, req.body, idSchema.parse(req.params.id))),
  );
  app.get('/api/transactions', async (req, res) => {
    const f = transactionFilter(req.query);
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM inventory_transaction t JOIN part p ON p.part_id=t.part_id' +
        f.where,
      f.values,
    );
    const page = Math.min(
      f.data.page,
      Math.max(1, Math.ceil(total / f.data.pageSize)),
    );
    const [rows] = await pool.query(
      transactionSelect +
        f.where +
        ' ORDER BY t.created_at DESC,t.transaction_id DESC LIMIT ? OFFSET ?',
      [...f.values, f.data.pageSize, (page - 1) * f.data.pageSize],
    );
    res.json({ rows, total, page, pageSize: f.data.pageSize });
  });
  app.get('/api/transactions/export', async (req, res) => {
    const f = transactionFilter(req.query);
    const [rows] = await pool.query(
      transactionSelect +
        f.where +
        ' ORDER BY t.created_at DESC,t.transaction_id DESC LIMIT 10001',
      f.values,
    );
    if (rows.length > 10000)
      throw new AppError(
        'Narrow the filters to export at most 10,000 records.',
      );
    res
      .type('text/csv')
      .attachment('coolcare-transactions.csv')
      .send(
        toCsv(
          [
            'Transaction ID',
            'Date/time (server local)',
            'Part',
            'Type',
            'Quantity',
            'Stock change',
            'Job ID',
            'Admin',
            'Remarks',
          ],
          rows.map((t) => [
            t.transaction_id,
            t.created_at,
            t.part_name,
            t.transaction_type,
            t.quantity,
            t.stock_delta,
            t.job_id,
            t.admin_name,
            t.remarks,
          ]),
        ),
      );
  });
  app.post('/api/transactions', async (req, res) =>
    res
      .status(201)
      .json(await recordTransaction(pool, req.body, req.session.user.user_id)),
  );
  app.use('/api', (req, res) =>
    res.status(404).json({ error: 'Endpoint not found.' }),
  );
  app.use((error, req, res, next) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({
          error: error.issues
            .map((i) => `${i.path.join('.') || 'Form'}: ${i.message}`)
            .join(' '),
        });
    if (error instanceof AppError)
      return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request is too large.' });
    if (
      error.code === 'ER_DUP_ENTRY' ||
      error.code === 'ER_LOCK_DEADLOCK' ||
      error.code === 'ER_LOCK_WAIT_TIMEOUT'
    )
      return res
        .status(409)
        .json({
          error:
            'Another request is updating this record. Refresh and try again.',
        });
    console.error('API error:', error.code || error.name);
    res
      .status(503)
      .json({
        error:
          'Database request failed. Check that MySQL is running, then retry.',
      });
  });
  return app;
}
