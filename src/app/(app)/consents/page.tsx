'use client';
// src/app/(app)/consents/page.tsx — FORMS MOVED INTO SETTINGS (board FormsOwner: "Agreements in the sidebar moves
// here"). Old links still work: /consents opens Settings › Forms and documents, and ?edit=<form> or ?new=1 opens the
// form builder there.
import * as React from 'react';
import { useRouter } from 'next/navigation';

export default function ConsentsMoved() {
  const router = useRouter();
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search); const id = q.get('edit');
    router.replace(id ? `/settings/forms/form?id=${encodeURIComponent(id)}` : q.get('new') === '1' ? '/settings/forms/form?new=1' : '/settings/forms');
  }, [router]);
  return <p className="p-8 text-[15px] text-muted-foreground">Opening Forms and documents…</p>;
}
