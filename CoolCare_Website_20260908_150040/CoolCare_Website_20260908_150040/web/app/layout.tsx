import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'CoolCare | Admin Inventory',
  description: 'Local CoolCare parts and stock movements.',
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
