// src/app/table/[tenantId]/layout.tsx — booking a table online, in the business's look.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Book a table',
  description: 'Pick a day and a time, and book your table.',
};

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
