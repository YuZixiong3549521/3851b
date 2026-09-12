import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressSchema } from './address-service.mjs';
import { createBookingSchema } from './booking-service.mjs';

test('address fields trim whitespace, preserve leading-zero postcodes and reject invalid bounds',()=>{
  const address=createAddressSchema.parse({addressLine:'  123 Sample Street #01-02  ',label:' Home ',postalCode:' 012345 '});
  assert.equal(address.addressLine,'123 Sample Street #01-02');assert.equal(address.label,'Home');assert.equal(address.postalCode,'012345');
  for(const bad of [{addressLine:'    '},{addressLine:'A'.repeat(256)},{label:'A'.repeat(81)},{postalCode:'12345'},{postalCode:'1234567'},{postalCode:'ABCDEF'}]) {
    assert.equal(createAddressSchema.safeParse({addressLine:'123 Sample Street',...bad}).success,false);
  }
  assert.equal(createAddressSchema.safeParse({addressLine:'123 Sample Street',postalCode:''}).success,true);
});

test('quantity booking accepts a typed address without registered units and rejects ambiguous input',()=>{
  const input={serviceId:1,serviceAddress:'123 Sample Street',numberOfUnits:3,preferredDate:'2027-01-04',timeSlot:'09:00 - 11:00'};
  assert.equal(createBookingSchema.safeParse(input).success,true);
  for(const invalid of [{unitIds:[1]},{numberOfUnits:0},{numberOfUnits:11},{numberOfUnits:undefined},{serviceAddress:undefined}])assert.equal(createBookingSchema.safeParse({...input,...invalid}).success,false);
  assert.equal(createBookingSchema.safeParse({...input,addressId:1}).success,true);
});
