
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
    Coffee, 
    Sparkles, 
    ArrowRight, 
    ArrowLeft, 
    CheckCircle2, 
    Loader, 
    Search, 
    Star, 
    Zap, 
    Smartphone, 
    Headphones, 
    Moon, 
    VolumeX, 
    Ear, 
    SunDim, 
    Gamepad2,
    Users,
    Award,
    MapPin,
    Clock,
    XCircle,
    Heart,
    HandHeart,
    Utensils,
    Wine
} from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, getDocs, startOfDay } from 'firebase/firestore';
import { format, parseISO, isAfter, subMonths, subYears, startOfMonth } from 'date-fns';
import { cn, safeNumber, hexToHSLComponents } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

const ViewContainer = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        className={cn("w-full max-w-5xl mx-auto px-4 z-10", className)}
    >
        <Card className="border-4 rounded-[3rem] md:rounded-[4rem] shadow-[0_32px_64px_rgba(0,0,0,0.1)] overflow-hidden bg-white/90 backdrop-blur-3xl ring-1 ring-white/20">
            {children}
        </Card>
    </motion.div>
);

const MenuCard = ({ 
    item, 
    onSelect, 
    isMember, 
    activeMembership,
    remainingPerks
}: { 
    item: any, 
    onSelect: (qty: number) => void, 
    isMember: boolean,
    activeMembership: any,
    remainingPerks: number
}) => {
    const [qty, setQty] = useState(1);
    const isPerk = activeMembership?.includedProducts?.some((p: any) => p.id === item.id) && remainingPerks > 0;

    const getIcon = (name: string) => {
        const n = name.toLowerCase();
        if (n.includes('charger') || n.includes('power')) return Smartphone;
        if (n.includes('coffee') || n.includes('espresso') || n.includes('latte')) return Coffee;
        if (n.includes('wine') || n.includes('bubbly') || n.includes('champagne')) return Wine;
        if (n.includes('snack') || n.includes('treat')) return Utensils;
        if (n.includes('headphone')) return Headphones;
        return Coffee;
    };

    const Icon = getIcon(item.name);

    return (
        <motion.div whileHover={{ y: -8 }} className="h-full">
            <Card className={cn(
                "rounded-[2.5rem] border-2 h-full flex flex-col overflow-hidden transition-all duration-500",
                isPerk ? "border-primary/30 bg-primary/[0.02]" : "border-border/50 bg-white"
            )}>
                <div className="relative aspect-square bg-muted/20 overflow-hidden border-b flex items-center justify-center">
                    {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.name} fill className="object-cover transition-transform duration-700 hover:scale-110" />
                    ) : (
                        <Icon className="w-16 h-16 text-primary opacity-20" />
                    )}
                    <div className="absolute top-4 left-4 flex flex-col gap-2">
                        {item.isMembersOnly && <Badge className="bg-indigo-600 text-white border-none font-black text-[8px] uppercase tracking-widest h-6 px-3">Club Exclusive</Badge>}
                        {isPerk && <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase tracking-widest h-6 px-3 shadow-lg"><Star className="w-3 h-3 mr-1 fill-current"/> Member Perk</Badge>}
                    </div>
                    <div className="absolute bottom-4 right-4">
                        <div className="bg-white/90 backdrop-blur-md rounded-2xl p-2 px-4 shadow-xl border border-white/50">
                            <p className="text-sm font-black text-slate-900 font-mono">
                                {isPerk ? 'INCLUDED' : safeNumber(item.price) > 0 ? `$${safeNumber(item.price).toFixed(2)}` : 'COMP'}
                            </p>
                        </div>
                    </div>
                </div>
                <CardContent className="p-6 space-y-4 flex-1 flex flex-col justify-between text-left">
                    <div className="space-y-1.5">
                        <h4 className="font-black text-lg uppercase tracking-tight text-slate-900 leading-tight">{item.name}</h4>
                        {item.description && <p className="text-xs font-medium text-slate-500 italic leading-relaxed">"{item.description}"</p>}
                    </div>
                    <div className="pt-4 border-t border-dashed flex items-center justify-between">
                        <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-1 px-3 border shadow-inner">
                            <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-1 hover:text-primary transition-all"><XCircle className="w-4 h-4 rotate-45" /></button>
                            <span className="font-black font-mono text-base w-6 text-center">{qty}</span>
                            <button onClick={() => setQty(qty + 1)} className="p-1 hover:text-primary transition-all"><PlusCircle className="w-4 h-4" /></button>
                        </div>
                        <Button onClick={() => onSelect(qty)} className="h-10 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">Request</Button>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
};

export default function ConciergeKioskPage() {
    const { tenantId } = useParams() as { tenantId: string };
    const { firestore } = useFirebase();
    const { toast } = useToast();

    const [entered, setEntered] = useState(false);
    const [step, setStep] = useState<'identity' | 'menu' | 'success'>('identity');
    const [guestName, setGuestName] = useState('');
    const [guestPhone, setGuestPhone] = useState('');
    const [identifiedClient, setIdentifiedClient] = useState<Client | null>(null);
    const [isVerifying, setIsVerifying] = useState(false);

    // --- DATA ---
    const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant } = useDoc<Tenant>(tenantRef);

    const inventoryQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/inventory`), [firestore, tenantId]);
    const { data: inventory } = useCollection<InventoryItem>(inventoryQuery);

    const membershipsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const refreshments = useMemo(() => 
        (inventory || []).filter(i => 
            i.type === 'refreshment' && 
            i.showInConcierge !== false && 
            i.totalStock > 0 && 
            (!i.isMembersOnly || !!identifiedClient?.activeMembershipId)
        )
    , [inventory, identifiedClient]);

    const activeMembership = useMemo(() => {
        if (!identifiedClient?.activeMembershipId || !memberships) return null;
        return memberships.find(m => m.id === identifiedClient.activeMembershipId);
    }, [identifiedClient, memberships]);

    // --- ACTIONS ---
    const handleIdentify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!guestName.trim()) return;

        if (guestPhone.length >= 10) {
            setIsVerifying(true);
            try {
                const clientsRef = collection(firestore, `tenants/${tenantId}/clients`);
                const q = query(clientsRef, where("phone", "==", guestPhone));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const c = snap.docs[0].data() as Client;
                    setIdentifiedClient({ ...c, id: snap.docs[0].id });
                    setGuestName(c.name);
                    toast({ title: `Welcome back, ${c.name.split(' ')[0]}` });
                }
            } catch (err) { console.error(err); }
            finally { setIsVerifying(false); }
        }
        setStep('menu');
    };

    const handleRequest = async (item: InventoryItem, qty: number) => {
        if (!firestore || !tenant) return;
        
        try {
            const requestId = nanoid();
            await setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/refreshmentRequests`, requestId), {
                id: requestId,
                tenantId: tenantId,
                clientId: identifiedClient?.id || 'guest-walkin',
                clientName: guestName,
                itemId: item.id,
                itemName: item.name,
                quantity: qty,
                status: 'pending',
                requestedAt: new Date().toISOString(),
                stationName: 'Lounge / Waiting Area',
                priceAtRequest: safeNumber(item.price),
                isGuestKiosk: true
            }, {});
            
            toast({ title: "Order Dispatched", description: "Our concierge will be with you shortly." });
            setStep('success');
        } catch (e) {
            toast({ variant: 'destructive', title: "Request Failed" });
        }
    };

    const customPrimaryColor = tenant?.kioskSettings?.primaryColor;
    const primaryColorHSL = customPrimaryColor && customPrimaryColor.startsWith('#') 
      ? hexToHSLComponents(customPrimaryColor) 
      : customPrimaryColor;

    return (
        <div 
            className="min-h-screen bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-blue-50 via-white to-purple-50 text-foreground flex flex-col items-center justify-center p-4 overflow-x-hidden font-body relative"
            style={primaryColorHSL ? { '--primary': primaryColorHSL } as React.CSSProperties : {}}
        >
            {/* ATMOSPHERIC BACKGROUND */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
            </div>

            <AnimatePresence mode="wait">
                {!entered ? (
                    <motion.div 
                        key="entry" 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0, scale: 1.1 }}
                        className="text-center cursor-pointer p-4 group z-10" 
                        onClick={() => setEntered(true)}
                    >
                        <div className="relative w-48 h-48 md:w-64 md:h-64 rounded-[3rem] md:rounded-[4rem] overflow-hidden mb-12 transition-all duration-1000 mx-auto shadow-2xl border-4 border-white bg-white/40 backdrop-blur-3xl p-8 flex items-center justify-center group-hover:shadow-primary/20 group-hover:border-primary/20">
                            {tenant?.kioskSettings?.logoUrl ? (
                                <Image src={tenant.kioskSettings.logoUrl} alt={tenant.name} fill className="object-cover" />
                            ) : (
                                <ClarityFlowLogo className="w-24 h-24 md:w-32 md:h-32" />
                            )}
                        </div>
                        <div className="space-y-4">
                            <h1 className="text-4xl md:text-7xl font-black tracking-tighter uppercase text-slate-900 leading-none">{tenant?.name || 'Studio'}</h1>
                            <p className="text-primary text-xs md:text-xl font-bold tracking-[0.5em] uppercase animate-pulse opacity-60">Concierge Active</p>
                        </div>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-16 flex flex-col items-center gap-4">
                            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Tap to Browse Menu</span>
                            <ArrowDown className="w-6 h-6 animate-bounce text-slate-300" />
                        </motion.div>
                    </motion.div>
                ) : (
                    <ViewContainer key="main">
                        <AnimatePresence mode="wait">
                            {step === 'identity' && (
                                <motion.div 
                                    key="identity" 
                                    initial={{ opacity: 0, x: 20 }} 
                                    animate={{ opacity: 1, x: 0 }} 
                                    exit={{ opacity: 0, x: -20 }}
                                    className="p-10 md:p-20 space-y-12"
                                >
                                    <div className="space-y-3 text-center">
                                        <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                                            <HandHandHeart className="w-10 h-10 text-primary" />
                                        </div>
                                        <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900">Welcome to the Lounge</h2>
                                        <p className="text-sm md:text-lg font-bold text-muted-foreground uppercase tracking-widest opacity-60">Please identify yourself to begin your experience.</p>
                                    </div>

                                    <form onSubmit={handleIdentify} className="max-w-md mx-auto space-y-8">
                                        <div className="space-y-4 text-left">
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Your Full Name</Label>
                                                <Input 
                                                    autoFocus
                                                    value={guestName}
                                                    onChange={e => setGuestName(e.target.value)}
                                                    placeholder="ENTER NAME"
                                                    className="h-16 rounded-2xl border-4 font-black uppercase text-xl md:text-2xl tracking-tight shadow-inner focus-visible:ring-primary/20 text-center"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mobile Number (Optional Perk Check)</Label>
                                                <Input 
                                                    type="tel"
                                                    value={guestPhone}
                                                    onChange={e => setGuestPhone(e.target.value.replace(/\D/g, ''))}
                                                    placeholder="555-000-0000"
                                                    className="h-14 rounded-2xl border-2 font-black text-lg text-center"
                                                />
                                            </div>
                                        </div>
                                        <Button 
                                            type="submit" 
                                            disabled={!guestName.trim() || isVerifying}
                                            className="w-full h-20 rounded-[2.5rem] text-xl font-black uppercase shadow-3xl shadow-primary/30 group"
                                        >
                                            {isVerifying ? <Loader className="animate-spin" /> : <>Explore Menu <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-2"/></>}
                                        </Button>
                                    </form>
                                </motion.div>
                            )}

                            {step === 'menu' && (
                                <motion.div 
                                    key="menu" 
                                    initial={{ opacity: 0 }} 
                                    animate={{ opacity: 1 }} 
                                    className="flex flex-col h-[85dvh]"
                                >
                                    <div className="p-8 pb-4 border-b bg-muted/5 flex flex-col sm:flex-row items-center justify-between gap-6 text-left">
                                        <div className="flex items-center gap-4 text-left">
                                            <Avatar className="h-14 w-14 border-4 border-white shadow-xl rounded-[1.5rem]">
                                                <AvatarFallback className="font-black text-xl bg-primary/10 text-primary">{(guestName || 'G')[0]}</AvatarFallback>
                                            </Avatar>
                                            <div className="text-left">
                                                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Boutique Concierge</h3>
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 mt-1.5">Table service available throughout the lounge</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {identifiedClient && <Badge className="bg-indigo-600 text-white border-none font-black text-[9px] h-8 px-4 rounded-xl uppercase tracking-widest shadow-lg"><Star className="w-3 h-3 mr-2 fill-current"/> Club Member</Badge>}
                                            <Button variant="ghost" size="sm" onClick={() => setStep('identity')} className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-slate-400">Not {guestName.split(' ')[0]}?</Button>
                                        </div>
                                    </div>

                                    <ScrollArea className="flex-1">
                                        <div className="p-8 space-y-12">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                                                {refreshments.map(item => (
                                                    <MenuCard 
                                                        key={item.id} 
                                                        item={item} 
                                                        onSelect={(qty) => handleRequest(item, qty)}
                                                        isMember={!!identifiedClient?.activeMembershipId}
                                                        activeMembership={activeMembership}
                                                        remainingPerks={10} // Simple placeholder for now
                                                    />
                                                ))}
                                            </div>
                                            {refreshments.length === 0 && (
                                                <div className="py-32 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                                    <Clock className="w-16 h-16" />
                                                    <p className="text-xl font-black uppercase tracking-widest">Menu Buffering...</p>
                                                </div>
                                            )}
                                        </div>
                                    </ScrollArea>
                                </motion.div>
                            )}

                            {step === 'success' && (
                                <motion.div 
                                    key="success" 
                                    initial={{ opacity: 0, scale: 0.95 }} 
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="p-12 md:p-24 text-center space-y-10"
                                >
                                    <div className="w-32 h-32 md:w-48 md:h-48 bg-green-500/10 rounded-[3rem] flex items-center justify-center mx-auto shadow-2xl rotate-6">
                                        <CheckCircle2 className="w-16 h-16 md:w-24 md:h-24 text-green-500 -rotate-6" />
                                    </div>
                                    <div className="space-y-4">
                                        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-slate-900">Request Dispatched</h2>
                                        <p className="text-sm md:text-xl font-medium text-slate-500 leading-relaxed uppercase tracking-widest opacity-80 px-10">
                                            Our studio team has been notified. Please make yourself comfortable, we will be with you shortly.
                                        </p>
                                    </div>
                                    <Button 
                                        size="lg" 
                                        onClick={() => setStep('menu')}
                                        className="h-16 md:h-20 px-12 md:px-20 rounded-[2rem] text-lg md:text-xl font-black uppercase shadow-3xl shadow-primary/30 active:scale-95 transition-all"
                                    >
                                        Order More
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </ViewContainer>
                )}
            </AnimatePresence>

            <footer className="fixed bottom-8 left-0 right-0 z-20 px-8 flex justify-center pointer-events-none">
                <div className="bg-white/40 backdrop-blur-xl border-2 border-white/50 px-6 py-3 rounded-full shadow-2xl flex items-center gap-6 pointer-events-auto">
                    <div className="flex items-center gap-2">
                        <MapPin className="w-3 h-3 text-primary opacity-40" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">{tenant?.name}</span>
                    </div>
                    <Separator orientation="vertical" className="h-4 bg-slate-900/10" />
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.3em]">Boutique Experience Portal</p>
                </div>
            </footer>
        </div>
    );
}

function HandHandHeart(props: any) {
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
      <path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16" />
      <path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-5.4a2 2 0 0 0-3-2.8L15 12" />
      <path d="M12 5H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" />
    </svg>
  );
}
