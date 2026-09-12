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
    postal_code AS postalCode,is_default AS isDefault FROM service_address WHERE customer_id=? AND is_archived=FALSE ORDER BY address_id`,[customerId]);
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

const validId=value=>{
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1)throw new HttpError(400,'Invalid address identifier.');
  return id;
};

// All address mutations share the booking writer's customer lock. Existing
// bookings and annual series keep their original address, including after edits.
export async function manageCustomerAddress(pool,userId,addressId,action,untrustedInput={}) {
  const id=validId(addressId);
  let input;
  if(action==='update') {
    const parsed=createAddressSchema.safeParse(untrustedInput);
    if(!parsed.success)throw new HttpError(400,'Please check the service address.',z.flattenError(parsed.error).fieldErrors);
    input=parsed.data;
    if(input.expectedUserId!==undefined&&input.expectedUserId!==Number(userId))throw new HttpError(409,'Your signed-in account changed. Reload before saving an address.');
  }
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const customer=await lockCustomer(connection,userId);
    const [[row]]=await connection.execute(`SELECT address_id AS addressId,address_label AS label,address_line AS addressLine,
      postal_code AS postalCode,is_default AS isDefault,is_archived AS isArchived,replacement_address_id AS replacementAddressId
      FROM service_address WHERE customer_id=? AND address_id=? FOR UPDATE`,[customer.customerId,id]);
    if(!row)throw new HttpError(404,'Address not found.');
    if(row.isArchived&&action==='update'&&row.replacementAddressId) {
      const [[replacement]]=await connection.execute(`SELECT address_id AS addressId,address_label AS label,address_line AS addressLine,
        postal_code AS postalCode,is_default AS isDefault FROM service_address WHERE customer_id=? AND address_id=? AND is_archived=FALSE`,
        [customer.customerId,row.replacementAddressId]);
      const postalCode=input.postalCode===undefined?row.postalCode:input.postalCode||null;
      if(replacement&&replacement.addressLine===input.addressLine&&replacement.label===(input.label??row.label)&&replacement.postalCode===postalCode) {
        await connection.commit();
        return addressView(replacement);
      }
    }
    if(row.isArchived&&action!=='archive')throw new HttpError(409,'This saved address has been archived. Refresh your addresses.');
    if(action==='archive') {
      await connection.execute('UPDATE service_address SET is_archived=TRUE,is_default=FALSE WHERE address_id=?',[id]);
      if(row.isDefault)await connection.execute(`UPDATE service_address SET is_default=TRUE
        WHERE customer_id=? AND is_archived=FALSE ORDER BY address_id LIMIT 1`,[customer.customerId]);
      await connection.commit();
      return {success:true};
    }
    if(action==='default') {
      await connection.execute('UPDATE service_address SET is_default=FALSE WHERE customer_id=?',[customer.customerId]);
      await connection.execute('UPDATE service_address SET is_default=TRUE WHERE address_id=?',[id]);
      await connection.commit();
      const {isArchived,replacementAddressId,...address}=row;
      return addressView({...address,isDefault:true});
    }
    const changed={addressId:id,addressLine:input.addressLine,label:input.label??row.label,postalCode:input.postalCode===undefined?row.postalCode:input.postalCode||null,isDefault:Boolean(row.isDefault)};
    const material=changed.addressLine!==row.addressLine||changed.postalCode!==row.postalCode;
    const [[references]]=await connection.execute(`SELECT
      EXISTS(SELECT 1 FROM booking WHERE address_id=?) OR EXISTS(SELECT 1 FROM annual_booking_series WHERE address_id=?) AS used`,[id,id]);
    if(material&&references.used) {
      // A replacement is intentional; never repoint historical bookings or units.
      const [inserted]=await connection.execute(`INSERT INTO service_address(customer_id,address_label,address_line,postal_code,is_default)
        VALUES (?,?,?,?,?)`,[customer.customerId,changed.label,changed.addressLine,changed.postalCode,changed.isDefault]);
      changed.addressId=inserted.insertId;
      await connection.execute('UPDATE service_address SET is_archived=TRUE,is_default=FALSE,replacement_address_id=? WHERE address_id=?',[changed.addressId,id]);
    }else {
      await connection.execute('UPDATE service_address SET address_label=?,address_line=?,postal_code=? WHERE address_id=?',
        [changed.label,changed.addressLine,changed.postalCode,id]);
    }
    await connection.commit();
    return changed;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
