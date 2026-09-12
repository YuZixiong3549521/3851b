import mysql from 'mysql2/promise';

// A few HTTP tests need reports/assignments/photos that the local application
// cannot create yet. Use the setup-generated local root credential only for
// their outer rollback fixture; never add these privileges to the app user.
// Callers must roll back and end this connection in finally.
export async function openPrivilegedFixtureConnection() {
  if(!process.env.MYSQL_ROOT_PASSWORD)throw new Error('Privileged rollback fixtures require MYSQL_ROOT_PASSWORD from the local setup-generated .env.local.');
  return mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,
    user:'root',password:process.env.MYSQL_ROOT_PASSWORD,dateStrings:true,decimalNumbers:true});
}
