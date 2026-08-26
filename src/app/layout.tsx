import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WorkDesk.AI',
  description: 'WorkDesk AI GoRevive',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}