'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';

export default function WalkInRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/walk-in-queue');
  }, [router]);

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader className="h-8 w-8 animate-spin" />
    </div>
  );
}
