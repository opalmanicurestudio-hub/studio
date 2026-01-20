
'use client';

import { useUser } from '@/firebase';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Loader } from 'lucide-react';

const protectedRoutes = ['/dashboard', '/planner', '/inventory', '/clients', '/services', '/staff', '/financials', '/reports', '/settings', '/ai-cfo', '/bills', '/consents', '/ledger', '/memberships', '/payday', '/quotes', '/retail', '/walk-in-queue', '/transactions'];
const publicRoutes = ['/login', '/signup', '/'];


export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isUserLoading) return;

    const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
    const isPublicAuthRoute = pathname === '/login' || pathname === '/signup';

    if (!user && isProtectedRoute) {
      router.replace('/login');
    }

    if (user && isPublicAuthRoute) {
        router.replace('/dashboard');
    }
  }, [user, isUserLoading, router, pathname]);

  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
  if (isUserLoading && isProtectedRoute) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
