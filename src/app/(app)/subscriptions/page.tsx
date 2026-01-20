
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Check, Loader, Award } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { updateDocumentNonBlocking } from '@/firebase';
import Link from 'next/link';

const proFeatures = [
    'Smart Walk-in & Appointment Scheduling',
    'True Minimum Hourly Rate (TMHR) Calculation',
    'Client Management & Custom Formulas',
    'Inventory & Product Costing',
    'Staff Performance & Payroll',
    'AI-Powered Business Insights',
    'Recurring Memberships & Packages',
    'Quotes & Invoicing for Events',
    'Point of Sale (POS) for Retail'
];


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
            <div className="flex h-screen w-full items-center justify-center">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    const ProPlanCard = ({ onSubscribe, isLoading }: { onSubscribe: () => void, isLoading: boolean }) => (
        <Card className="border-2 border-primary shadow-2xl shadow-primary/20 w-full max-w-md">
            <CardHeader className="text-center">
                 <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2">
                    <Award className="w-8 h-8 text-primary" />
                </div>
                <CardTitle className="text-2xl">ClarityFlow Pro</CardTitle>
                <CardDescription>The complete toolkit for solo service professionals.</CardDescription>
                <div className="flex items-baseline justify-center gap-2 pt-4">
                    <span className="text-5xl font-extrabold">$49</span>
                    <span className="text-muted-foreground">/ month</span>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <ul className="space-y-3">
                    {proFeatures.map((feature, i) => (
                        <li key={i} className="flex items-start gap-3">
                            <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                            <span className="text-sm text-muted-foreground">{feature}</span>
                        </li>
                    ))}
                </ul>
            </CardContent>
            <CardFooter>
                 <Button className="w-full" size="lg" onClick={onSubscribe} disabled={isLoading}>
                    {isLoading ? <Loader className="animate-spin" /> : 'Get Started with Pro'}
                </Button>
            </CardFooter>
        </Card>
    );

    if (tenant?.subscriptionStatus === 'active') {
        return (
            <div className="text-center space-y-6">
                <h1 className="text-3xl font-bold">You're already a Pro!</h1>
                <p className="text-muted-foreground">Thank you for being a ClarityFlow Pro member. You have full access to all features.</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Button asChild><Link href="/dashboard">Go to Dashboard</Link></Button>
                    <Button variant="destructive" onClick={handleCancelSubscription} disabled={isCancelling}>
                         {isCancelling ? <Loader className="animate-spin" /> : 'Cancel Subscription'}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full flex flex-col items-center text-center space-y-6">
             <div className="max-w-2xl">
                <h1 className="text-4xl font-extrabold tracking-tight">Unlock Your Full Potential</h1>
                <p className="mt-4 text-lg text-muted-foreground">
                    You're one step away. Choose the Pro plan to get instant access to every tool you need to manage and grow your business.
                </p>
            </div>
            <ProPlanCard onSubscribe={handleSubscribe} isLoading={isSubscribing} />
        </div>
    );
}
