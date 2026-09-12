import { realpath,stat } from 'node:fs/promises';
import { resolve,relative,isAbsolute,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDemoCustomer } from './customer.mjs';
import { HttpError } from './errors.mjs';

// Private local originals, never mounted as public static assets. The database
// stores filenames (or legacy uploads/ paths); remote URLs are never fetched.
export const reportPhotoDirectory=fileURLToPath(new URL('../../.local/service-photos/',import.meta.url));
const imageExtensions=new Set(['.jpg','.jpeg','.png','.webp','.gif']);
export async function resolveReportPhoto(storedPath) {
  if(typeof storedPath!=='string'||/[\0?#]/.test(storedPath)||storedPath.includes(':')||storedPath.includes('\\'))return null;
  const local=storedPath.replace(/^\/?(?:uploads|service-photos)\//,'');
  if(!local||isAbsolute(local)||!imageExtensions.has(extname(local).toLowerCase()))return null;
  const candidate=resolve(reportPhotoDirectory,local);
  const contained=path=>{const child=relative(reportPhotoDirectory,path);return child!==''&&!child.startsWith('..')&&!isAbsolute(child);};
  if(!contained(candidate))return null;
  try {
    const actual=await realpath(candidate);
    if(!contained(actual)||!(await stat(actual)).isFile())return null;
    return actual;
  }catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return null;throw error;}
}

export async function getOwnedReportPhoto(pool,userId,bookingId,photoId) {
  const customer=await getDemoCustomer(pool,userId);
  const [[photo]]=await pool.execute(`SELECT p.photo_url AS photoUrl FROM photo p
    JOIN work_order w ON w.job_id=p.job_id JOIN booking b ON b.booking_id=w.booking_id
    WHERE b.customer_id=? AND b.booking_id=? AND p.photo_id=?`,[customer.customerId,bookingId,photoId]);
  const path=photo&&await resolveReportPhoto(photo.photoUrl);
  if(!path)throw new HttpError(404,'Service photo is not available.');
  return path;
}
