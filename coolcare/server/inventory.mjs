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
    recommended_units_per_ac: z.coerce.number().positive().max(999999).multipleOf(0.01).optional(),
    stock_unit: z.string().trim().min(1).max(30).optional(),
    usage_note: z.string().trim().max(255).optional(),
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
    acknowledge_excess: z.boolean().default(false),
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
          current.status !== data.original.status ||
          (data.original.recommended_units_per_ac !== undefined && Number(current.recommended_units_per_ac) !== data.original.recommended_units_per_ac) ||
          (data.original.stock_unit !== undefined && current.stock_unit !== data.original.stock_unit) ||
          (data.original.usage_note !== undefined && (current.usage_note || '') !== data.original.usage_note)
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
          'INSERT INTO part (part_name, unit_price, status, current_stock, recommended_units_per_ac, stock_unit, usage_note) VALUES (?, ?, ?, 0, ?, ?, ?)',
          [data.part_name, data.unit_price, data.status, data.recommended_units_per_ac ?? 1, data.stock_unit ?? 'piece', data.usage_note || null],
        );
        return { part_id: result.insertId };
      }
      await conn.execute(
        'UPDATE part SET part_name = ?, unit_price = ?, status = ?, recommended_units_per_ac=COALESCE(?,recommended_units_per_ac),stock_unit=COALESCE(?,stock_unit),usage_note=COALESCE(?,usage_note) WHERE part_id = ?',
        [data.part_name, data.unit_price, data.status, data.recommended_units_per_ac ?? null, data.stock_unit ?? null, data.usage_note ?? null, id],
      );
      return { part_id: id };
    },
    true,
  );
}
export async function recordTransaction(pool, raw, adminId, technicianUserId = null) {
  const data = transactionSchema.parse(raw);
  const { request_id, ...payload } = data;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...payload, admin_user_id: adminId, technician_user_id: technicianUserId }))
    .digest('hex');
  return withTransaction(pool, async (conn) => {
    // Lock the part first. The FIRST consistent read below starts its snapshot
    // after that lock is acquired, so a completed same-part retry is visible.
    // The operation and revision ledgers remain immutable even when the business record is corrected.
    const [[part]] = await conn.execute(
      'SELECT * FROM part WHERE part_id = ? FOR UPDATE',
      [data.part_id],
    );
    if (!part) throw new AppError('Part not found.', 404);
    if (technicianUserId !== null) {
      if (data.transaction_type !== 'Stock Out' || data.job_id === null)
        throw new AppError('Technicians can only issue parts to their own work orders.', 403);
      const [[owned]] = await conn.execute(`SELECT w.job_id,w.current_status FROM work_order w
        JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id
        JOIN technician tech ON tech.technician_id=a.technician_id
        WHERE w.job_id=? AND tech.user_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled')`, [data.job_id,technicianUserId]);
      if (!owned) throw new AppError('Work order not found for this technician.',404);
    }
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
    if (data.transaction_type === 'Stock Out' && data.job_id !== null) {
      const recommendation = await getStockRecommendation(conn, data.job_id, part);
      if (recommendation.issued + data.quantity > recommendation.recommended && !data.acknowledge_excess)
        throw new AppError(`This issue exceeds the recommendation of ${recommendation.recommended} ${part.stock_unit} for ${recommendation.acCount} AC unit(s); ${recommendation.issued} already issued. Review the quantity and explicitly acknowledge the extra usage to continue.`,409);
    }
    const delta = stockDelta(data);
    const after = projectedStock(part.current_stock, delta);
    const [inserted] = await conn.execute(
      'INSERT INTO inventory_transaction (part_id, transaction_type, quantity, job_id, remarks, admin_user_id,performed_by_user_id) VALUES (?, ?, ?, ?, ?, ?,?)',
      [
        data.part_id,
        data.transaction_type,
        data.quantity,
        data.job_id,
        data.remarks || null,
        adminId,
        technicianUserId ?? adminId,
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

export async function getStockRecommendation(conn, jobId, part) {
  const [[counts]] = await conn.execute(`SELECT
    (SELECT COUNT(*) FROM booking_aircon_unit bau JOIN work_order w ON w.booking_id=bau.booking_id WHERE w.job_id=?) AS acCount,
    (SELECT COALESCE(SUM(CASE WHEN transaction_type='Stock Out' THEN quantity WHEN transaction_type='Return' THEN -quantity ELSE 0 END),0) FROM inventory_transaction WHERE job_id=? AND part_id=?) AS issued`, [jobId,jobId,part.part_id]);
  return {acCount:Number(counts.acCount),issued:Math.max(0,Number(counts.issued)),recommended:Math.ceil(Number(counts.acCount)*Number(part.recommended_units_per_ac))};
}

const occurredAtSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/)
  .transform(s=>s.replace('T',' ').length===16?s.replace('T',' ')+':00':s.replace('T',' '))
  .refine(s=>!Number.isNaN(Date.parse(s.replace(' ','T')+'Z')) && new Date(s.replace(' ','T')+'Z').toISOString().slice(0,19).replace('T',' ')===s,'Enter a valid date and time.');
export const editTransactionSchema = z.object({
  request_id:z.uuid(), expected_version:z.number().int().positive(),
  quantity:z.number().int().positive().max(2147483647), occurred_at:occurredAtSchema,
  remarks:z.string().trim().max(500).default(''),
}).strict();

export async function editTransaction(pool, transactionId, raw, adminId) {
  const data=editTransactionSchema.parse(raw);
  const hash=createHash('sha256').update(JSON.stringify({...data,transactionId,adminId})).digest('hex');
  return withTransaction(pool,async conn=>{
    // The first read is a locking read, so the audit snapshot starts only after the part lock.
    const [[part]]=await conn.execute('SELECT p.* FROM part p WHERE p.part_id=(SELECT part_id FROM inventory_transaction WHERE transaction_id=?) FOR UPDATE',[transactionId]);
    if(!part) throw new AppError('Transaction not found.',404);
    const [[current]]=await conn.execute('SELECT * FROM inventory_transaction WHERE transaction_id=? FOR UPDATE',[transactionId]);
    const [[previous]]=await conn.execute('SELECT * FROM inventory_transaction_revision WHERE request_id=?',[data.request_id]);
    if(previous){
      if(previous.payload_hash!==hash) throw new AppError('This request was already used for a different correction.',409);
      return {transaction_id:transactionId,version:previous.after_version,stock_after:previous.stock_after,replayed:true};
    }
    if(!['Stock In','Stock Out'].includes(current.transaction_type)) throw new AppError('Only inbound and outbound transactions can be edited. Use a new adjustment for other movements.');
    if(current.version!==data.expected_version) throw new AppError('This transaction was edited elsewhere. Reload its details before saving.',409);
    const delta=(current.transaction_type==='Stock Out'?-1:1)*(data.quantity-current.quantity);
    const after=projectedStock(part.current_stock,delta);
    const nextVersion=current.version+1;
    await conn.execute(`INSERT INTO inventory_transaction_revision
      (request_id,payload_hash,transaction_id,changed_by_user_id,before_quantity,after_quantity,before_occurred_at,after_occurred_at,before_remarks,after_remarks,before_version,after_version,stock_before,stock_delta,stock_after)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[data.request_id,hash,transactionId,adminId,current.quantity,data.quantity,current.created_at,data.occurred_at,current.remarks,data.remarks||null,current.version,nextVersion,part.current_stock,delta,after]);
    await conn.execute('UPDATE inventory_transaction SET quantity=?,created_at=?,remarks=?,modified_at=CURRENT_TIMESTAMP(6),version=? WHERE transaction_id=?',[data.quantity,data.occurred_at,data.remarks||null,nextVersion,transactionId]);
    await conn.execute('UPDATE part SET current_stock=? WHERE part_id=?',[after,part.part_id]);
    return {transaction_id:transactionId,version:nextVersion,stock_after:after,replayed:false};
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
