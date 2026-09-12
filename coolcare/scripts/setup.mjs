import { existsSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const path = resolve(root,'.env.local');
mkdirSync(resolve(root,'.local'),{recursive:true});
if (!existsSync(path)) {
  writeFileSync(path, `DB_HOST=127.0.0.1\nDB_PORT=3307\nDB_NAME=coolcare_service_app\nDB_USER=coolcare_app\nDB_PASSWORD=${randomBytes(24).toString('hex')}\nMYSQL_ROOT_PASSWORD=${randomBytes(24).toString('hex')}\nSESSION_SECRET=${randomBytes(48).toString('hex')}\nAPI_PORT=3001\nWEB_ORIGIN=http://localhost:3000\nLOW_STOCK_THRESHOLD=15\n`, {flag:'wx',mode:0o600});
}
const configText = readFileSync(path,'utf8');
if (!/^MAIL_MODE=/m.test(configText)) appendFileSync(path, '\n# Local classroom mailbox; switch to smtp only after configuring a provider.\nMAIL_MODE=local\nLOCAL_SMTP_PORT=1025\nLOCAL_MAIL_UI_PORT=8025\n');
const env=Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).filter(s=>s && !s.startsWith('#')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
if (!/^[a-zA-Z0-9_]+$/.test(env.DB_USER ?? '') || !/^[a-zA-Z0-9]+$/.test(env.DB_PASSWORD ?? '')) throw new Error('Customized database credentials: create grants manually; configuration preserved.');
writeFileSync(resolve(root,'.local/04-app-user.sql'), `USE coolcare_service_app;\nCREATE USER IF NOT EXISTS '${env.DB_USER}'@'%' IDENTIFIED BY '${env.DB_PASSWORD}';\nGRANT SELECT ON coolcare_service_app.* TO '${env.DB_USER}'@'%';\nGRANT INSERT, UPDATE ON coolcare_service_app.part TO '${env.DB_USER}'@'%';\n` + ['inventory_transaction','inventory_web_operation','booking','booking_aircon_unit','booking_status_history'].map(table=>`GRANT INSERT ON coolcare_service_app.${table} TO '${env.DB_USER}'@'%';`).join('\n')+'\n',{mode:0o600});
console.log('Local configuration prepared. Start Docker Desktop, then run npm run db:up and npm start.');
