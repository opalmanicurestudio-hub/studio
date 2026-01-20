
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Check, Loader } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { updateDocumentNonBlocking } from '@/firebase';


export default function SubscriptionsPage() {
    const { user, firestore, isUserLoading } = useFirebase();
    const router = useRouter();
    const { toast } = useToast();
    const [isSubscribing, setIsSubscribing] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);

    const tenantQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
    }, [user, firestore]);

    const { data: tenants, isLoading: isTenantLoading } = useCollection(tenantQuery);
    const tenant = tenants?.[0];

    const handleSubscribe = async () => {
        if (!tenant || !firestore) return;

        setIsSubscribing(true);
        try {
            const tenantRef = doc(firestore, 'tenants', tenant.id);
            updateDocumentNonBlocking(tenantRef, {
                subscriptionStatus: 'active',
                subscriptionTier: 'pro'
            });

            toast({
                title: 'Subscription Successful!',
                description: "Welcome! You now have full access to ClarityFlow.",
            });

            router.push('/dashboard');
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Subscription Failed',
                description: 'Could not update your subscription. Please try again.',
            });
        } finally {
            setIsSubscribing(false);
        }
    };
    
    const handleCancelSubscription = async () => {
        if (!tenant || !firestore) return;

        setIsCancelling(true);
        try {
            const tenantRef = doc(firestore, 'tenants', tenant.id);
            await updateDocumentNonBlocking(tenantRef, {
                subscriptionStatus: 'inactive',
                subscriptionTier: 'none'
            });

            toast({
                title: 'Subscription Cancelled',
                description: "We're sorry to see you go. Your subscription has been cancelled.",
            });
            
        } catch (error) {
             console.error(error);
            toast({
                variant: 'destructive',
                title: 'Cancellation Failed',
                description: 'Could not cancel your subscription. Please try again.',
            });
        } finally {
            setIsCancelling(false);
        }
    };
    
    const isLoading = isUserLoading || isTenantLoading;

    if (isLoading) {
        return (
            <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/40 p-4">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    if (tenant && tenant.subscriptionStatus === 'active') {
        return (
             <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/40 p-4">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <CardTitle>Manage Your Subscription</CardTitle>
                        <CardDescription>
                            Thank you for being a Pro member, {user?.displayName || 'user'}!
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Card className="border-primary">
                            <CardHeader>
                                <CardTitle>Pro Plan</CardTitle>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-4xl font-bold">$49</span>
                                    <span className="text-muted-foreground">/ month</span>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">Your subscription is currently active.</p>
                            </CardContent>
                            <CardFooter>
                                <Button variant="destructive" className="w-full" onClick={handleCancelSubscription} disabled={isCancelling}>
                                    {isCancelling ? <Loader className="animate-spin" /> : 'Cancel Subscription'}
                                </Button>
                            </CardFooter>
                        </Card>
                    </CardContent>
                     <CardFooter>
                        <Button variant="outline" className="w-full" asChild>
                            <Link href="/dashboard">Back to Dashboard</Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/40 p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Choose Your Plan</CardTitle>
                    <CardDescription>
                        Welcome, {user?.displayName || 'user'}! Subscribe to unlock your dashboard.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Card className="border-primary ring-2 ring-primary">
                        <CardHeader>
                            <CardTitle>Pro Plan</CardTitle>
                            <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-bold">$49</span>
                                <span className="text-muted-foreground">/ month</span>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Full-featured Dashboard</li>
                                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Client & Service Management</li>
                                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Inventory Tracking</li>
                                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> AI-Powered Insights</li>
                            </ul>
                            <Button className="w-full" onClick={handleSubscribe} disabled={isSubscribing || isLoading}>
                                {isSubscribing ? <Loader className="animate-spin" /> : 'Subscribe to Pro'}
                            </Button>
                        </CardContent>
                    </Card>
                </CardContent>
            </Card>
        </div>
    );
}
