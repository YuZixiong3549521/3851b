import { HttpError } from './errors.mjs';

const numeric = row => ({ ...row, basePrice: Number(row.basePrice), additionalUnitPrice: Number(row.additionalUnitPrice) });

export async function getBookingOptions(executor, customerId) {
  const [rows] = await executor.query(`SELECT s.service_id AS serviceId,s.service_name AS name,s.description,
    s.base_price AS basePrice,p.additional_unit_price AS additionalUnitPrice
    FROM service_catalog s JOIN web_service_pricing p ON p.service_id=s.service_id
    WHERE s.service_status='Active' AND p.customer_visible=TRUE ORDER BY s.service_id`);
  const services = rows.map(numeric);
  const [packages] = await executor.query(`SELECT p.package_id AS packageId,p.package_name AS name,p.description,
    p.package_price AS price,d.package_kind AS kind,d.included_units AS includedUnits,
    d.additional_unit_price AS additionalUnitPrice,p.included_service_count AS includedVisits,
    p.billing_interval AS billingInterval FROM maintenance_package p JOIN web_package_details d ON d.package_id=p.package_id
    WHERE p.package_status='Active' ORDER BY p.package_id`);
  const [links] = await executor.query('SELECT package_id AS packageId,service_id AS serviceId FROM package_service ORDER BY service_id');
  const packageServices = id => services.filter(service => links.some(link => link.packageId === id && link.serviceId === service.serviceId));
  const [subscriptions] = await executor.execute(`SELECT cs.subscription_id AS subscriptionId,cs.package_id AS packageId,
    p.package_name AS name,cs.remaining_service_count AS remainingVisits,cs.start_date AS startDate,cs.end_date AS endDate,
    cs.subscription_status AS status FROM customer_subscription cs JOIN maintenance_package p ON p.package_id=cs.package_id
    WHERE cs.customer_id=? AND cs.subscription_status='Active' AND p.package_status='Active'
    AND cs.end_date >= CURRENT_DATE ORDER BY cs.end_date,cs.subscription_id`, [customerId]);
  return {
    services,
    bundles: packages.filter(p => p.kind === 'Bundle').map(p => ({ ...p, price: Number(p.price), additionalUnitPrice: Number(p.additionalUnitPrice), serviceIds: packageServices(p.packageId).map(s => s.serviceId) })),
    memberships: packages.filter(p => p.kind === 'Membership').map(p => ({ ...p, price: Number(p.price), serviceIds: packageServices(p.packageId).map(s => s.serviceId) })),
    subscriptions: subscriptions.map(s => ({ ...s, services: packageServices(s.packageId) })),
  };
}

// All booking writes lock the customer row before reading bookings/subscriptions.
// This serializes concurrent requests across both public and customer APIs.
export async function lockCustomer(connection, userId, email) {
  const [[row]] = await connection.execute(`SELECT customer_id AS customerId,user_id AS userId FROM customer
    WHERE user_id=${userId === undefined ? '(SELECT user_id FROM user_account WHERE email=?)' : '?'} FOR UPDATE`, [userId ?? email]);
  if (!row) throw new HttpError(403, 'Customer profile not found.');
  return row;
}

export function normalizeAddress(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\-/]/gu, '');
}

export function exceedsWeeklyLimit(existingDates, proposedDate) {
  const day = value => Math.floor(new Date(`${String(value).slice(0,10)}T00:00:00Z`).getTime() / 86400000);
  const proposed = day(proposedDate);
  const days = existingDates.map(day).filter(d => Math.abs(d - proposed) <= 6).concat(proposed).sort((a,b) => a-b);
  for (let index = 0; index + 2 < days.length; index++) {
    if (days[index + 2] - days[index] <= 6 && days[index] <= proposed && days[index + 2] >= proposed) return true;
  }
  return false;
}

export async function assertAddressBookingLimit(connection, customerId, addressLine, preferredDate, excludeBookingId = 0) {
  const [bookings] = await connection.execute(`SELECT b.preferred_service_date AS serviceDate,sa.address_line AS addressLine
    FROM booking b JOIN service_address sa ON sa.address_id=b.address_id
    WHERE b.customer_id=? AND b.booking_status <> 'Cancelled' AND b.booking_id <> ?
    AND b.preferred_service_date BETWEEN DATE_SUB(?,INTERVAL 6 DAY) AND DATE_ADD(?,INTERVAL 6 DAY)`,
  [customerId,excludeBookingId,preferredDate,preferredDate]);
  const address = normalizeAddress(addressLine);
  if (exceedsWeeklyLimit(bookings.filter(b => normalizeAddress(b.addressLine) === address).map(b => b.serviceDate), preferredDate)) {
    throw new HttpError(409, 'This address already has two bookings within a seven-day period. Choose another date or manage your existing bookings.');
  }
}

export async function resolveBookingSelection(connection, customerId, input, numberOfUnits) {
  if (input.packageId && input.subscriptionId) throw new HttpError(400, 'Choose a bundle or a membership visit.');
  let selectedIds = input.serviceIds?.length ? input.serviceIds : input.serviceId ? [input.serviceId] : [];
  if (new Set(selectedIds).size !== selectedIds.length) throw new HttpError(400, 'A service was selected more than once.');
  let selectedPackage;
  let subscription;
  if (input.subscriptionId) {
    const [[row]] = await connection.execute(`SELECT subscription_id AS subscriptionId,package_id AS packageId,
      remaining_service_count AS remainingVisits,start_date AS startDate,end_date AS endDate,subscription_status AS status
      FROM customer_subscription WHERE subscription_id=? AND customer_id=? FOR UPDATE`, [input.subscriptionId,customerId]);
    if (!row) throw new HttpError(403, 'This membership does not belong to your account.');
    if (row.status !== 'Active' || row.remainingVisits < 1 || input.preferredDate < String(row.startDate).slice(0,10) || input.preferredDate > String(row.endDate).slice(0,10)) {
      throw new HttpError(409, 'This membership has no available visits for the selected date.');
    }
    subscription = row;
  }
  if (input.packageId || subscription) {
    const [[row]] = await connection.execute(`SELECT p.package_id AS packageId,p.package_name AS name,p.package_price AS price,
      d.package_kind AS kind,d.included_units AS includedUnits,d.additional_unit_price AS additionalUnitPrice
      FROM maintenance_package p JOIN web_package_details d ON d.package_id=p.package_id
      WHERE p.package_id=? AND p.package_status='Active'`, [subscription?.packageId ?? input.packageId]);
    if (!row || row.kind !== (subscription ? 'Membership' : 'Bundle')) throw new HttpError(400, 'The selected package is not available.');
    selectedPackage = row;
    const [links] = await connection.execute(`SELECT ps.service_id AS serviceId FROM package_service ps
      JOIN service_catalog s ON s.service_id=ps.service_id JOIN web_service_pricing p ON p.service_id=s.service_id
      WHERE ps.package_id=? AND s.service_status='Active' AND p.customer_visible=TRUE ORDER BY ps.service_id`, [row.packageId]);
    const included = links.map(s => s.serviceId);
    if (!included.length) throw new HttpError(400, 'This package has no available services.');
    if (selectedIds.length && (selectedIds.length !== included.length || selectedIds.some(id => !included.includes(id)))) throw new HttpError(400, 'Select the services included in your package.');
    selectedIds = included;
  }
  if (!selectedIds.length && input.serviceType) {
    const [[legacy]] = await connection.execute("SELECT service_id AS serviceId FROM service_catalog WHERE service_name=? AND service_status='Active'", [input.serviceType]);
    if (legacy) selectedIds = [legacy.serviceId];
  }
  if (!selectedIds.length) throw new HttpError(400, 'Choose at least one service.');
  const [rows] = await connection.execute(`SELECT s.service_id AS serviceId,s.service_name AS name,s.base_price AS basePrice,
    COALESCE(p.additional_unit_price,s.base_price) AS additionalUnitPrice FROM service_catalog s
    LEFT JOIN web_service_pricing p ON p.service_id=s.service_id
    WHERE s.service_id IN (${selectedIds.map(() => '?').join(',')}) AND s.service_status='Active' ORDER BY s.service_id`, selectedIds);
  if (rows.length !== selectedIds.length) throw new HttpError(400, 'One or more selected services are not available.');
  if (!subscription && rows.some(row => row.name === 'Maintenance Package Service')) throw new HttpError(400, 'Choose your membership to book an included visit.');
  const services = rows.map(row => ({ ...numeric(row), quantity: numberOfUnits, lineTotal: Number(row.basePrice) + (numberOfUnits - 1) * Number(row.additionalUnitPrice) }));
  const totalAmount = Number((subscription ? 0 : selectedPackage ? Number(selectedPackage.price) + Math.max(0,numberOfUnits - selectedPackage.includedUnits) * Number(selectedPackage.additionalUnitPrice) : services.reduce((total,s) => total + s.lineTotal,0)).toFixed(2));
  // A bundle snapshot allocates its final charge proportionally across services.
  const fullTotal = services.reduce((total,s) => total + s.lineTotal,0);
  let allocated = 0;
  services.forEach((service,index) => {
    service.lineTotal = index === services.length - 1 ? Number((totalAmount - allocated).toFixed(2)) : Number((fullTotal ? service.lineTotal / fullTotal * totalAmount : 0).toFixed(2));
    allocated += service.lineTotal;
  });
  return { services, totalAmount, package: selectedPackage, subscription, serviceName: services.map(s => s.name).join(' + ') };
}

export async function saveBookingSelection(connection, bookingId, selection) {
  for (const service of selection.services) {
    await connection.execute(`INSERT INTO booking_service(booking_id,service_id,service_name,base_price,additional_unit_price,quantity,line_total) VALUES (?,?,?,?,?,?,?)`,
      [bookingId,service.serviceId,service.name,service.basePrice,service.additionalUnitPrice,service.quantity,service.lineTotal]);
  }
  if (selection.package) {
    await connection.execute('INSERT INTO booking_package(booking_id,package_id,package_name,subscription_id,visit_reserved) VALUES (?,?,?,?,?)',
      [bookingId,selection.package.packageId,selection.package.name,selection.subscription?.subscriptionId ?? null,Boolean(selection.subscription)]);
  }
  if (selection.subscription) await connection.execute('UPDATE customer_subscription SET remaining_service_count=remaining_service_count-1 WHERE subscription_id=?', [selection.subscription.subscriptionId]);
}

export async function restoreMembershipVisit(connection, bookingId) {
  const [[usage]] = await connection.execute('SELECT subscription_id FROM booking_package WHERE booking_id=? AND visit_reserved=TRUE FOR UPDATE', [bookingId]);
  if (!usage) return;
  await connection.execute('UPDATE customer_subscription SET remaining_service_count=remaining_service_count+1 WHERE subscription_id=?', [usage.subscription_id]);
  await connection.execute('UPDATE booking_package SET visit_reserved=FALSE WHERE booking_id=?', [bookingId]);
}

export async function attachBookingSelections(executor, bookings, idKey='bookingId') {
  if (!bookings.length) return bookings;
  const ids = bookings.map(b => b[idKey]);
  const placeholders = ids.map(() => '?').join(',');
  const [services] = await executor.execute(`SELECT booking_id AS bookingId,service_id AS serviceId,service_name AS name,quantity,line_total AS lineTotal
    FROM booking_service WHERE booking_id IN (${placeholders}) ORDER BY service_id`, ids);
  const [packages] = await executor.execute(`SELECT booking_id AS bookingId,package_id AS packageId,package_name AS name,subscription_id AS subscriptionId,
    visit_reserved AS visitReserved FROM booking_package WHERE booking_id IN (${placeholders})`, ids);
  return bookings.map(booking => {
    const selected = services.filter(s => s.bookingId === booking[idKey]);
    const summary = selected.map(s => s.name).join(' + ');
    return { ...booking, ...(summary ? {serviceName: summary, service_type: summary} : {}), services: selected, package: packages.find(p => p.bookingId === booking[idKey]) ?? null };
  });
}
