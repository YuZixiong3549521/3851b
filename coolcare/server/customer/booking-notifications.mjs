import {bookingReference} from './booking-service.mjs';
import {asyncRoute,HttpError} from './errors.mjs';

export async function listBookingNotices(pool,userId){
 const [rows]=await pool.execute(`SELECT b.booking_id AS bookingId,b.created_at AS createdAt,b.booking_status AS status,
  CASE WHEN b.booking_status='Expired' THEN 'This request was not confirmed within 48 hours. Please choose another appointment.' ELSE COALESCE(b.rejection_reason,'Please choose another appointment or contact support.') END AS reason,
  CONCAT(b.booking_status,':',b.rejection_version) AS noticeKey
  FROM booking b JOIN customer c ON c.customer_id=b.customer_id
  WHERE c.user_id=? AND b.booking_status IN ('Rejected','Expired') AND NOT EXISTS
   (SELECT 1 FROM customer_booking_notice n WHERE n.booking_id=b.booking_id AND n.user_id=? AND n.notice_key=CONCAT(b.booking_status,':',b.rejection_version))
  ORDER BY b.booking_id DESC LIMIT 20`,[userId,userId]);
 return rows.map(row=>({...row,reference:bookingReference(row.bookingId,row.createdAt)}));
}
export async function markBookingNoticeRead(pool,userId,id,noticeKey){
 if(!Number.isSafeInteger(Number(id))||Number(id)<1||typeof noticeKey!=='string'||!/^(Rejected|Expired):\d+$/.test(noticeKey))throw new HttpError(400,'Invalid booking notice.');
 const [result]=await pool.execute(`INSERT INTO customer_booking_notice(booking_id,user_id,notice_key)
  SELECT b.booking_id,?,? FROM booking b JOIN customer c ON c.customer_id=b.customer_id
  WHERE b.booking_id=? AND c.user_id=? AND b.booking_status IN ('Rejected','Expired') AND CONCAT(b.booking_status,':',b.rejection_version)=?
  ON DUPLICATE KEY UPDATE read_at=read_at`,[userId,noticeKey,Number(id),userId,noticeKey]);
 if(!result.affectedRows){
  const [[owned]]=await pool.execute(`SELECT n.booking_id FROM customer_booking_notice n JOIN booking b ON b.booking_id=n.booking_id JOIN customer c ON c.customer_id=b.customer_id WHERE n.booking_id=? AND n.user_id=? AND c.user_id=? AND n.notice_key=?`,[Number(id),userId,userId,noticeKey]);
  if(!owned)throw new HttpError(409,'This booking notice changed. Refresh your bookings.');
 }
 return {success:true};
}
export function registerBookingNotifications(app,pool){
 app.get('/booking-notifications',asyncRoute(async(req,res)=>{res.set('Cache-Control','private, no-store');res.json({notices:await listBookingNotices(pool,req.customerUser.id)});}));
 app.post('/booking-notifications/:id/read',asyncRoute(async(req,res)=>res.json(await markBookingNoticeRead(pool,req.customerUser.id,req.params.id,req.body.noticeKey))));
}
