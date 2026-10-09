'use client';
import {ReturnVisitsPanel} from '@/components/return-visits-panel';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {coolcareApi,type BookingNotice} from '@/lib/coolcare-api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';

export function BookingNotifications({enabled}:{enabled:boolean}){
 const router=useRouter();
 const [notices,setNotices]=useState<BookingNotice[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(!enabled)return;
  let alive=true;
  const refresh=()=>{coolcareApi.getBookingNotices().then(rows=>{if(alive)setNotices(rows);}).catch(()=>undefined);};
  refresh();const timer=window.setInterval(refresh,60000);window.addEventListener('focus',refresh);
  return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[enabled]);
 const notice=notices[0];
 async function dismiss(destination?:string){
  if(!notice||busy)return;setBusy(true);setError('');
  try{await coolcareApi.readBookingNotice(notice.bookingId,notice.noticeKey);setNotices(rows=>rows.filter(row=>row.noticeKey!==notice.noticeKey||row.bookingId!==notice.bookingId));if(destination)router.push(destination);}
  catch(reason){setError(reason instanceof Error?reason.message:'Unable to acknowledge this notice.');}
  finally{setBusy(false);}
 }
 return <>{enabled&&<ReturnVisitsPanel viewerRole="customer" noticeOnly/>}<Dialog open={enabled&&Boolean(notice)} onOpenChange={open=>{if(!open)void dismiss();}}><DialogContent showCloseButton={!busy} className="sm:max-w-lg"><DialogTitle>{notice?.status==='Expired'?'Your booking request expired':'Your booking could not be confirmed'}</DialogTitle><DialogDescription>{notice?.reference}</DialogDescription><p className="whitespace-pre-wrap text-sm leading-6">{notice?.reason}</p><p className="text-sm text-muted-foreground">You can book again with another date or service. Your previous request remains in Booking History.</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="ghost" disabled={busy} onClick={()=>void dismiss()}>Dismiss</Button><Button variant="outline" disabled={busy} onClick={()=>void dismiss(`/customer/bookings/${notice.bookingId}`)}>View booking</Button><Button disabled={busy} onClick={()=>void dismiss(`/customer/book?rebook=${notice.bookingId}`)}>Book again</Button></DialogFooter></DialogContent></Dialog></>;
}
