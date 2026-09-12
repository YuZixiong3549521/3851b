import { z } from 'zod';
import { HttpError } from './errors.mjs';
import { lockCustomer,normalizeAddress } from './booking-options.mjs';

export const addressLineSchema=z.string().trim().min(5,'Enter a service address with at least 5 characters.').max(255);
export const createAddressSchema=z.object({
  addressLine:addressLineSchema,
  label:z.string().trim().max(80).optional(),
  postalCode:z.string().trim().refine(value=>value===''||/^\d{6}$/.test(value),'Enter a six-digit Singapore postal code.').optional(),
  expectedUserId:z.coerce.number().int().positive().optional(),
  requestId:z.uuid().optional(),
});
const addressView=row=>({...row,isDefault:Boolean(row.isDefault)});

// Caller holds the customer row lock. Natural-address deduplication makes retries
// safe across forms and concurrent requests without editing an existing address.
export async function findOrCreateServiceAddress(connection,customerId,addressLine,{addressId,label,postalCode}={}) {
  const [rows]=await connection.execute(`SELECT address_id AS addressId,address_label AS label,address_line AS addressLine,
    postal_code AS postalCode,is_default AS isDefault FROM service_address WHERE customer_id=? ORDER BY address_id`,[customerId]);
  if(addressId!==undefined) {
    const selected=rows.find(row=>row.addressId===addressId);
    if(!selected)throw new HttpError(400,'The selected service address is not available.');
    if(normalizeAddress(selected.addressLine)!==normalizeAddress(addressLine))throw new HttpError(400,'The selected address does not match the service address.');
    return addressView(selected);
  }
  const existing=rows.find(row=>normalizeAddress(row.addressLine)===normalizeAddress(addressLine));
  if(existing)return addressView(existing);
  const address={label:label||'Service address',addressLine,postalCode:postalCode||null,isDefault:rows.length===0};
  const [inserted]=await connection.execute('INSERT INTO service_address(customer_id,address_label,address_line,postal_code,is_default) VALUES (?,?,?,?,?)',
    [customerId,address.label,address.addressLine,address.postalCode,address.isDefault]);
  return {addressId:inserted.insertId,...address};
}

// Equipment records are created only when the customer actually books a quantity.
export async function addressUnitIds(connection,customerId,addressId,count) {
  const [units]=await connection.execute('SELECT unit_id FROM aircon_unit WHERE customer_id=? AND address_id=? ORDER BY unit_id LIMIT 10',[customerId,addressId]);
  while(units.length<count) {
    const [unit]=await connection.execute('INSERT INTO aircon_unit(customer_id,address_id,installation_location) VALUES (?,?,?)',[customerId,addressId,`Unit ${units.length+1}`]);
    units.push({unit_id:unit.insertId});
  }
  return units.slice(0,count).map(unit=>unit.unit_id);
}

export async function createCustomerAddress(pool,userId,untrustedInput) {
  const parsed=createAddressSchema.safeParse(untrustedInput);
  if(!parsed.success)throw new HttpError(400,'Please check the service address.',z.flattenError(parsed.error).fieldErrors);
  const input=parsed.data;
  if(input.expectedUserId!==undefined&&input.expectedUserId!==Number(userId))throw new HttpError(409,'Your signed-in account changed. Reload before saving an address.');
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const customer=await lockCustomer(connection,userId);
    const address=await findOrCreateServiceAddress(connection,customer.customerId,input.addressLine,input);
    await connection.commit();
    return address;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
