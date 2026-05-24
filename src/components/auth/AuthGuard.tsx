
'use client';

import { useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Loader } from 'lucide-react';
import { collection, query, where, doc } from 'firebase/firestore';
import { useFirestore } from '@/firebase/provider';


const protectedRoutes = ['/dashboard', '/planner', '/inventory', '/clients', '/services', '/staff', '/financials', '/reports', '/settings', '/ai-cfo', '/bills', '/consents', '/ledger', '/memberships', '/payday', '/quotes', '/retail', '/walk-in-queue', '/transactions'];
const publicRoutes = ['/login', '/signup', '/'];
const subscriptionRoute = '/subscriptions';


export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore(); 
  const router = useRouter();
  const pathname = usePathname();

  // Memoize the query to prevent re-renders
  const ownerTenantQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
  }, [user, firestore]);

  const { data: ownerTenants, isLoading: isOwnerTenantLoading } = useCollection(ownerTenantQuery);
  const isOwner = ownerTenants && ownerTenants.length > 0;

  const staffDirectoryEntryRef = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    // Only query if we know the user is NOT an owner
    if (!isOwnerTenantLoading && !isOwner) {
        return doc(firestore, 'staffDirectory', user.uid);
    }
    return null;
  }, [user, firestore, isOwner, isOwnerTenantLoading]);
  
  const { data: staffDirectoryEntry, isLoading: isStaffDirectoryLoading } = useDoc(staffDirectoryEntryRef);
  const isStaff = !!staffDirectoryEntry;

  useEffect(() => {
    const isAuthDataLoading = isUserLoading || isOwnerTenantLoading || isStaffDirectoryLoading;

    if (isAuthDataLoading) return;

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
        // ...and on a public auth page, redirect to the main dashboard
        if (isPublicAuthRoute) {
            router.replace('/dashboard');
            return;
        }

        // Subscription check (simplified for now, assumes owner has tenant data)
        if (isOwner && ownerTenants?.[0] && ownerTenants[0].subscriptionStatus === 'inactive' && isProtectedRoute && !isSubscriptionRoute) {
            router.replace(subscriptionRoute);
            return;
        }
    }

  }, [user, isUserLoading, isOwner, isStaff, isOwnerTenantLoading, isStaffDirectoryLoading, router, pathname, ownerTenants]);

  const isLoading = isUserLoading || isOwnerTenantLoading || (user && !isOwner && isStaffDirectoryLoading);
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
