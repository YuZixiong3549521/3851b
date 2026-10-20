import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { offers } from '../server/public-site.mjs';
const root=resolve(import.meta.dirname,'..');
process.loadEnvFile(resolve(root,'.env.local'));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const user=process.env.DB_USER;
if(!/^[a-zA-Z0-9_]+$/.test(user))throw new Error('Invalid DB user');
let sql=readFileSync(resolve(root,'database/05-public-site.sql'),'utf8');
for(const [name,base] of offers) sql+=`\nINSERT INTO service_catalog(service_name,description,base_price,estimated_duration_minutes) VALUES (${quote(name)},'AC Care website service',${base},90) ON DUPLICATE KEY UPDATE service_name=VALUES(service_name);\n`;
for (const migration of ['06-booking-packages.sql','07-inventory-audit.sql','08-booking-email.sql','09-simple-services.sql','10-technician-cleaning.sql','11-customer-address-management.sql','12-customer-assistant.sql','13-staff-dispatch.sql','14-admin-schedule.sql','15-technician-completion.sql','16-technician-pages.sql','17-report-signatures.sql','18-service-photo-upload.sql','19-booking-policy.sql','20-admin-workflows.sql','21-service-progress.sql','22-booking-notifications.sql','23-return-workflow.sql','24-admin-planning-and-action-centre.sql','25-separate-visit-reports.sql','26-admin-operations-workspace.sql','27-commerce-rewards.sql','28-annual-plans.sql','29-technician-performance.sql','30-completion-rewards.sql','31-annual-confirmation.sql','32-service-visit-identity.sql','33-booking-amount-snapshots.sql']) sql += '\n' + readFileSync(resolve(root,'database',migration),'utf8') + '\n';
for(const table of ['user_account','customer','service_address','aircon_unit','web_customer_profile','web_booking_details','web_legacy_import','booking_change_request'])sql+=`GRANT INSERT ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
sql+=`GRANT UPDATE ON coolcare_service_app.booking TO '${user}'@'%';\n`;
for (const table of ['booking_service','booking_package','booking_email_outbox','inventory_transaction_revision','annual_booking_series','annual_booking_visit','work_order_cleaning_assessment','work_order_cleaning_assessment_revision','technician','admin_profile','staff_invitation','booking_admin_operation','service_day_capacity_lock','technician_capacity_lock','assignment','work_order']) sql+=`GRANT INSERT ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
for (const table of ['booking_package','customer_subscription','booking_email_outbox','inventory_transaction','technician','admin_profile','staff_invitation','booking_admin_operation','service_day_capacity_lock','technician_capacity_lock','assignment','work_order']) sql+=`GRANT UPDATE ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
sql+=`GRANT UPDATE (customer_id) ON coolcare_service_app.customer TO '${user}'@'%';\n`;
sql+=`GRANT UPDATE (full_name,phone,password_hash,status) ON coolcare_service_app.user_account TO '${user}'@'%';\n`;
sql+=`GRANT UPDATE (address_label,address_line,postal_code,is_default,is_archived,replacement_address_id) ON coolcare_service_app.service_address TO '${user}'@'%';\n`;
sql+=`GRANT UPDATE ON coolcare_service_app.work_order_cleaning_assessment TO '${user}'@'%';\n`;
sql+=`GRANT INSERT, UPDATE ON coolcare_service_app.assistant_booking_draft TO '${user}'@'%';\n`;
sql+=`GRANT INSERT, UPDATE ON coolcare_service_app.service_report TO '${user}'@'%';\n`;
sql+=`GRANT INSERT ON coolcare_service_app.technician_work_operation TO '${user}'@'%';\n`;
sql+=`GRANT INSERT, UPDATE ON coolcare_service_app.technician_portal_profile TO '${user}'@'%';\nGRANT INSERT ON coolcare_service_app.service_report_revision TO '${user}'@'%';\n`;
sql+=`GRANT INSERT ON coolcare_service_app.report_signature TO '${user}'@'%';\n`;
sql+=`GRANT INSERT ON coolcare_service_app.photo TO '${user}'@'%';\nGRANT INSERT ON coolcare_service_app.service_photo_upload TO '${user}'@'%';\n`;
for (const table of ['service_progress','customer_booking_notice','annual_booking_visit']) sql+=`GRANT INSERT, UPDATE ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
for (const table of ['service_progress_event']) sql+=`GRANT INSERT ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
for (const table of ['return_visit_operation','service_visit_record']) sql+=`GRANT INSERT ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
// Audit ledgers are append-only; completion markers are filled atomically before
// commit and never edited by an API after completion.
for (const table of ['commerce_operation','reward_rule_audit','reward_adjustment_audit','loyalty_transaction','annual_plan_renewal','annual_plan_notice','performance_operation']) sql+=`GRANT INSERT ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
for (const table of ['reward_rule','reward_reservation','booking_completion_reward','loyalty_account','performance_visit','performance_feedback','performance_quality','performance_settings']) sql+=`GRANT INSERT, UPDATE ON coolcare_service_app.${table} TO '${user}'@'%';\n`;
// Retired payment tables remain readable archives, not runtime write targets.
for (const [table, privilege] of [['commerce_payment','INSERT'],['reward_booking_earning','INSERT'],['reward_booking_earning','UPDATE']]) {
  const revoke=`REVOKE ${privilege} ON coolcare_service_app.${table} FROM '${user}'@'%'`;
  sql+=`SET @retire_grant = IF(EXISTS(SELECT 1 FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=${quote(`'${user}'@'%'`)} AND TABLE_SCHEMA='coolcare_service_app' AND TABLE_NAME='${table}' AND PRIVILEGE_TYPE='${privilege}'),${quote(revoke)},'DO 0');\nPREPARE retire_stmt FROM @retire_grant; EXECUTE retire_stmt; DEALLOCATE PREPARE retire_stmt;\n`;
}
const result=spawnSync('docker',['compose','--env-file','.env.local','exec','-T','database','sh','-c','exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'],{cwd:root,input:sql,encoding:'utf8',windowsHide:true});
if(result.status!==0){console.error(result.stderr);process.exit(1);}console.log('All application migrations are ready, including visit ownership, annual confirmation and completed amount snapshots. Existing data preserved.');
