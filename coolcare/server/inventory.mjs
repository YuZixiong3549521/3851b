import { createHash } from 'node:crypto';
import { z } from 'zod';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const idSchema = z.coerce.number().int().positive().max(4294967295);
const priceSchema = z
  .string()
  .trim()
  .regex(
    /^\d{1,8}(\.\d{1,2})?$/,
    'Enter a price from 0 to 99,999,999.99, with at most 2 decimal places.',
  );
export const partSchema = z
  .object({
    part_name: z.string().trim().min(2).max(120),
    unit_price: priceSchema,
    status: z.enum(['Active', 'Inactive', 'Discontinued']),
  })
  .strict();
export const editPartSchema = partSchema.extend({ original: partSchema });
export const transactionSchema = z
  .object({
    request_id: z.uuid(),
    part_id: idSchema,
    transaction_type: z.enum(['Stock In', 'Stock Out', 'Return', 'Adjustment']),
    quantity: z.number().int().min(1).max(2147483647),
    direction: z.enum(['Increase', 'Decrease']).optional(),
    expected_stock: z.number().int().min(0).max(2147483647),
    job_id: idSchema.nullable().default(null),
    remarks: z.string().trim().max(500).default(''),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.transaction_type === 'Adjustment' &&
      (!data.direction || !data.remarks)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'An adjustment requires a direction and a reason.',
      });
    if (data.transaction_type !== 'Adjustment' && data.direction)
      ctx.addIssue({
        code: 'custom',
        message: 'Direction is only used for adjustments.',
      });
  });
export function stockDelta(data) {
  return (
    (data.transaction_type === 'Stock Out' ||
    (data.transaction_type === 'Adjustment' && data.direction === 'Decrease')
      ? -1
      : 1) * data.quantity
  );
}
export function projectedStock(current, delta) {
  const result = current + delta;
  if (!Number.isInteger(result) || result < 0)
    throw new AppError(
      'Not enough stock. Refresh the part and reduce the quantity.',
      409,
    );
  if (result > 2147483647)
    throw new AppError('The resulting stock exceeds the supported limit.');
  return result;
}
async function withTransaction(pool, work, nameLock = false) {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    if (nameLock) {
      const [[row]] = await conn.execute(
        "SELECT GET_LOCK('coolcare_inventory_part_names', 5) AS acquired",
      );
      if (row.acquired !== 1)
        throw new AppError('Parts are being updated. Please try again.', 409);
      locked = true;
    }
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (locked)
      await conn
        .execute("SELECT RELEASE_LOCK('coolcare_inventory_part_names')")
        .catch(() => {});
    conn.release();
  }
}
export async function savePart(pool, raw, id = null) {
  const data = (id === null ? partSchema : editPartSchema).parse(raw);
  return withTransaction(
    pool,
    async (conn) => {
      if (id !== null) {
        const [[current]] = await conn.execute(
          'SELECT * FROM part WHERE part_id = ? FOR UPDATE',
          [id],
        );
        if (!current) throw new AppError('Part not found.', 404);
        if (
          current.part_name !== data.original.part_name ||
          Number(current.unit_price) !== Number(data.original.unit_price) ||
          current.status !== data.original.status
        )
          throw new AppError(
            'This part was edited elsewhere. Reload it before saving.',
            409,
          );
      }
      const [duplicates] = await conn.execute(
        'SELECT part_id FROM part WHERE part_name = ? AND part_id <> ? LIMIT 1',
        [data.part_name, id ?? 0],
      );
      if (duplicates.length)
        throw new AppError('A part with this name already exists.', 409);
      if (id === null) {
        const [result] = await conn.execute(
          'INSERT INTO part (part_name, unit_price, status, current_stock) VALUES (?, ?, ?, 0)',
          [data.part_name, data.unit_price, data.status],
        );
        return { part_id: result.insertId };
      }
      await conn.execute(
        'UPDATE part SET part_name = ?, unit_price = ?, status = ? WHERE part_id = ?',
        [data.part_name, data.unit_price, data.status, id],
      );
      return { part_id: id };
    },
    true,
  );
}
export async function recordTransaction(pool, raw, adminId) {
  const data = transactionSchema.parse(raw);
  const { request_id, ...payload } = data;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...payload, admin_user_id: adminId }))
    .digest('hex');
  return withTransaction(pool, async (conn) => {
    // Lock the part first. The FIRST consistent read below starts its snapshot
    // after that lock is acquired, so a completed same-part retry is visible.
    // No UPDATE privilege is granted on immutable audit records.
    const [[part]] = await conn.execute(
      'SELECT * FROM part WHERE part_id = ? FOR UPDATE',
      [data.part_id],
    );
    if (!part) throw new AppError('Part not found.', 404);
    const [[previous]] = await conn.execute(
      'SELECT * FROM inventory_web_operation WHERE request_id = ?',
      [request_id],
    );
    if (previous) {
      if (previous.payload_hash !== hash)
        throw new AppError(
          'This request was already used for a different operation.',
          409,
        );
      return {
        transaction_id: previous.transaction_id,
        part_id: data.part_id,
        stock_before: previous.stock_before,
        stock_after: previous.stock_after,
        replayed: true,
      };
    }
    if (part.status !== 'Active')
      throw new AppError(
        'Activate this part before recording stock movements.',
        409,
      );
    if (part.current_stock !== data.expected_stock)
      throw new AppError(
        'Stock changed after your review. Refresh the part, then review again.',
        409,
      );
    if (data.job_id !== null) {
      const [[job]] = await conn.execute(
        'SELECT job_id FROM work_order WHERE job_id = ?',
        [data.job_id],
      );
      if (!job)
        throw new AppError('The selected work order no longer exists.', 400);
    }
    const delta = stockDelta(data);
    const after = projectedStock(part.current_stock, delta);
    const [inserted] = await conn.execute(
      'INSERT INTO inventory_transaction (part_id, transaction_type, quantity, job_id, remarks, admin_user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [
        data.part_id,
        data.transaction_type,
        data.quantity,
        data.job_id,
        data.remarks || null,
        adminId,
      ],
    );
    await conn.execute(
      'INSERT INTO inventory_web_operation (request_id, payload_hash, transaction_id, stock_before, stock_delta, stock_after) VALUES (?, ?, ?, ?, ?, ?)',
      [request_id, hash, inserted.insertId, part.current_stock, delta, after],
    );
    await conn.execute('UPDATE part SET current_stock = ? WHERE part_id = ?', [
      after,
      data.part_id,
    ]);
    return {
      transaction_id: inserted.insertId,
      part_id: data.part_id,
      stock_before: part.current_stock,
      stock_after: after,
      replayed: false,
    };
  });
}
export function toCsv(headers, rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  );
}
