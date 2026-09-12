import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingMail, createMailTransport } from '../server/booking-email.mjs';

test('booking email uses English dates, complete services and escaped user content', () => {
 const result = buildBookingMail({booking_id:42,full_name:'Alice <script>',preferred_date:'2026-09-20',time_window:'09:00 - 11:00',address_line:'<img src=x onerror=alert(1)>',unit_count:2,booking_status:'Submitted',total_amount:110,problem_description:'weak cooling & noise'}, 'Cleaning, Inspection');
 assert.match(result.text,/20 Sept? 2026/);
 assert.match(result.text,/Cleaning, Inspection/);
 assert.match(result.text,/\$110.00/);
 assert.ok(!result.html.includes('<script>'));
 assert.ok(!result.html.includes('<img'));
 assert.match(result.html,/&lt;img/);
 assert.equal(createMailTransport('disabled'),null);
});
