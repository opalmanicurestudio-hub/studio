
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Check, Loader, Award, Sparkles, Zap, ShieldCheck } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { updateDocumentNonBlocking } from '@/firebase';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type SubscriptionTier = 'solo' | 'studio' | 'enterprise';

interface Tier {
    id: SubscriptionTier;
    name: string;
    price: number;
    description: string;
    icon: any;
    color: string;
    features: string[];
}

const tiers: Tier[] = [
    {
        id: 'solo',
        name: 'Solo Practitioner',
        price: 29,
        description: 'Perfect for independent masters managing their own chair.',
        icon: User,
        color: 'border-slate-200',
        features: [
            '1 Master Account',
            'Full Client Dossier',
            'Strategic Planner',
            'Base POS Terminal',
            'Booking Microsite',
            'Unlimited SMS Alerts'
        ]
    },
    {
        id: 'studio',
        name: 'High-Performance Studio',
        price: 79,
        description: 'Complete orchestration for growing teams and studios.',
        icon: Sparkles,
        color: 'border-primary ring-4 ring-primary/10 shadow-2xl',
        features: [
            'Everything in Solo',
            'Unlimited Staff Sync',
            'Automated Turn-Orders',
            'Team Yield Analysis',
            'Unified Payroll Ledger',
            'Marketing Outreach Suite'
        ]
    },
    {
        id: 'enterprise',
        name: 'Enterprise Network',
        price: 199,
        description: 'Scale excellence across multiple locations and brands.',
        icon: ShieldCheck,
        color: 'border-slate-900 bg-slate-900 text-white',
        features: [
            'Everything in Studio',
            'Multi-Location Central',
            'Custom White-Labeling',
            'API Distribution Access',
            'Priority Architecture Support',
            'Quarterly Growth Strategy'
        ]
    }
];

export default function SubscriptionsPage() {
    const { user, firestore, isUserLoading } = useFirebase();
    const router = useRouter();
    const { toast } = useToast();
    const [submittingTier, setSubmittingTier] = useState<SubscriptionTier | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);

    const tenantQuery = useMemoFirebase(() => {
        if (!user || !firestore) return null;
        return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
    }, [user, firestore]);

    const { data: tenants, isLoading: isTenantLoading } = useCollection(tenantQuery);
    const tenant = tenants?.[0];

    const handleSubscribe = async (tierId: SubscriptionTier) => {
        if (!tenant || !firestore) return;

        setSubmittingTier(tierId);
        try {
            const tenantRef = doc(firestore, 'tenants', tenant.id);
            updateDocumentNonBlocking(tenantRef, {
                subscriptionStatus: 'active',
                subscriptionTier: tierId
            });

            toast({
                title: 'Activation Successful!',
                description: `Welcome to the ${tierId.toUpperCase()} tier of ClarityFlow.`,
            });

            router.push('/dashboard');
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Process Failed',
                description: 'Could not finalize your subscription choice.',
            });
        } finally {
            setSubmittingTier(null);
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
                title: 'Access Revoked',
                description: "Your pro features have been disabled.",
            });
            
        } catch (error) {
             console.error(error);
            toast({
                variant: 'destructive',
                title: 'Cancellation Failed',
                description: 'Could not process the revocation request.',
            });
        } finally {
            setIsCancelling(false);
        }
    };
    
    const isLoading = isUserLoading || isTenantLoading;

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <Loader className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const TierCard = ({ tier }: { tier: Tier }) => {
        const isCurrent = tenant?.subscriptionTier === tier.id;
        const isProcessing = submittingTier === tier.id;
        const isEnterprise = tier.id === 'enterprise';

        return (
            <Card className={cn("relative flex flex-col h-full rounded-[2.5rem] border-2 transition-all duration-500", tier.color)}>
                <CardHeader className="p-8 text-center">
                    <div className={cn("mx-auto p-4 rounded-2xl mb-4 shadow-inner", isEnterprise ? "bg-white/10" : "bg-primary/10")}>
                        <tier.icon className={cn("w-8 h-8", isEnterprise ? "text-white" : "text-primary")} />
                    </div>
                    <CardTitle className="text-2xl font-black uppercase tracking-tighter">{tier.name}</CardTitle>
                    <CardDescription className={cn("mt-2", isEnterprise ? "text-slate-400" : "text-slate-500")}>{tier.description}</CardDescription>
                    <div className="flex items-baseline justify-center gap-2 pt-8">
                        <span className="text-6xl font-black tracking-tighter font-mono">${tier.price}</span>
                        <span className={cn("text-[10px] font-black uppercase tracking-widest", isEnterprise ? "text-slate-400" : "text-muted-foreground")}>/ month</span>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 px-8 py-4 space-y-6">
                    <ul className="space-y-4">
                        {tier.features.map((feature, i) => (
                            <li key={i} className="flex items-start gap-3">
                                <Check className={cn("w-4 h-4 mt-0.5 flex-shrink-0", isEnterprise ? "text-primary" : "text-primary")} />
                                <span className={cn("text-xs font-bold uppercase tracking-tight", isEnterprise ? "text-slate-300" : "text-slate-700")}>{feature}</span>
                            </li>
                        ))}
                    </ul>
                </CardContent>
                <CardFooter className="p-8">
                    <Button 
                        className={cn("w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl", isEnterprise ? "bg-primary text-white hover:bg-primary/90" : "")} 
                        onClick={() => handleSubscribe(tier.id)} 
                        disabled={isProcessing || isCurrent || !!submittingTier}
                        variant={isEnterprise ? 'default' : (tier.id === 'studio' ? 'default' : 'outline')}
                    >
                        {isProcessing ? <Loader className="animate-spin h-5 w-5" /> : (isCurrent ? 'Current Plan' : 'Activate Tier')}
                    </Button>
                </CardFooter>
            </Card>
        );
    };

    return (
        <div className="min-h-screen w-full flex flex-col items-center p-4 md:p-10 space-y-12">
             <div className="max-w-2xl text-center space-y-4">
                <div className="inline-flex items-center gap-2 bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10 mb-4">
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Strategic Selection</span>
                </div>
                <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none">Choose Your Architecture</h1>
                <p className="text-lg text-slate-500 font-medium leading-relaxed max-w-xl mx-auto">
                    Select the foundational tier that matches your current studio requirements. Transition between tiers as you scale.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full max-w-7xl">
                {tiers.map(tier => <TierCard key={tier.id} tier={tier} />)}
            </div>

            {tenant?.subscriptionStatus === 'active' && (
                <div className="pt-10">
                    <Button variant="ghost" onClick={handleCancelSubscription} disabled={isCancelling} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-destructive">
                         {isCancelling ? <Loader className="animate-spin mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}
                         Deactivate Current Subscription
                    </Button>
                </div>
            )}
        </div>
    );
}

function User(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
