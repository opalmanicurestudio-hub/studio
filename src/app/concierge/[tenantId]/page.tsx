
'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
    Wine,
    ArrowDown,
    PlusCircle,
    ShieldCheck,
    CreditCard,
    Lock,
    Info,
    Check,
    User,
    Delete,
    Minus,
    Plus
} from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, getDocs, writeBatch } from 'firebase/firestore';
import { cn, safeNumber, hexToHSLComponents } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Separator } from '@/components/ui/separator';
import { type Client, type InventoryItem, type Membership, type Tenant } from '@/lib/data';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        try {
            return new Date(val);
        } catch {
            return new Date();
        }
    }
    return new Date(val);
};

const FloatingContainer = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <motion.div 
        initial={{ opacity: 0, y: 30 }} 
        animate={{ opacity: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95 }}
        className={cn("w-full max-w-4xl mx-auto px-6 z-10", className)}
    >
        {children}
    </motion.div>
);

const PhonePadView = ({ value, onDigit, onDelete, onConfirm, onBack, isVerifying }: any) => {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];
    
    const formattedDisplay = useMemo(() => {
        const cleaned = value.replace(/\D/g, '');
        if (!cleaned) return '';
        if (cleaned.length <= 3) return `( ${cleaned} )`;
        if (cleaned.length <= 6) return `( ${cleaned.slice(0, 3)} )  ${cleaned.slice(3)}`;
        return `( ${cleaned.slice(0, 3)} )  ${cleaned.slice(3, 6)} - ${cleaned.slice(6)}`;
    }, [value]);

    return (
        <FloatingContainer className="max-w-md text-center space-y-10 py-12">
            <div className="space-y-3 text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                    <ShieldCheck className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 text-center">Recognize Perks</h2>
                <p className="text-sm md:text-lg font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-center">Enter your mobile signature to unlock club benefits.</p>
            </div>

            <div className="p-8 rounded-[2.5rem] bg-white/60 backdrop-blur-xl border-2 border-white/50 shadow-inner text-center">
                <p className="text-2xl md:text-4xl font-black font-mono tracking-widest text-primary leading-none min-h-[1.2em]">
                    {formattedDisplay || '\u00A0'}
                </p>
            </div>

            <div className="grid grid-cols-3 gap-4 max-w-[320px] mx-auto">
                {digits.map((d, i) => {
                    if (d === '') return <div key={i} />;
                    if (d === 'delete') {
                        return (
                            <motion.button 
                                key={i} 
                                whileTap={{ scale: 0.9 }}
                                onClick={onDelete}
                                className="h-16 w-16 md:h-20 md:w-20 rounded-full flex items-center justify-center text-slate-400 hover:text-destructive transition-all"
                            >
                                <Delete className="w-6 h-6 md:w-8 md:h-8" strokeWidth={1.5} />
                            </motion.button>
                        );
                    }
                    return (
                        <motion.button 
                            key={i} 
                            whileTap={{ scale: 0.95 }}
                            onClick={() => onDigit(d)}
                            className="h-16 w-16 md:h-20 md:w-20 rounded-2xl bg-white/40 backdrop-blur-3xl border-2 border-white/20 text-2xl md:text-3xl font-light text-slate-800 shadow-sm hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center"
                        >
                            {d}
                        </motion.button>
                    );
                })}
            </div>

            <div className="space-y-4 pt-4 text-center">
                <Button 
                    size="lg" 
                    onClick={onConfirm} 
                    disabled={value.length < 10 || isVerifying}
                    className="w-full h-20 rounded-[2.5rem] text-xl font-black uppercase shadow-3xl shadow-primary/30 group mx-auto"
                >
                    {isVerifying ? <Loader className="animate-spin" /> : <>Verify Identity <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" /></>}
                </Button>
                <Button variant="ghost" onClick={onBack} className="w-full text-slate-400 font-bold uppercase tracking-widest text-[10px] md:text-xs">Continue as Guest</Button>
            </div>
        </FloatingContainer>
    );
};

const FloatingMenuCard = ({ 
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
        <motion.div 
            whileTap={{ scale: 0.98 }}
            className="group relative shrink-0 w-[200px] md:w-72"
        >
            <div className={cn(
                "rounded-[2.5rem] md:rounded-[3rem] p-4 md:p-6 flex flex-col gap-4 md:gap-6 transition-all duration-700 h-full",
                isPerk ? "bg-indigo-600/10 border-2 border-indigo-500/20 shadow-[0_20px_50px_rgba(79,70,229,0.15)]" : "bg-white/40 backdrop-blur-2xl border-2 border-white/50 shadow-2xl hover:bg-white/60 hover:border-primary/20"
            )}>
                <div className="relative aspect-square w-full rounded-[2rem] md:rounded-[2.5rem] overflow-hidden bg-muted/20 flex items-center justify-center group-hover:shadow-2xl transition-all duration-700">
                    {item.imageUrl ? (
                        <div className="relative w-full h-full">
                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover transition-transform duration-1000 group-hover:scale-110" />
                        </div>
                    ) : (
                        <Icon className="w-10 h-10 md:w-16 md:h-16 text-primary opacity-20" />
                    )}
                    
                    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                        {item.isMembersOnly && <Badge className="bg-indigo-600 text-white border-none font-black text-[7px] md:text-[8px] uppercase tracking-widest h-5 md:h-6 px-2 md:px-3 shadow-xl">Club Only</Badge>}
                        {isPerk && <Badge className="bg-primary text-white border-none font-black text-[7px] md:text-[8px] uppercase tracking-widest h-5 md:h-6 px-2 md:px-3 shadow-xl animate-pulse"><Star className="w-2.5 h-2.5 md:w-3 md:h-3 mr-1 fill-current"/> Perk</Badge>}
                    </div>

                    <div className="absolute bottom-3 right-3">
                        <div className="bg-white/90 backdrop-blur-md rounded-xl md:rounded-2xl p-1.5 px-3 md:p-2 md:px-4 shadow-xl border border-white/50">
                            <p className="text-[10px] md:text-sm font-black text-slate-900 font-mono tracking-tighter">
                                {isPerk ? 'INCLUDED' : safeNumber(item.price) > 0 ? `$${safeNumber(item.price).toFixed(2)}` : 'COMP'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-3 md:space-y-4 px-1 md:px-2 flex-1 flex flex-col justify-between">
                    <div className="space-y-1 text-left">
                        <h4 className="font-black text-xs md:text-xl uppercase tracking-tighter text-slate-900 leading-tight truncate">{item.name}</h4>
                        {item.description && <p className="text-[10px] md:text-xs font-medium text-slate-500 italic leading-relaxed opacity-80 line-clamp-2">"{item.description}"</p>}
                    </div>

                    <div className="pt-3 md:pt-4 border-t border-dashed border-slate-900/10 flex items-center justify-between mt-auto">
                        <div className="flex items-center gap-1.5 md:gap-2 bg-white/40 backdrop-blur-xl rounded-lg md:rounded-xl p-1 px-2 border border-white/50 shadow-sm h-8 md:h-10">
                            <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-1 hover:text-primary transition-all active:scale-75"><Minus className="w-3 h-3 md:w-4 md:h-4" /></button>
                            <span className="font-black font-mono text-xs md:text-base w-4 md:w-6 text-center">{qty}</span>
                            <button onClick={() => setQty(qty + 1)} className="p-1 hover:text-primary transition-all active:scale-75"><Plus className="w-3 h-3 md:w-4 md:h-4" /></button>
                        </div>
                        <Button 
                            onClick={() => onSelect(qty)}
                            className="h-8 md:h-12 px-4 md:px-8 rounded-lg md:rounded-2xl font-black uppercase text-[8px] md:text-[10px] tracking-[0.2em] shadow-xl shadow-primary/20 active:scale-95 transition-all"
                        >
                            Request
                        </Button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default function ConciergeKioskPage() {
    const { tenantId } = useParams() as { tenantId: string };
    const { firestore } = useFirebase();
    const { toast } = useToast();

    const [entered, setEntered] = useState(false);
    const [step, setStep] = useState<'onboarding' | 'identity' | 'phone_pad' | 'menu' | 'payment' | 'success'>('onboarding');
    const [guestName, setGuestName] = useState('');
    const [phonePadValue, setPhonePadValue] = useState('');
    const [identifiedClient, setIdentifiedClient] = useState<Client | null>(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [pendingItem, setPendingItem] = useState<{item: InventoryItem, qty: number} | null>(null);

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

    const refreshmentsByCategory = useMemo(() => {
        const grouped: Record<string, InventoryItem[]> = {};
        refreshments.forEach(item => {
            const cat = item.category || 'Curated Selection';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });
        return grouped;
    }, [refreshments]);

    const activeMembership = useMemo(() => {
        if (!identifiedClient?.activeMembershipId || !memberships) return null;
        return memberships.find(m => m.id === identifiedClient.activeMembershipId);
    }, [identifiedClient, memberships]);

    useEffect(() => {
        const isFirstTime = !localStorage.getItem('clarity_concierge_onboarded');
        if (!isFirstTime) {
            setStep('identity');
        }
    }, []);

    const handleOnboardingComplete = () => {
        localStorage.setItem('clarity_concierge_onboarded', 'true');
        setStep('identity');
    };

    const handleIdentitySubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!guestName.trim()) return;
        setStep('menu');
    };

    const handlePhonePadDigit = (digit: string) => {
        if (phonePadValue.length < 10) setPhonePadValue(prev => prev + digit);
    };

    const handlePhonePadDelete = () => {
        setPhonePadValue(prev => prev.slice(0, -1));
    };

    const handlePhonePadConfirm = async () => {
        if (phonePadValue.length < 10) return;
        setIsVerifying(true);
        try {
            const clientsRef = collection(firestore, `tenants/${tenantId}/clients`);
            const q = query(clientsRef, where("phone", "==", `+1${phonePadValue}`));
            const snap = await getDocs(q);
            if (!snap.empty) {
                const c = snap.docs[0].data() as Client;
                setIdentifiedClient({ ...c, id: snap.docs[0].id });
                setGuestName(c.name);
                toast({ title: `Identity Verified`, description: `Welcome, ${c.name.split(' ')[0]}. perks unlocked.` });
                setStep('menu');
            } else {
                toast({ variant: 'destructive', title: 'Profile Not Found', description: "No record found with that mobile signature." });
            }
        } catch (err) { 
            console.error(err); 
            toast({ variant: 'destructive', title: 'Connection Error' });
        } finally { 
            setIsVerifying(false); 
        }
    };

    const handleRequest = async (item: InventoryItem, qty: number) => {
        const isPerk = activeMembership?.includedProducts?.some((p: any) => p.id === item.id);
        const price = safeNumber(item.price);

        if (price > 0 && !isPerk) {
            setPendingItem({ item, qty });
            setStep('payment');
            return;
        }

        finalizeRequest(item, qty);
    };

    const finalizeRequest = async (item: InventoryItem, qty: number) => {
        if (!firestore || !tenant) return;
        setIsVerifying(true);
        try {
            const requestId = nanoid();
            const batch = writeBatch(firestore);
            
            const reqRef = doc(firestore, `tenants/${tenantId}/refreshmentRequests`, requestId);
            batch.set(reqRef, {
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
            });

            if (safeNumber(item.price) > 0 && !activeMembership?.includedProducts?.some((p: any) => p.id === item.id)) {
                const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                batch.set(txnRef, {
                    id: txnRef.id,
                    date: new Date().toISOString(),
                    description: `Lounge Sale: ${item.name} (x${qty})`,
                    clientOrVendor: guestName,
                    clientId: identifiedClient?.id || 'guest-walkin',
                    type: 'income',
                    context: 'Business',
                    category: 'Hospitality Revenue',
                    amount: safeNumber(item.price) * qty,
                    paymentMethod: 'Kiosk Terminal',
                    hasReceipt: false,
                    tenantId
                });
            }

            await batch.commit();
            toast({ title: "Order Dispatched", description: "Our concierge will be with you shortly." });
            setStep('success');
        } catch (e) {
            toast({ variant: 'destructive', title: "Request Failed" });
        } finally {
            setIsVerifying(false);
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
                            <h1 className="text-4xl md:text-7xl font-black tracking-tighter uppercase text-slate-900 leading-none text-center">{tenant?.name || 'Studio'}</h1>
                            <p className="text-primary text-xs md:text-xl font-bold tracking-[0.5em] uppercase animate-pulse opacity-60 text-center">Concierge Active</p>
                        </div>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-16 flex flex-col items-center gap-4 text-center">
                            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Tap to Browse Menu</span>
                            <ArrowDown className="w-6 h-6 animate-bounce text-slate-300" />
                        </motion.div>
                    </motion.div>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center min-h-[80vh] z-10 text-center">
                        <AnimatePresence mode="wait">
                            {step === 'onboarding' && (
                                <FloatingContainer key="onboarding" className="text-center space-y-12">
                                    <div className="space-y-4 text-center">
                                        <div className="w-20 h-20 md:w-24 md:h-24 bg-primary/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl border-2 border-primary/10 rotate-6">
                                            <Sparkles className="w-10 h-10 md:w-12 md:h-12 text-primary -rotate-6" />
                                        </div>
                                        <h2 className="text-3xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none text-center">Your Boutique Experience</h2>
                                        <p className="text-[10px] md:text-xl font-bold text-muted-foreground uppercase tracking-[0.3em] opacity-60 text-center">How the protocol works</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center max-w-3xl mx-auto">
                                        {[
                                            { icon: User, label: "Identify", desc: "Share your name so we can recognize you." },
                                            { icon: Coffee, label: "Select", desc: "Browse our curated artisanal menu." },
                                            { icon: HandHeart, label: "Relax", desc: "We deliver directly to your lounge seat." },
                                        ].map((item, idx) => (
                                            <div key={idx} className="p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] bg-white/60 backdrop-blur-xl border-2 border-white shadow-xl flex flex-col items-center gap-4 text-center">
                                                <div className="p-3 md:p-4 bg-primary/5 rounded-2xl text-primary"><item.icon className="w-6 h-6 md:w-8 md:h-8" /></div>
                                                <div className="space-y-1 text-center">
                                                    <p className="font-black uppercase text-[10px] md:text-sm tracking-tight text-center">{item.label}</p>
                                                    <p className="text-[8px] md:text-[10px] font-medium text-slate-500 uppercase leading-relaxed text-center">{item.desc}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <Button 
                                        size="lg" 
                                        onClick={handleOnboardingComplete}
                                        className="h-16 md:h-20 px-8 md:px-20 rounded-[2rem] md:rounded-[2.5rem] text-sm md:text-xl font-black uppercase shadow-3xl shadow-primary/30 group mx-auto"
                                    >
                                        Begin Experience <ArrowRight className="ml-3 w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:translate-x-2" />
                                    </Button>
                                </FloatingContainer>
                            )}

                            {step === 'identity' && (
                                <FloatingContainer key="identity" className="text-center space-y-12">
                                    <div className="space-y-3 text-center">
                                        <div className="w-16 h-16 md:w-20 md:h-20 bg-primary/10 rounded-[1.5rem] md:rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                                            <HandHeart className="w-8 h-8 md:w-10 md:h-10 text-primary" />
                                        </div>
                                        <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 text-center leading-none">Welcome</h2>
                                        <p className="text-[10px] md:text-lg font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-center">Please identify yourself to begin.</p>
                                    </div>

                                    <form onSubmit={handleIdentitySubmit} className="max-w-md mx-auto space-y-8 text-center">
                                        <div className="space-y-2 text-left">
                                            <Label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary ml-1">Your Full Name</Label>
                                            <Input 
                                                autoFocus
                                                value={guestName}
                                                onChange={e => setGuestName(e.target.value)}
                                                placeholder="ENTER NAME"
                                                className="h-14 md:h-16 rounded-2xl border-2 md:border-4 font-black uppercase text-lg md:text-2xl tracking-tight shadow-inner focus-visible:ring-primary/20 text-center bg-white/80"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-4">
                                            <Button 
                                                type="submit" 
                                                disabled={!guestName.trim() || isVerifying}
                                                className="w-full h-16 md:h-20 rounded-[2rem] text-sm md:text-xl font-black uppercase shadow-3xl shadow-primary/30 group mx-auto"
                                            >
                                                Explore Menu <ArrowRight className="ml-3 w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:translate-x-2"/>
                                            </Button>
                                            <Button 
                                                type="button"
                                                variant="ghost"
                                                onClick={() => setStep('phone_pad')}
                                                className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
                                            >
                                                Recognize My Perks (Member)
                                            </Button>
                                        </div>
                                    </form>
                                </FloatingContainer>
                            )}

                            {step === 'phone_pad' && (
                                <PhonePadView 
                                    key="phone_pad"
                                    value={phonePadValue}
                                    onDigit={handlePhonePadDigit}
                                    onDelete={handlePhonePadDelete}
                                    onConfirm={handlePhonePadConfirm}
                                    onBack={() => setStep('identity')}
                                    isVerifying={isVerifying}
                                />
                            )}

                            {step === 'menu' && (
                                <motion.div 
                                    key="menu" 
                                    initial={{ opacity: 0 }} 
                                    animate={{ opacity: 1 }} 
                                    className="w-full max-w-6xl mx-auto flex flex-col gap-8 md:gap-12"
                                >
                                    <div className="flex flex-row items-center justify-between gap-4 px-6 md:px-12">
                                        <div className="flex items-center gap-4 text-left">
                                            <div className="relative">
                                                <Avatar className="h-14 w-14 md:h-24 md:w-24 border-2 md:border-4 border-white shadow-xl rounded-[1.5rem] md:rounded-[3rem]">
                                                    <AvatarFallback className="font-black text-lg md:text-3xl bg-primary/10 text-primary">{(guestName || 'G')[0]}</AvatarFallback>
                                                </Avatar>
                                                {identifiedClient && <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-1 rounded-xl shadow-lg border-2 border-white"><Award className="w-3 h-3 md:w-5 md:h-5" /></div>}
                                            </div>
                                            <div className="space-y-0.5">
                                                <h3 className="text-xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">Boutique Menu</h3>
                                                <p className="text-[8px] md:text-xs font-bold text-muted-foreground uppercase tracking-[0.25em] opacity-60 text-left">Curated for {guestName.split(' ')[0]}</p>
                                            </div>
                                        </div>
                                        <Button variant="ghost" onClick={() => setStep('identity')} className="h-10 md:h-12 rounded-xl font-black uppercase text-[8px] md:text-[10px] tracking-widest text-slate-400 hover:text-primary">Change Guest</Button>
                                    </div>

                                    <div className="space-y-12 md:space-y-20 pb-20">
                                        {Object.entries(refreshmentsByCategory).map(([category, items]) => (
                                            <section key={category} className="space-y-4 md:space-y-8">
                                                <div className="px-6 md:px-12">
                                                    <h4 className="text-[10px] md:text-sm font-black uppercase tracking-[0.4em] text-primary/60 text-left">{category}</h4>
                                                </div>
                                                <ScrollArea className="w-full">
                                                    <div className="flex gap-4 md:gap-8 px-6 md:px-12 pb-6">
                                                        {items.map(item => (
                                                            <FloatingMenuCard 
                                                                key={item.id} 
                                                                item={item} 
                                                                onSelect={(qty) => handleRequest(item, qty)}
                                                                isMember={!!identifiedClient}
                                                                activeMembership={activeMembership}
                                                                remainingPerks={identifiedClient ? 10 : 0} 
                                                            />
                                                        ))}
                                                    </div>
                                                    <ScrollBar orientation="horizontal" className="hidden" />
                                                </ScrollArea>
                                            </section>
                                        ))}
                                        {refreshments.length === 0 && (
                                            <div className="py-32 text-center border-4 border-dashed border-slate-900/10 rounded-[4rem] opacity-30 flex flex-col items-center gap-4 mx-6">
                                                <Coffee className="w-16 h-16" />
                                                <p className="text-xl font-black uppercase tracking-widest">Menu is currently offline</p>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {step === 'payment' && pendingItem && (
                                <FloatingContainer key="payment" className="max-w-md text-center">
                                    <div className="rounded-[3rem] border-4 border-white bg-white/60 backdrop-blur-3xl shadow-3xl overflow-hidden text-center">
                                        <div className="p-8 md:p-10 border-b border-slate-900/5 bg-muted/5 text-center space-y-4">
                                            <div className="p-3 md:p-4 bg-primary/10 rounded-full w-fit mx-auto">
                                                <CreditCard className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                                            </div>
                                            <div className="space-y-1">
                                                <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter leading-none">Secure Settlement</h2>
                                                <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest opacity-60">Authorize: {pendingItem.item.name} (x{pendingItem.qty})</p>
                                            </div>
                                        </div>
                                        <div className="p-8 md:p-10 space-y-10">
                                            <div className="p-6 md:p-8 rounded-[2.5rem] bg-primary/5 border-4 border-primary/10 text-center space-y-2 shadow-inner">
                                                <p className="text-[9px] md:text-[10px] font-black uppercase text-primary/60 tracking-[0.3em]">Transaction Total</p>
                                                <p className="text-4xl md:text-6xl font-black text-primary tracking-tighter font-mono">${(safeNumber(pendingItem.item.price) * pendingItem.qty).toFixed(2)}</p>
                                            </div>

                                            <div className="space-y-6 text-left">
                                                <div className="space-y-2 text-left"><Label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner bg-white/80" /></div>
                                                <div className="grid grid-cols-2 gap-4"><div className="space-y-2 text-left"><Label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center bg-white/80" /></div><div className="space-y-2 text-left"><Label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center bg-white/80" /></div></div>
                                            </div>
                                            
                                            <div className="flex items-center justify-center gap-3 opacity-40 pt-4">
                                                <Lock className="w-4 h-4"/><span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest">Encrypted Secure Tunnel</span>
                                            </div>
                                        </div>
                                        <div className="p-8 md:p-10 pt-0 flex flex-col gap-3">
                                            <Button onClick={() => finalizeRequest(pendingItem.item, pendingItem.qty)} disabled={isVerifying} className="w-full h-16 md:h-20 rounded-[2rem] md:rounded-[2.5rem] text-sm md:text-xl font-black uppercase shadow-3xl shadow-primary/30 active:scale-95 transition-all">
                                                {isVerifying ? <Loader className="animate-spin h-6 w-6" /> : 'Authorize Payment'}
                                            </Button>
                                            <Button variant="ghost" onClick={() => setStep('menu')} className="w-full font-black uppercase text-[9px] md:text-[10px] tracking-widest text-slate-400">Abort Protocol</Button>
                                        </div>
                                    </div>
                                </FloatingContainer>
                            )}

                            {step === 'success' && (
                                <FloatingContainer key="success" className="p-8 md:p-24 text-center space-y-12 mx-auto">
                                    <div className="w-24 h-24 md:w-48 md:h-48 bg-green-500/10 rounded-[3rem] md:rounded-[4rem] flex items-center justify-center mx-auto shadow-2xl rotate-6">
                                        <CheckCircle2 className="w-12 h-12 md:w-24 md:h-24 text-green-500 -rotate-6" />
                                    </div>
                                    <div className="space-y-4 text-center">
                                        <h2 className="text-3xl md:text-7xl font-black uppercase tracking-tighter text-slate-900 leading-none">Request Dispatched</h2>
                                        <p className="text-xs md:text-2xl font-medium text-slate-500 leading-relaxed uppercase tracking-tight opacity-80 px-6 md:px-10">
                                            Preparing your selection now. Please relax, we will be with you shortly.
                                        </p>
                                    </div>
                                    <Button 
                                        size="lg" 
                                        onClick={() => setStep('menu')}
                                        className="h-16 md:h-20 px-8 md:px-24 rounded-[2rem] md:rounded-[2.5rem] text-sm md:text-xl font-black uppercase shadow-3xl shadow-primary/30 active:scale-95 transition-all mx-auto"
                                    >
                                        Complete Experience
                                    </Button>
                                </FloatingContainer>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </AnimatePresence>

            {entered && step !== 'onboarding' && (
                <footer className="fixed bottom-6 md:bottom-8 left-0 right-0 z-20 px-6 flex justify-center pointer-events-none">
                    <div className="bg-white/40 backdrop-blur-xl border-2 border-white/50 px-6 md:px-8 py-3 md:py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex items-center gap-4 md:gap-8 pointer-events-auto ring-1 ring-white/20">
                        <div className="flex items-center gap-2 md:gap-3">
                            <MapPin className="w-3 h-3 md:w-4 md:h-4 text-primary opacity-40" />
                            <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-slate-900">{tenant?.name}</span>
                        </div>
                        <Separator orientation="vertical" className="h-4 md:h-5 bg-slate-900/10" />
                        <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Boutique Terminal</p>
                    </div>
                </footer>
            )}
        </div>
    );
}
