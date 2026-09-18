import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssignedBookingMail, createMailTransport } from '../server/booking-email.mjs';

test('assigned booking email uses English dates, technician details and escaped user content', () => {
 const result = buildAssignedBookingMail({booking_id:42,full_name:'Alice <script>',preferred_service_date:'2026-09-20',preferred_time_slot:'09:00 - 11:00',address_line:'<img src=x onerror=alert(1)>',services:'Cleaning, Inspection'}, 'Tech & Team');
 assert.match(result.text,/20 Sept? 2026/);
 assert.match(result.text,/Cleaning, Inspection/);
 assert.match(result.text,/Tech & Team/);
 assert.ok(!result.html.includes('<script>'));
 assert.ok(!result.html.includes('<img'));
 assert.match(result.html,/&lt;img/);
 assert.equal(createMailTransport('disabled'),null);
});
