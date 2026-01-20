
'use client';

import { useUser, useCollection, useMemoFirebase } from '@/firebase';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Loader } from 'lucide-react';
import { collection, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase/provider';


const protectedRoutes = ['/dashboard', '/planner', '/inventory', '/clients', '/services', '/staff', '/financials', '/reports', '/settings', '/ai-cfo', '/bills', '/consents', '/ledger', '/memberships', '/payday', '/quotes', '/retail', '/walk-in-queue', '/transactions'];
const publicRoutes = ['/login', '/signup', '/'];
const subscriptionRoute = '/subscriptions';


export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore(); // Safe to call here as we are inside the provider
  const router = useRouter();
  const pathname = usePathname();

  // Memoize the query to prevent re-renders
  const tenantQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
  }, [user, firestore]);

  const { data: tenants, isLoading: isTenantLoading } = useCollection(tenantQuery);
  const tenant = tenants?.[0];

  useEffect(() => {
    if (isUserLoading || (user && isTenantLoading)) return; // Wait for user and their tenant data to load

    const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
    const isPublicAuthRoute = pathname === '/login' || pathname === '/signup';
    const isSubscriptionRoute = pathname.startsWith(subscriptionRoute);
    
    // If not logged in and on a protected route, redirect to login
    if (!user && isProtectedRoute) {
      router.replace('/login');
      return;
    }

    // If logged in...
    if (user) {
        // ...and on a public auth page, redirect to dashboard
        if (isPublicAuthRoute) {
            router.replace('/dashboard');
            return;
        }

        // ...but has no active subscription and is on a protected route (that is not the sub page)...
        if (tenant && tenant.subscriptionStatus === 'inactive' && isProtectedRoute && !isSubscriptionRoute) {
            router.replace(subscriptionRoute);
            return;
        }
        
        // ...and has an active subscription but is on the subscription page...
        if (tenant && tenant.subscriptionStatus === 'active' && isSubscriptionRoute) {
            router.replace('/dashboard');
            return;
        }
    }

  }, [user, isUserLoading, tenant, isTenantLoading, router, pathname]);

  const isLoading = isUserLoading || (user && isTenantLoading);
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));

  // Show loader only on protected routes while we figure out auth/subscription status
  if (isLoading && isProtectedRoute) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
