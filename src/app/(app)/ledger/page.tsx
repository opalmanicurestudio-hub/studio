// src/app/(app)/ledger/page.tsx
// The Ledger now lives inside the Money Hub — redirect old links/bookmarks.
import { redirect } from 'next/navigation';

export default function LedgerRedirect() {
  redirect('/money?tab=ledger');
}
