// src/app/(app)/bills/page.tsx
// Obligations/Bills now live inside the Money Hub — redirect old links/bookmarks.
import { redirect } from 'next/navigation';

export default function BillsRedirect() {
  redirect('/money?tab=bills');
}
