
'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader, User, ArrowRight, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { motion } from 'framer-motion';
import { type Client } from '@/lib/data';

export default function PortalLoginPage() {
    const { tenantId } = useParams() as { tenantId: string };
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;

        setIsLoading(true);
        try {
            const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
            const q = query(clientsRef, where("email", "==", email.toLowerCase().trim()));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                toast({
                    variant: 'destructive',
                    title: 'Account Not Found',
                    description: "We couldn't find an account with that email. Please check your spelling or sign up on the booking page.",
                });
            } else {
                const clientData = querySnapshot.docs[0].data() as Client;
                if (clientData.status === 'banned') {
                    toast({
                        variant: 'destructive',
                        title: 'Access Denied',
                        description: 'Your studio profile is restricted. Please contact us for assistance.',
                    });
                    return;
                }
                const clientId = querySnapshot.docs[0].id;
                // In a production app, we would send a magic link.
                // For this prototype, we'll redirect directly.
                router.push(`/portal/${tenantId}/${clientId}`);
            }
        } catch (error) {
            console.error("Login error:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to access the portal. Please try again later.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-muted/40">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md"
            >
                <Card className="shadow-xl">
                    <CardHeader className="text-center space-y-2">
                        <div className="flex justify-center mb-4">
                            <ClarityFlowLogo className="w-12 h-12" />
                        </div>
                        <CardTitle className="text-3xl font-bold">Client Portal</CardTitle>
                        <CardDescription>Enter your email to view your appointments and memberships.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="jane@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="h-12"
                                />
                            </div>
                            <Button type="submit" className="w-full h-12 text-lg" disabled={isLoading}>
                                {isLoading ? <Loader className="animate-spin mr-2" /> : <ShieldCheck className="mr-2 h-5 w-5" />}
                                Access Portal
                            </Button>
                        </form>
                    </CardContent>
                    <CardFooter className="justify-center border-t p-6 bg-muted/30 rounded-b-lg">
                        <p className="text-sm text-muted-foreground text-center">
                            Don't have an account yet? <br/>
                            <Button variant="link" asChild className="p-0 h-auto font-semibold">
                                <a href={`/book/${tenantId}`}>Book your first appointment</a>
                            </Button>
                        </p>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    );
}
