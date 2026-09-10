import 'dotenv/config';

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  demoCustomerEmail: process.env.DEMO_CUSTOMER_EMAIL ?? 'alice.tan@coolcare.demo',
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3307),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? 'coolcare_dev',
    database: process.env.DB_NAME ?? 'coolcare_service_app',
  },
};
