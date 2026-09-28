'use client';
// Operations now lives in the POS ("Needs attention"). This address forwards
// there so bookmarks and notification links keep working.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function OperationsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/pos?attention=1'); }, [router]);
  return null;
}
