import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Book an Appointment',
  description: 'Book your visit.',
};

// No wrapper — let the booking page own 100% of the viewport
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}