import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'CoolCare | Service Platform',
  description: 'Customer bookings, technician jobs and inventory in one local CoolCare platform.',
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
