// src/app/(app)/payday/page.tsx
// Payday now lives inside the Money Hub — redirect old links/bookmarks.
import { redirect } from 'next/navigation';

export default function PaydayRedirect() {
  redirect('/money?tab=payday');
}
