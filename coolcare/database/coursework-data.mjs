import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { addCalendarDays, isCalendarDate, isWeekday, nextWeekday } from '../server/customer/booking-schedule.mjs';
import { addCalendarMonths, annualVisitSchedule } from '../server/customer/annual-bookings.mjs';
import { calendarWeekStart, getBookingOptions, resolveBookingSelection, saveBookingSelection } from '../server/customer/booking-options.mjs';
import { awardCompletedBookingRewards, reserveCreatedBookingReward, releaseBookingRewardReservation } from '../server/commerce.mjs';

// Explicit coursework fixtures, not a migration or application startup hook.
// The caller owns the backup, transaction, import lock and durable batch receipt.
// This module never commits, deletes existing data, creates an administrator,
// changes an existing login, or sends/queues email.
const VERSION = 1;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const money = value => Math.round(Number(value) * 100) / 100;
const previousWeekday = date => { while (!isWeekday(date)) date = addCalendarDays(date, -1); return date; };
const localTime = (date, time = '09:00:00') => `${date} ${time}`;
const utcTime = local => new Date(local.replace(' ', 'T') + '+08:00').toISOString().slice(0, 19).replace('T', ' ');
const shift = (value, minutes) => new Date(Date.parse(value.replace(' ', 'T') + 'Z') + minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
const list = values => values.map(() => '?').join(',');
const terminal = new Set(['Cancelled', 'Rejected', 'Expired']);
const uuid = value => {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

function validateInput({ asOf, batchKey }) {
  if (!isCalendarDate(asOf) || asOf < '2003-01-01' || asOf > '2090-12-31') throw new Error('Use an as-of date between 2003-01-01 and 2090-12-31.');
  if (typeof batchKey !== 'string' || !/^[a-z0-9][a-z0-9-]{2,59}$/.test(batchKey)) throw new Error('Use a batch key of 3–60 lowercase letters, numbers or hyphens.');
}

/** Deterministic, read-only plan. Prices are resolved from the live catalogue later. */
export function buildCourseworkPlan({ asOf, batchKey } = {}) {
  validateInput({ asOf, batchKey });
  const tag = hash(batchKey).slice(0, 12);
  const marker = `Synthetic coursework ${batchKey}`;
  const customerNames = ['Aileen Koh', 'Brandon Tan', 'Cheryl Lim', 'Dinesh Rao', 'Elaine Goh', 'Farid Ahmad', 'Grace Lee', 'Hafiz Rahman', 'Isabel Wong', 'Jasper Ng', 'Kavitha Nair', 'Leonard Chua'];
  const streets = ['Clementi Avenue 3', 'Tampines Street 21', 'Bishan Street 12', 'Punggol Field', 'Woodlands Drive 16', 'Ang Mo Kio Avenue 4', 'Bukit Batok Street 31', 'Bedok North Avenue 2', 'Serangoon Avenue 3', 'Sengkang East Way', 'Toa Payoh Lorong 4', 'Jurong West Street 65'];
  const postalCodes = ['120101', '520102', '570103', '820104', '730105', '560106', '650107', '460108', '550109', '540110', '310111', '640112'];
  const units = [2, 3, 4, 5, 2, 3, 4, 2, 3, 4, 2, 3];
  const customers = customerNames.map((name, index) => ({
    key: `customer-${index + 1}`, name: `Synthetic · ${name}`, email: `coursework.${tag}.c${index + 1}@example.test`,
    addressLine: `Synthetic address: ${101 + index} ${streets[index]}, #08-${101 + index}, Singapore`,
    postalCode: postalCodes[index], unitCount: units[index], propertyType: ['hdb-2-3', 'hdb-4', 'hdb-5-executive', 'condo'][index % 4],
  }));
  const technicians = ['Adrian Soh', 'Bernice Teo', 'Calvin Yeo'].map((name, index) => ({
    key: `technician-${index + 1}`, name: `Synthetic · ${name}`, email: `coursework.${tag}.t${index + 1}@example.test`,
    postalCode: ['120101', '520102', '730105'][index], region: ['West (synthetic)', 'East (synthetic)', 'North (synthetic)'][index],
  }));
  const annualPlans = [
    { key: 'annual-finished', customerKey: customers[0].key, firstDate: nextWeekday(addCalendarMonths(asOf, -14)), statuses: ['Completed', 'Completed', 'Completed', 'Completed'] },
    { key: 'annual-active', customerKey: customers[1].key, firstDate: nextWeekday(addCalendarMonths(asOf, -5)), statuses: ['Completed', 'Completed', 'Confirmed', 'Submitted'] },
    { key: 'annual-new', customerKey: customers[2].key, firstDate: nextWeekday(addCalendarDays(asOf, 28)), statuses: ['Assigned', 'Confirmed', 'Submitted', 'Submitted'] },
  ];
  const bookings = [];
  for (const annual of annualPlans) {
    for (const visit of annualVisitSchedule(annual.firstDate, 0)) bookings.push({
      key: `${annual.key}-${visit.visitNumber}`, customerKey: annual.customerKey, serviceCodes: ['cleaning'],
      date: visit.preferredDate, status: annual.statuses[visit.visitNumber - 1], time: '09:00:00',
      annualKey: annual.key, visitNumber: visit.visitNumber, windowStart: visit.windowStart, windowEnd: visit.windowEnd,
    });
  }
  const singles = [
    ...Array.from({ length: 20 }, (_, i) => ({ status: 'Completed', date: previousWeekday(addCalendarDays(asOf, -410 + i * 18)) })),
    ...Array.from({ length: 6 }, (_, i) => ({ status: 'Submitted', date: nextWeekday(addCalendarDays(asOf, 14 + i * 3)) })),
    ...Array.from({ length: 4 }, (_, i) => ({ status: 'Confirmed', date: nextWeekday(addCalendarDays(asOf, 35 + i * 3)) })),
    ...Array.from({ length: 3 }, (_, i) => ({ status: 'Assigned', date: nextWeekday(addCalendarDays(asOf, 55 + i * 3)) })),
    ...['Cancelled', 'Cancelled', 'Rejected', 'Rejected', 'Expired'].map((status, i) => ({ status, date: previousWeekday(addCalendarDays(asOf, -25 + i * 3)) })),
  ];
  for (const [index, row] of singles.entries()) {
    const customer = customers[(index + 3) % customers.length];
    const serviceCodes = index % 6 === 0 ? ['cleaning', 'repair'] : index % 3 === 1 ? ['repair'] : ['cleaning'];
    let date = row.date;
    if (serviceCodes.includes('cleaning') && !terminal.has(row.status)) {
      while (bookings.some(b => b.customerKey === customer.key && !terminal.has(b.status) && b.serviceCodes.includes('cleaning') && calendarWeekStart(b.date) === calendarWeekStart(date))) {
        date = addCalendarDays(date, row.status === 'Completed' ? -7 : 7);
      }
    }
    bookings.push({ key: `single-${index + 1}`, customerKey: customer.key, serviceCodes, date, status: row.status, time: '09:00:00' });
  }
  // One synthetic technician team per day avoids overlaps and travel ambiguity.
  const occupied = new Set();
  for (const [index, row] of [...bookings].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)).entries()) {
    const customer = customers.find(c => c.key === row.customerKey);
    row.unitCount = customer.unitCount;
    row.notes = `${marker}. Fictional ${row.annualKey ? `quarterly cleaning visit ${row.visitNumber} of 4` : row.serviceCodes.join(' and ') + ' request'}; no actual customer or field work.`;
    if (row.status !== 'Completed' && row.status !== 'Assigned') continue;
    const count = Math.ceil(customer.unitCount / 4);
    let selected;
    for (let offset = 0; offset < technicians.length; offset++) {
      const candidate = Array.from({ length: count }, (_, member) => technicians[(index + offset + member) % technicians.length].key);
      if (candidate.every(key => !occupied.has(`${row.date}:${key}`))) { selected = candidate; break; }
    }
    if (!selected) throw new Error('The synthetic plan could not allocate a conflict-free technician team.');
    row.technicianKeys = selected;
    selected.forEach(key => occupied.add(`${row.date}:${key}`));
  }
  const byStatus = {};
  for (const row of bookings) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  return { version: VERSION, batchKey, asOf, marker, customers, technicians, annualPlans, bookings,
    counts: { bookings: bookings.length, customers: customers.length, technicians: technicians.length, annualPlans: annualPlans.length, byStatus } };
}

function slotLabel(start, end) {
  const format = time => { const hour = Number(time.slice(0, 2)); return `${String(hour % 12 || 12).padStart(2, '0')}:${time.slice(3, 5)} ${hour >= 12 ? 'PM' : 'AM'}`; };
  return `${format(start)} - ${format(end)}`;
}

/** Append one complete batch. Caller must roll back on any thrown error. */
export async function appendCourseworkData(connection, { asOf, batchKey, actorUserId, requestId } = {}) {
  const plan = buildCourseworkPlan({ asOf, batchKey });
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) throw new Error('An existing administrator must own the coursework import.');
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Use a valid import request UUID.');
  const [[actor]] = await connection.execute(`SELECT u.user_id FROM user_account u JOIN role r ON r.role_id=u.role_id JOIN admin_profile a ON a.user_id=u.user_id WHERE u.user_id=? AND u.status='Active' AND r.role_name='Admin' FOR SHARE`, [actorUserId]);
  if (!actor) throw new Error('The import actor must be an existing active administrator.');
  const [[clock]] = await connection.query('SELECT UTC_TIMESTAMP() AS nowUtc');
  const nowUtc = clock.nowUtc instanceof Date ? clock.nowUtc.toISOString().slice(0, 19).replace('T', ' ') : String(clock.nowUtc);
  const [[mailBefore]] = await connection.query('SELECT COUNT(*) n FROM booking_email_outbox');
  const options = await getBookingOptions(connection);
  const cleaning = options.services.find(row => row.code === 'cleaning');
  const repair = options.services.find(row => row.code === 'repair');
  const bundle = options.bundles.find(row => row.code === 'annual-cleaning');
  if (!cleaning || !repair || !bundle) throw new Error('Apply current catalogue migrations before importing coursework data.');
  const [[rewardRule]] = await connection.query('SELECT * FROM reward_rule WHERE rule_id=1 FOR SHARE');
  if (!rewardRule) throw new Error('Apply the reward schema before importing coursework data.');
  const [roles] = await connection.query("SELECT role_id,role_name FROM role WHERE role_name IN ('Customer','Technician')");
  const roleId = name => { const role = roles.find(row => row.role_name === name); if (!role) throw new Error(`Missing ${name} role.`); return role.role_id; };
  const emails = [...plan.customers, ...plan.technicians].map(row => row.email);
  const [collisions] = await connection.execute(`SELECT user_id FROM user_account WHERE email IN (${list(emails)})`, emails);
  if (collisions.length) throw new Error('This coursework batch already has accounts. Replay its saved import receipt; do not duplicate or overwrite them.');
  // Lock the shared roster once, before new staff changes capacity.
  await connection.query('SELECT lock_id FROM technician_capacity_lock WHERE lock_id=1 FOR UPDATE');
  const [parts] = await connection.query("SELECT part_id,part_name,current_stock FROM part WHERE status='Active' AND part_name IN ('Coil Cleaner (500 mL)','Capacitor 35uF','Aircon Filter') ORDER BY part_id FOR UPDATE");
  const partNamed = name => { const part = parts.find(row => row.part_name === name); if (!part) throw new Error(`Required active part missing: ${name}`); return part; };
  partNamed('Coil Cleaner (500 mL)'); partNamed('Capacitor 35uF');
  if (parts.some(row => Number(row.current_stock) < 0)) throw new Error('Existing inventory requires correction before appending coursework records.');
  const ids = Object.fromEntries(['userIds', 'customerIds', 'technicianIds', 'addressIds', 'unitIds', 'seriesIds', 'bookingIds', 'assignmentIds', 'jobIds', 'reportIds', 'inventoryTransactionIds'].map(name => [name, []]));
  const accountCreatedAt = utcTime(localTime(previousWeekday(addCalendarDays([...plan.bookings].sort((a, b) => a.date.localeCompare(b.date))[0].date, -60)), '10:00:00'));
  const customers = new Map(); const technicians = new Map(); const annuals = new Map(); const bookingRows = [];
  const counter = { reports: 0, feedback: 0, workOrders: 0, assignmentMembers: 0, visitMembers: 0, completionRewards: 0, rewardReservations: 0, rewardReturns: 0, rewardRedemptions: 0, cleaningAssessments: 0, serviceEvents: 0 };
  const addId = (name, result) => { ids[name].push(Number(result.insertId)); return Number(result.insertId); };
  // No usable demo password is introduced. Each secret is generated, hashed and
  // discarded; existing demo accounts/passwords are not touched.
  async function account(row, role) {
    const passwordHash = await bcrypt.hash(randomBytes(48).toString('base64url'), 10);
    const [inserted] = await connection.execute("INSERT INTO user_account(role_id,full_name,email,password_hash,status,created_at,updated_at) VALUES (?,?,?,?,'Active',?,?)", [roleId(role), row.name, row.email, passwordHash, accountCreatedAt, nowUtc]);
    return addId('userIds', inserted);
  }
  for (const row of plan.customers) {
    const userId = await account(row, 'Customer');
    const [customer] = await connection.execute('INSERT INTO customer(user_id) VALUES (?)', [userId]);
    const customerId = addId('customerIds', customer);
    const [address] = await connection.execute("INSERT INTO service_address(customer_id,address_label,address_line,postal_code,is_default,is_archived) VALUES (?,'Synthetic coursework home',?,?,TRUE,FALSE)", [customerId, row.addressLine, row.postalCode]);
    const addressId = addId('addressIds', address), unitIds = [];
    for (let i = 0; i < row.unitCount; i++) {
      const [unit] = await connection.execute(`INSERT INTO aircon_unit(customer_id,address_id,brand,model,serial_number,installation_location,warranty_status) VALUES (?,?,?,?,?,?,'Unknown')`,
        [customerId, addressId, i % 2 ? 'Mitsubishi Electric' : 'Daikin', i % 2 ? 'MSY-GR10VF' : 'FTKM25UVMG', `SYN-${hash(batchKey).slice(0, 12)}-${row.key}-${i + 1}`, i === 0 ? 'Living room (synthetic)' : `Bedroom ${i} (synthetic)`]);
      unitIds.push(addId('unitIds', unit));
    }
    customers.set(row.key, { ...row, userId, customerId, addressId, unitIds });
  }
  for (const row of plan.technicians) {
    const userId = await account(row, 'Technician');
    const [tech] = await connection.execute("INSERT INTO technician(user_id,availability_status,base_postal_code) VALUES (?,'Available',?)", [userId, row.postalCode]);
    const technicianId = addId('technicianIds', tech);
    await connection.execute('INSERT INTO technician_portal_profile(technician_id,primary_region) VALUES (?,?)', [technicianId, row.region]);
    technicians.set(row.key, { ...row, userId, technicianId });
  }
  for (const row of plan.annualPlans) {
    const customer = customers.get(row.customerKey), annualRequestId = uuid(`${batchKey}:${row.key}`);
    // Resolve a supported property tier without changing the catalogue.
    const propertyType = bundle.propertyPrices.some(p => p.propertyType === customer.propertyType) ? customer.propertyType : bundle.propertyPrices[0]?.propertyType;
    if (!propertyType) throw new Error('Annual bundle property pricing is missing.');
    const selection = await resolveBookingSelection(connection, customer.customerId, { packageId: bundle.packageId, propertyType, requestId: annualRequestId }, customer.unitCount);
    const plannedCreation = utcTime(localTime(previousWeekday(addCalendarDays(row.firstDate, -28)), '10:00:00'));
    const createdAt = plannedCreation < nowUtc ? plannedCreation : nowUtc;
    const [series] = await connection.execute(`INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount,request_id,created_at,property_type,property_label,included_units,base_annual_price,additional_unit_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [customer.customerId, customer.addressId, bundle.packageId, bundle.name, row.firstDate, customer.unitCount, selection.totalAmount, annualRequestId, createdAt, selection.package.propertyType, selection.package.propertyLabel, selection.package.includedUnits, selection.package.price, selection.package.additionalUnitPrice]);
    annuals.set(row.key, { ...row, seriesId: addId('seriesIds', series), selection, schedule: annualVisitSchedule(row.firstDate, selection.totalAmount), requestId: annualRequestId, createdAt });
  }
  const ordered = [...plan.bookings].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const [index, item] of ordered.entries()) {
    const customer = customers.get(item.customerKey), annual = annuals.get(item.annualKey);
    const ownRequestId = uuid(`${batchKey}:${item.key}:booking`);
    const baseSelection = annual?.selection || await resolveBookingSelection(connection, customer.customerId, { serviceIds: item.serviceCodes.map(code => code === 'cleaning' ? cleaning.serviceId : repair.serviceId), requestId: ownRequestId }, customer.unitCount);
    const visit = annual?.schedule.find(row => row.visitNumber === item.visitNumber);
    const amount = visit?.totalAmount ?? baseSelection.totalAmount;
    const selection = annual ? { ...baseSelection, totalAmount: amount, services: baseSelection.services.map(service => ({ ...service, lineTotal: amount })) } : baseSelection;
    const duration = selection.estimatedDurationMinutes;
    if (!Number.isInteger(duration) || duration <= 0 || duration > 240) throw new Error('Current service durations do not fit the coursework morning appointment.');
    const scheduledStart = localTime(item.date, item.time), slotEnd = shift(scheduledStart, duration).slice(11, 19);
    const createdAt = annual?.createdAt || (item.status === 'Submitted' ? nowUtc : item.date >= asOf ? shift(nowUtc, -24 * 60) : utcTime(localTime(previousWeekday(addCalendarDays(item.date, -28)), '10:00:00')));
    const completed = item.status === 'Completed', assigned = item.status === 'Assigned';
    const actualStart = completed ? shift(scheduledStart, index % 5 === 0 ? 12 : 0) : null;
    const extension = completed && index % 7 === 0 ? 15 : 0;
    const actualEnd = completed ? shift(actualStart, duration + extension) : null;
    const closedAt = terminal.has(item.status) ? shift(createdAt, (item.status === 'Expired' ? 48 : item.status === 'Rejected' ? 36 : 18) * 60) : null;
    const updatedAt = completed ? utcTime(actualEnd) : closedAt || nowUtc;
    const rejection = item.status === 'Rejected' ? `${plan.marker}. Requested access arrangements could not be accommodated; please choose another date.` : null;
    const expiresAt = item.status === 'Submitted' && (!annual || item.visitNumber === 1) ? shift(nowUtc, 48 * 60) : item.status === 'Expired' ? closedAt : null;
    const [booking] = await connection.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,estimated_duration_minutes,required_technicians,cleaning_minutes_per_unit,diagnostic_minutes,problem_description,booking_status,total_amount,expires_at,rejection_reason,rejection_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [customer.customerId, customer.addressId, selection.services[0].serviceId, item.date, slotLabel(item.time, slotEnd), item.time, slotEnd, duration, selection.requiredTechnicians, selection.cleaningMinutesPerUnit, selection.diagnosticMinutes, item.notes, item.status, amount, expiresAt, rejection, rejection ? 1 : 0, createdAt, updatedAt]);
    const bookingId = addId('bookingIds', booking);
    for (const unitId of customer.unitIds) await connection.execute('INSERT INTO booking_aircon_unit(booking_id,unit_id) VALUES (?,?)', [bookingId, unitId]);
    await connection.execute('INSERT INTO web_booking_details(booking_id,service_package,special_notes,request_id) VALUES (?,?,?,?)', [bookingId, selection.package?.name || selection.serviceName, item.notes, annual ? (item.visitNumber === 1 ? annual.requestId : null) : ownRequestId]);
    await saveBookingSelection(connection, bookingId, selection);
    if (annual) await connection.execute('INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES (?,?,?,?,?,?)', [bookingId, annual.seriesId, item.visitNumber, item.date, visit.windowStart, visit.windowEnd]);
    const record = { ...item, bookingId, customerId: customer.customerId, customerUserId: customer.userId, amount, createdAt, updatedAt, actualStart, actualEnd, duration, slotEnd, extension };
    bookingRows.push(record);
    const history = [{ old: null, status: 'Submitted', actor: customer.userId, at: createdAt, note: 'Request recorded for the coursework scenario.' }];
    const confirmationAnchor = utcTime(localTime(previousWeekday(addCalendarDays(item.date, -17)), '10:00:00'));
    const confirmedAt = [createdAt, confirmationAnchor < nowUtc ? confirmationAnchor : nowUtc].sort().at(-1);
    if (['Confirmed', 'Assigned', 'Completed'].includes(item.status)) history.push({ old: 'Submitted', status: 'Confirmed', actor: actorUserId, at: confirmedAt, note: 'Synthetic requested appointment reviewed.' });
    if (terminal.has(item.status)) history.push({ old: 'Submitted', status: item.status, actor: item.status === 'Cancelled' ? customer.userId : actorUserId, at: closedAt, note: item.status === 'Expired' ? 'Synthetic confirmation deadline elapsed.' : item.status === 'Rejected' ? 'Synthetic appointment rejected because access arrangements were unsuitable.' : 'Synthetic customer no longer required this appointment.' });
    if (completed || assigned) {
      const team = item.technicianKeys.map(key => technicians.get(key)), lead = team[0];
      const assignmentAnchor = utcTime(localTime(previousWeekday(addCalendarDays(item.date, -16)), '11:00:00'));
      const assignedAt = [confirmedAt, assignmentAnchor < nowUtc ? assignmentAnchor : nowUtc].sort().at(-1);
      const [assignment] = await connection.execute('INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,dispatch_request_id,assignment_status,assigned_at,updated_at) VALUES (?,?,?,?,?,?,?)', [bookingId, lead.technicianId, actorUserId, uuid(`${batchKey}:${item.key}:dispatch`), completed ? 'Completed' : 'Accepted', assignedAt, updatedAt]);
      const assignmentId = addId('assignmentIds', assignment);
      for (const member of team) { await connection.execute('INSERT INTO assignment_member(assignment_id,technician_id) VALUES (?,?)', [assignmentId, member.technicianId]); counter.assignmentMembers++; }
      const [job] = await connection.execute('INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,priority_level,reported_problem,current_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [bookingId, assignmentId, scheduledStart, item.time, item.serviceCodes.includes('repair') ? 'High' : 'Normal', item.notes, item.status, assignedAt, updatedAt]);
      record.jobId = addId('jobIds', job); record.lead = lead; counter.workOrders++;
      history.push({ old: 'Confirmed', status: 'Assigned', actor: actorUserId, at: assignedAt, note: 'Synthetic technician team assigned; no dispatch email sent.' });
      if (completed) {
        const repairIncluded = item.serviceCodes.includes('repair'), cleaningIncluded = item.serviceCodes.includes('cleaning');
        const additionalFee = repairIncluded ? [35, 65, 90][index % 3] : 0;
        const work = `${plan.marker}. ${cleaningIncluded ? 'Washed filters, cleaned evaporator surfaces and flushed condensate drains. ' : ''}${repairIncluded ? 'Diagnosed intermittent starting and replaced a faulty capacitor. ' : ''}Checked airflow, drainage and cooling. This is a fictional service record.`;
        const findings = `${plan.marker}. ${repairIncluded ? 'Simulated capacitor readings below the labelled rating.' : 'Simulated dust accumulation and reduced airflow; no refrigerant leak indicated.'}`;
        const solution = `${plan.marker}. ${repairIncluded ? 'Replacement component fitted and electrical operation checked.' : 'Routine cleaning restored even airflow.'} Illustrative readings only; no real property was visited.`;
        const checklist = `${plan.marker}. Power isolated; filters inspected; drainage checked; cooling checked; work area cleared.`;
        const submittedAt = utcTime(shift(actualEnd, 5));
        const [report] = await connection.execute(`INSERT INTO service_report(job_id,work_performed,problem_found,solution_applied,checklist_result,submitted_time,started_at,completed_at,visit_technician_id,visit_service_date,visit_start_time) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [record.jobId, work, findings, solution, checklist, submittedAt, actualStart, actualEnd, lead.technicianId, item.date, item.time]);
        record.reportId = addId('reportIds', report); counter.reports++;
        await connection.execute("INSERT INTO performance_visit(report_id,job_id,technician_id,scheduled_start,actual_start,actual_end,outcome,capture_source,created_at) VALUES (?,?,?,?,?,?,'Completed','Historical snapshot',?)", [record.reportId, record.jobId, lead.technicianId, scheduledStart, actualStart, actualEnd, submittedAt]);
        for (const member of team) { await connection.execute('INSERT INTO visit_member(report_id,technician_id,is_lead) VALUES (?,?,?)', [record.reportId, member.technicianId, member === lead]); counter.visitMembers++; }
        const snapshot = { report_id: record.reportId, job_id: record.jobId, visit_technician_id: lead.technicianId, started_at: actualStart, completed_at: actualEnd, submitted_time: submittedAt, work_performed: work, problem_found: findings, solution_applied: solution, checklist_result: checklist, synthetic: true, batchKey };
        await connection.execute("INSERT INTO service_visit_record(job_id,report_id,technician_id,started_at,ended_at,outcome,report_snapshot,created_at) VALUES (?,?,?,?,?,'Completed',?,?)", [record.jobId, record.reportId, lead.technicianId, actualStart, actualEnd, JSON.stringify(snapshot), submittedAt]);
        let revision = 0;
        const event = async (kind, reason, notes, amount = null, minutes = null) => {
          revision++;
          const payload = { synthetic: true, batchKey, jobId: record.jobId, reportId: record.reportId, kind, reason, notes, amount, minutes };
          await connection.execute('INSERT INTO service_progress_event(request_id,payload_hash,result_json,job_id,report_id,actor_user_id,revision,kind,minutes,amount,reason,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [uuid(`${batchKey}:${item.key}:${kind}`), hash(payload), JSON.stringify({ ...payload, revision }), record.jobId, record.reportId, lead.userId, revision, kind, minutes, amount, reason, notes, utcTime(shift(actualStart, 10 + revision))]);
          counter.serviceEvents++;
        };
        if (additionalFee) await event('Repair quote', 'Replacement component', `${plan.marker}. Technician-recorded additional labour and capacitor fee; illustrative only.`, additionalFee);
        if (extension) await event('Extension', 'Additional cleaning', `${plan.marker}. Fifteen additional minutes for a simulated blocked condensate drain.`, null, extension);
        await connection.execute('INSERT INTO service_progress(job_id,revision,extension_minutes,expected_end_time,additional_repair_fee,repair_quote_note,updated_at) VALUES (?,?,?,?,?,?,?)', [record.jobId, revision, extension, shift(scheduledStart, duration + extension).slice(11, 19), additionalFee, additionalFee ? `${plan.marker}. Additional labour and replacement capacitor.` : '', utcTime(actualEnd)]);
        if (cleaningIncluded) {
          const note = `${plan.marker}. Regular cleaning chosen after inspecting synthetic filter and drain conditions.`;
          await connection.execute("INSERT INTO work_order_cleaning_assessment(job_id,cleaning_method,assessment_note,version,assessed_by_user_id,created_at,updated_at) VALUES (?,'Regular',?,1,?,?,?)", [record.jobId, note, lead.userId, utcTime(shift(actualStart, 5)), utcTime(shift(actualStart, 5))]);
          await connection.execute("INSERT INTO work_order_cleaning_assessment_revision(request_id,payload_hash,job_id,changed_by_user_id,before_method,after_method,before_note,after_note,before_version,after_version,changed_at) VALUES (?,?,?,?,NULL,'Regular',NULL,?,0,1,?)", [uuid(`${batchKey}:${item.key}:assessment`), hash({ batchKey, jobId: record.jobId, note }), record.jobId, lead.userId, note, utcTime(shift(actualStart, 5))]);
          counter.cleaningAssessments++;
        }
        if (index % 5 !== 0) {
          const stars = [5, 4, 5, 3, 2][index % 5];
          const comment = `${plan.marker}. Illustrative ${stars}-star feedback: ${stars <= 2 ? 'A clearer explanation of the additional repair fee would improve the experience.' : stars === 3 ? 'The work was completed, but the arrival update could be clearer.' : 'The technician explained the work and left the service area tidy.'} Not a real customer review.`;
          await connection.execute('INSERT INTO performance_feedback(report_id,stars,comment,version,customer_user_id,updated_at) VALUES (?,?,?,1,?,?)', [record.reportId, stars, comment, customer.userId, utcTime(shift(actualEnd, 120))]);
          counter.feedback++;
        }
        history.push({ old: 'Assigned', status: 'On The Way', actor: lead.userId, at: utcTime(shift(actualStart, -30)), note: 'Synthetic travel event.' }, { old: 'On The Way', status: 'In Progress', actor: lead.userId, at: utcTime(actualStart), note: 'Synthetic service start.' }, { old: 'In Progress', status: 'Completed', actor: lead.userId, at: utcTime(actualEnd), note: 'Synthetic service completion with maintenance report.' });
        // Use the production settlement helper, then backdate only this batch's
        // snapshots/ledger to their documented fictional service event.
        await awardCompletedBookingRewards(connection, bookingId);
        counter.completionRewards++;
        await connection.execute('UPDATE booking_completion_reward SET completed_at=?,note=? WHERE booking_id=?', [utcTime(actualEnd), `${plan.marker}. Imported fictional completion; current catalogue and reward rules were used.`, bookingId]);
        await connection.execute('UPDATE loyalty_transaction SET created_at=?,description=CONCAT(?,description) WHERE booking_id=?', [utcTime(actualEnd), `${plan.marker}. `, bookingId]);
      }
    }
    for (const row of history) await connection.execute('INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note,changed_at) VALUES (?,?,?,?,?,?)', [bookingId, row.old, row.status, row.actor, `${plan.marker}. ${row.note}`.slice(0, 500), row.at]);
    if (item.status === 'Cancelled') await connection.execute("INSERT INTO booking_change_request(booking_id,request_type,reason,request_status,created_at) VALUES (?,'Cancel',?,'Approved',?)", [bookingId, `${plan.marker}. Customer no longer needed the appointment.`, closedAt]);
  }
  // Reserve only genuinely available points earned by these synthetic records.
  // This covers both an active reservation and the return trail of closed orders.
  for (const row of bookingRows.filter(row => !row.annualKey && ['Submitted', 'Cancelled', 'Rejected', 'Expired'].includes(row.status))) {
    const [[wallet]] = await connection.execute(`SELECT a.current_points,COALESCE((SELECT SUM(r.points) FROM reward_reservation r WHERE r.loyalty_account_id=a.loyalty_account_id AND r.status='Reserved'),0) AS reserved FROM loyalty_account a WHERE a.customer_id=?`, [row.customerId]);
    if (!wallet || Number(wallet.current_points) - Number(wallet.reserved) < Number(rewardRule.redemption_points) || row.amount < Number(rewardRule.redemption_value)) continue;
    // Reproduce the original Submitted -> terminal transition within this import
    // transaction only. The production reservation helper still validates the
    // wallet/rule, and no intermediate state is visible to another connection.
    if (terminal.has(row.status)) await connection.execute("UPDATE booking SET booking_status='Submitted' WHERE booking_id=?", [row.bookingId]);
    await reserveCreatedBookingReward(connection, row.customerId, row.bookingId, Number(rewardRule.redemption_points), Number(rewardRule.version));
    counter.rewardReservations++;
    if (terminal.has(row.status)) {
      await connection.execute('UPDATE booking SET booking_status=?,updated_at=? WHERE booking_id=?', [row.status, row.updatedAt, row.bookingId]);
      await releaseBookingRewardReservation(connection, row.bookingId, `${plan.marker}. Points returned after the fictional order closed.`);
      counter.rewardReturns++;
    }
    await connection.execute('UPDATE reward_reservation SET reason=CONCAT(?,reason),updated_at=? WHERE booking_id=?', [`${plan.marker}. `, row.updatedAt, row.bookingId]);
    await connection.execute("UPDATE reward_activity SET description=CONCAT(?,description),created_at=CASE WHEN kind='Reserved' THEN ? ELSE ? END WHERE booking_id=?", [`${plan.marker}. `, row.createdAt, row.updatedAt, row.bookingId]);
  }
  // Append balanced receipts and issues to the existing stock. Existing counters
  // become the opening baseline; no historical ledger is reset or rewritten.
  const uses = [];
  for (const row of bookingRows.filter(row => row.status === 'Completed')) {
    if (row.serviceCodes.includes('cleaning')) uses.push({ row, part: partNamed('Coil Cleaner (500 mL)'), quantity: 1 });
    if (row.serviceCodes.includes('repair')) uses.push({ row, part: partNamed('Capacitor 35uF'), quantity: 1 });
  }
  const stocks = new Map(parts.map(part => [part.part_id, Number(part.current_stock)]));
  const stockChanges = [];
  async function movement({ part, type, quantity, row, occurredAt, key }) {
    const before = stocks.get(part.part_id), delta = type === 'Stock Out' ? -quantity : quantity, after = before + delta;
    if (after < 0) throw new Error('Coursework stock movement would make inventory negative.');
    const [result] = await connection.execute('INSERT INTO inventory_transaction(job_id,part_id,transaction_type,quantity,remarks,admin_user_id,performed_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?)', [row?.jobId ?? null, part.part_id, type, quantity, `${plan.marker}. ${type === 'Stock Out' ? `Illustrative material usage for ${row.key}; no real warehouse issue.` : 'Illustrative receipt supporting the appended historical scenarios; not a real delivery.'}`, type === 'Stock Out' ? null : actorUserId, row?.lead.userId ?? actorUserId, occurredAt]);
    const transactionId = addId('inventoryTransactionIds', result);
    await connection.execute('INSERT INTO inventory_web_operation(request_id,payload_hash,transaction_id,stock_before,stock_delta,stock_after) VALUES (?,?,?,?,?,?)', [uuid(`${batchKey}:inventory:${key}`), hash({ batchKey, key, type, quantity, partId: part.part_id }), transactionId, before, delta, after]);
    stocks.set(part.part_id, after);
  }
  for (const part of parts) {
    const partUses = uses.filter(use => use.part.part_id === part.part_id);
    if (!partUses.length) continue;
    const receipt = partUses.reduce((sum, use) => sum + use.quantity, 0) + 2;
    await movement({ part, type: 'Stock In', quantity: receipt, occurredAt: utcTime(localTime(previousWeekday(addCalendarDays(ordered[0].date, -1)), '08:00:00')), key: `receipt-${part.part_id}` });
    for (const use of partUses) await movement({ ...use, type: 'Stock Out', occurredAt: utcTime(shift(use.row.actualStart, -10)), key: `${use.row.key}-${part.part_id}` });
    const after = stocks.get(part.part_id), before = Number(part.current_stock);
    await connection.execute('UPDATE part SET current_stock=? WHERE part_id=?', [after, part.part_id]);
    stockChanges.push({ partId: part.part_id, before, delta: after - before, after });
  }
  const checks = await verifyCourseworkBatch(connection, ids, stockChanges);
  const [[mailAfter]] = await connection.query('SELECT COUNT(*) n FROM booking_email_outbox');
  // A concurrent real dispatch may add mail. Verify only new booking IDs rather
  // than assuming the global count is fixed while the website remains online.
  const [[batchMail]] = await connection.execute(`SELECT COUNT(*) n FROM booking_email_outbox WHERE booking_id IN (${list(ids.bookingIds)})`, ids.bookingIds);
  if (Number(batchMail.n)) throw new Error('Coursework data must never queue booking emails.');
  checks.noBatchEmails = true;
  return { version: VERSION, batchKey, asOf, marker: plan.marker, requestId,
    counts: { ...plan.counts, ...counter, addresses: ids.addressIds.length, units: ids.unitIds.length, inventoryTransactions: ids.inventoryTransactionIds.length },
    ids, checks, stockChanges, mail: { batchMessages: 0, before: Number(mailBefore.n), after: Number(mailAfter.n) },
    notice: 'Synthetic coursework records only. New accounts have no known password. No existing orders, logins, catalogue or emails were replaced.' };
}

async function verifyCourseworkBatch(connection, ids, stockChanges) {
  const checks = {};
  const check = async (name, sql, values) => { const [bad] = await connection.execute(sql, values); if (bad.length) throw new Error(`Coursework integrity check failed: ${name}`); checks[name] = true; };
  const b = list(ids.bookingIds), c = list(ids.customerIds), s = list(ids.seriesIds), r = list(ids.reportIds);
  await check('bookingOwnership', `SELECT b.booking_id FROM booking b JOIN service_address a ON a.address_id=b.address_id WHERE b.booking_id IN (${b}) AND b.customer_id<>a.customer_id`, ids.bookingIds);
  await check('unitOwnership', `SELECT b.booking_id FROM booking b JOIN booking_aircon_unit bu ON bu.booking_id=b.booking_id JOIN aircon_unit u ON u.unit_id=bu.unit_id WHERE b.booking_id IN (${b}) AND (u.customer_id<>b.customer_id OR u.address_id<>b.address_id)`, ids.bookingIds);
  await check('serviceAmounts', `SELECT b.booking_id FROM booking b LEFT JOIN booking_service s ON s.booking_id=b.booking_id WHERE b.booking_id IN (${b}) GROUP BY b.booking_id,b.total_amount HAVING COUNT(s.service_id)=0 OR ABS(SUM(s.line_total)-b.total_amount)>0.001`, ids.bookingIds);
  await check('annualTotals', `SELECT s.series_id FROM annual_booking_series s LEFT JOIN annual_booking_visit v ON v.series_id=s.series_id LEFT JOIN booking b ON b.booking_id=v.booking_id WHERE s.series_id IN (${s}) GROUP BY s.series_id,s.total_amount HAVING COUNT(*)<>4 OR COUNT(DISTINCT v.visit_number)<>4 OR ABS(SUM(b.total_amount)-s.total_amount)>0.001`, ids.seriesIds);
  await check('annualWindows', `SELECT v.booking_id FROM annual_booking_visit v JOIN booking b ON b.booking_id=v.booking_id WHERE v.series_id IN (${s}) AND (b.preferred_service_date<v.window_start OR b.preferred_service_date>=v.window_end OR v.scheduled_date<>b.preferred_service_date)`, ids.seriesIds);
  await check('weekdayAppointments', `SELECT booking_id FROM booking WHERE booking_id IN (${b}) AND WEEKDAY(preferred_service_date)>4`, ids.bookingIds);
  await check('cleaningQuota', `SELECT b.customer_id,b.address_id,YEARWEEK(b.preferred_service_date,3) week FROM booking b WHERE b.booking_id IN (${b}) AND b.booking_status NOT IN ('Cancelled','Rejected','Expired') AND EXISTS(SELECT 1 FROM booking_service bs JOIN simple_service_catalog sc ON sc.service_id=bs.service_id AND sc.code='cleaning' WHERE bs.booking_id=b.booking_id) GROUP BY b.customer_id,b.address_id,YEARWEEK(b.preferred_service_date,3) HAVING COUNT(*)>1`, ids.bookingIds);
  await check('teamMembership', `SELECT b.booking_id FROM booking b JOIN assignment a ON a.booking_id=b.booking_id LEFT JOIN assignment_member m ON m.assignment_id=a.assignment_id WHERE b.booking_id IN (${b}) GROUP BY b.booking_id,b.required_technicians,a.technician_id HAVING COUNT(m.technician_id)<b.required_technicians OR SUM(m.technician_id=a.technician_id)<>1`, ids.bookingIds);
  await check('reportIdentity', `SELECT r.report_id FROM service_report r LEFT JOIN performance_visit p ON p.report_id=r.report_id LEFT JOIN service_visit_record v ON v.report_id=r.report_id WHERE r.report_id IN (${r}) AND (p.report_id IS NULL OR v.visit_id IS NULL OR p.technician_id<>r.visit_technician_id OR r.completed_at<r.started_at OR p.actual_end<>r.completed_at OR p.outcome<>'Completed')`, ids.reportIds);
  await check('completionAmounts', `SELECT b.booking_id FROM booking b LEFT JOIN booking_completion_reward r ON r.booking_id=b.booking_id WHERE b.booking_id IN (${b}) AND b.booking_status='Completed' AND (r.booking_id IS NULL OR r.completed_at IS NULL OR r.outcome='Pending' OR r.base_amount<>b.total_amount OR ABS(r.base_amount+r.additional_fee-r.gross_amount)>0.001 OR ABS(r.gross_amount-r.discount_amount-r.net_amount)>0.001)`, ids.bookingIds);
  await check('rewardBalances', `SELECT a.loyalty_account_id FROM loyalty_account a LEFT JOIN loyalty_transaction t ON t.loyalty_account_id=a.loyalty_account_id WHERE a.customer_id IN (${c}) GROUP BY a.loyalty_account_id,a.current_points HAVING a.current_points<>COALESCE(SUM(t.points),0) OR a.current_points<0`, ids.customerIds);
  await check('rewardReservations', `SELECT a.loyalty_account_id FROM loyalty_account a LEFT JOIN reward_reservation r ON r.loyalty_account_id=a.loyalty_account_id AND r.status='Reserved' WHERE a.customer_id IN (${c}) GROUP BY a.loyalty_account_id,a.current_points HAVING COALESCE(SUM(r.points),0)>a.current_points`, ids.customerIds);
  for (const change of stockChanges) {
    const [[stock]] = await connection.execute('SELECT current_stock FROM part WHERE part_id=?', [change.partId]);
    const [[movement]] = await connection.execute(`SELECT COALESCE(SUM(CASE WHEN transaction_type='Stock Out' THEN -quantity ELSE quantity END),0) delta FROM inventory_transaction WHERE transaction_id IN (${list(ids.inventoryTransactionIds)}) AND part_id=?`, [...ids.inventoryTransactionIds, change.partId]);
    if (Number(stock.current_stock) !== change.after || change.before + Number(movement.delta) !== change.after) throw new Error('Coursework inventory delta did not reconcile.');
  }
  checks.inventoryDelta = true;
  return checks;
}
