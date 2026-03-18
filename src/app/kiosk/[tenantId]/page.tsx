'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch, deleteField } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember, type PricingTier, type Appointment } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import { 
    Sparkles, 
    User, 
    Phone, 
    ArrowRight, 
    ArrowLeft, 
    Users, 
    Mail, 
    Loader, 
    Clock, 
    PlusCircle, 
    Check, 
    Printer, 
    DollarSign, 
    Activity, 
    FileSignature, 
    ListChecks, 
    XCircle, 
    Ban, 
    MapPin, 
    ShieldCheck, 
    Fingerprint, 
    Star, 
    Zap, 
    Cake, 
    PartyPopper, 
    Gift, 
    Delete, 
    Workflow, 
    CalendarCheck,
    CheckCircle2,
    ArrowDown
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { format, parseISO, parse, isSameDay, addMinutes, startOfDay } from 'date-fns';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { StaffSelectionCard } from '@/components/shared/StaffSelectionCard';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { PhoneInput } from '@/components/ui/phone-input';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Separator } from '@/components/ui/separator';
import { useForm, FormProvider } from 'react-hook-form';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const isBusinessOpen = (date: Date, schedule: any) => {
    if (!schedule || !schedule.week) return { open: true };
    const dayName = format(date, 'eeee').toLowerCase();
    const dayHours = schedule.week[dayName];
    if (!dayHours || !dayHours.enabled) return { open: false };

    try {
        const now = date;
        const parseTime = (timeStr: string) => {
            return parse(timeStr, timeStr.length > 7 ? 'hh:mm a' : 'h:mm a', now);
        };
        
        const openTime = parseTime(dayHours.start);
        const closeTime = parseTime(dayHours.end);

        return { 
            open: now >= openTime && now <= closeTime,
            hours: `${dayHours.start} - ${dayHours.end}`
        };
    } catch (e) {
        return { open: true }; 
    }
};

const ViewContainer = ({ children }: { children: React.ReactNode }) => (
    <motion.div 
        initial={{ opacity: 0, scale: 0.98 }} 
        animate={{ opacity: 1, scale: 1 }} 
        className="w-full max-w-4xl mx-auto bg-white/40 border-2 border-white/50 rounded-[2.5rem] md:rounded-[4rem] shadow-[0_32px_64px_rgba(0,0,0,0.05)] overflow-hidden backdrop-blur-3xl ring-1 ring-white/20 z-10 text-center"
    >
        {children}
    </motion.div>
);

const PartyTypeSelection = ({ onSelect }: { onSelect: (type: 'individual' | 'group') => void }) => (
    <div className="w-full space-y-12 py-12">
        <div className="space-y-2 text-center px-6">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tighter text-slate-900 leading-none uppercase">Welcome</h2>
            <p className="text-slate-500 text-sm md:text-lg font-medium uppercase tracking-[0.2em] opacity-60">Who are we checking in today?</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 px-6 md:px-16">
            <motion.div 
                whileTap={{ scale: 0.95 }}
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-xl p-10 md:p-16 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('individual')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-8 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <User className="w-16 h-16 md:w-24 md:h-24 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-2xl md:text-4xl font-bold tracking-tight uppercase text-slate-800 leading-none">Solo</h3>
                    <p className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-40">Checking in for myself</p>
                </div>
            </motion.div>

             <motion.div 
                whileTap={{ scale: 0.95 }}
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-xl p-10 md:p-16 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('group')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-8 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <Users className="w-16 h-16 md:w-24 md:h-24 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-2xl md:text-4xl font-bold tracking-tight uppercase text-slate-800 leading-none">My Party</h3>
                    <p className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-40">Checking in a group</p>
                </div>
            </motion.div>
        </div>
    </div>
);

const IdentityChoiceView = ({ onSelect, onBack }: { onSelect: (type: 'new' | 'returning') => void, onBack: () => void }) => (
    <div className="w-full space-y-12 py-12">
        <div className="space-y-2 text-center px-6">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tighter text-slate-900 leading-none uppercase">Identify</h2>
            <p className="text-slate-500 text-sm md:text-lg font-medium uppercase tracking-[0.2em] opacity-60">Is this your first time with us?</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 px-6 md:px-16">
            <motion.div 
                whileTap={{ scale: 0.95 }}
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-xl p-10 md:p-12 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('returning')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-6 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <Star className="w-12 h-12 md:w-16 md:h-16 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl md:text-2xl font-bold tracking-tight uppercase text-slate-800 leading-none">Return Guest</h3>
                    <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.3em] opacity-40">I've visited before</p>
                </div>
            </motion.div>

             <motion.div 
                whileTap={{ scale: 0.95 }}
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-xl p-10 md:p-12 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('new')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-6 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <PlusCircle className="w-12 h-12 md:w-16 md:h-16 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl md:text-2xl font-bold tracking-tight uppercase text-slate-800 leading-none">First Visit</h3>
                    <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.3em] opacity-40">I'm a new guest</p>
                </div>
            </motion.div>
        </div>
        <div className="text-center px-6">
            <Button variant="ghost" onClick={onBack} className="text-slate-400 font-bold uppercase tracking-widest text-[10px] md:text-xs hover:text-slate-600">Back to Start</Button>
        </div>
    </div>
);

const PhonePadView = ({ value, onDigit, onDelete, onConfirm, onBack, isVerifying }: { value: string, onDigit: (d: string) => void, onDelete: () => void, onConfirm: () => void, onBack: () => void, isVerifying: boolean }) => {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];
    
    const formattedDisplay = useMemo(() => {
        const cleaned = value.replace(/\D/g, '');
        if (!cleaned) return '';
        if (cleaned.length <= 3) return `( ${cleaned} )`;
        if (cleaned.length <= 6) return `( ${cleaned.slice(0, 3)} )  ${cleaned.slice(3)}`;
        return `( ${cleaned.slice(0, 3)} )  ${cleaned.slice(3, 6)} - ${cleaned.slice(6)}`;
    }, [value]);

    return (
        <div className="w-full max-w-md mx-auto space-y-10 py-12 px-6">
            <div className="space-y-2 text-center">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tighter uppercase text-slate-900 leading-none">Identity Key</h2>
                <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] opacity-60">Enter your professional phone signature</p>
            </div>

            <div className="p-8 rounded-[2.5rem] bg-white/60 backdrop-blur-xl border-2 border-white/50 shadow-inner text-center">
                <p className="text-xl md:text-3xl font-black font-mono tracking-widest text-primary leading-none min-h-[1.2em]">
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
                                whileTap={{ scale: 0.9, backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
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
                            whileTap={{ scale: 0.95, boxShadow: '0 0 20px rgba(var(--primary), 0.2)' }}
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
                    className="w-full h-16 md:h-20 rounded-2xl text-lg md:text-2xl font-bold uppercase tracking-widest shadow-2xl shadow-primary/30 group"
                >
                    {isVerifying ? <Loader className="animate-spin" /> : <>Identify Me <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" /></>}
                </Button>
                <Button variant="ghost" onClick={onBack} className="w-full text-slate-400 font-bold uppercase tracking-widest text-[10px]">Go Back</Button>
            </div>
        </div>
    );
};

const IdentityConfirmView = ({ client, onConfirm, onBack }: { client: Client, onConfirm: () => void, onBack: () => void }) => (
    <div className="w-full max-w-md mx-auto space-y-12 py-12 px-6 text-center">
        <div className="space-y-2">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tighter uppercase text-slate-900 leading-none">Is this you?</h2>
            <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] opacity-60">Confirming Guest Dossier</p>
        </div>

        <div className="p-8 md:p-10 rounded-[3rem] border-4 border-primary/10 bg-white/80 backdrop-blur-xl shadow-2xl space-y-6 flex flex-col items-center text-center">
            <Avatar className="w-32 h-32 border-4 border-background shadow-xl rounded-[2.5rem]">
                <AvatarImage src={client.avatarUrl} className="object-cover" />
                <AvatarFallback className="text-2xl font-black bg-primary/10 text-primary">{(client.name || 'G').charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
                <h3 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{client.name}</h3>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-60">{client.email || client.phone}</p>
            </div>
        </div>

        <div className="space-y-4">
            <Button size="lg" onClick={onConfirm} className="w-full h-16 md:h-20 rounded-2xl text-lg md:text-2xl font-bold uppercase tracking-widest shadow-2xl shadow-primary/30 group">
                Yes, That's Me <Check className="ml-2 w-6 h-6" />
            </Button>
            <Button variant="ghost" onClick={onBack} className="w-full text-slate-400 font-bold uppercase tracking-widest text-[10px]">No, This isn't me</Button>
        </div>
    </div>
);

const WelcomeBackView = ({ name, onContinue }: { name: string, onContinue: () => void }) => (
    <div className="w-full max-w-md mx-auto space-y-12 py-16 px-6 text-center">
        <div className="w-24 h-24 md:w-32 md:h-32 bg-primary/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-6">
            <Sparkles className="w-12 h-12 md:w-16 md:h-16 text-primary -rotate-6" />
        </div>
        <div className="space-y-4">
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none">Welcome back,<br/><span className="text-primary italic font-serif lowercase tracking-normal">{name.split(' ')[0]}</span></h2>
            <p className="text-slate-500 text-sm md:text-xl font-bold uppercase tracking-[0.2em] opacity-70 leading-relaxed">It's great to see you again. Ready for your next transformation?</p>
        </div>
        <Button size="lg" onClick={onContinue} className="w-full h-16 md:h-20 rounded-[2.5rem] text-lg md:text-2xl font-bold uppercase tracking-widest shadow-3xl shadow-primary/30 group">
            Proceed <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" />
        </Button>
    </div>
);

const ConfirmationScreen = ({ confirmedParty, onPrint, onDone }: { confirmedParty: WalkInTicketData[], onPrint: (t: WalkInTicketData) => void, onDone: () => void }) => (
    <div className="p-10 md:p-24 text-center space-y-10 md:space-y-16">
        <div className="w-24 h-24 md:w-32 md:h-32 bg-green-500/5 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl shadow-green-500/5 rotate-6">
            <CheckCircle2 className="w-12 h-12 text-green-500 -rotate-6" />
        </div>
        <div className="space-y-4">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tighter uppercase text-slate-900 drop-shadow-sm text-center">You're in!</h2>
            <p className="text-slate-500 text-sm md:text-xl font-bold uppercase tracking-[0.2em] opacity-70 text-center">Watch for our text notification.</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto">
            {confirmedParty.map(ticket => (
                <Card key={ticket.id} className="bg-white/80 backdrop-blur-xl border-2 border-white/50 rounded-[2rem] text-left shadow-xl group overflow-hidden">
                    <CardContent className="p-6 md:p-8 flex justify-between items-center text-left">
                        <div className="space-y-1 text-left">
                            <p className="text-[10px] text-primary font-black uppercase tracking-[0.2em] opacity-60 mb-1">Queue Spot</p>
                            <p className="font-bold text-2xl md:text-4xl uppercase tracking-tighter text-slate-900">#{ticket.queuePosition}</p>
                            <p className="text-xs md:sm font-bold text-slate-500 uppercase tracking-tight truncate max-w-[150px]">{ticket.name}</p>
                        </div>
                        <button onClick={() => onPrint(ticket)} className="text-primary hover:bg-primary/10 rounded-2xl h-12 w-12 md:h-16 md:w-16 transition-all active:scale-90 bg-white/50 border border-white shadow-sm flex items-center justify-center shrink-0">
                            <Printer className="w-6 h-6 md:w-8 md:h-8" />
                        </button>
                    </CardContent>
                </Card>
            ))}
        </div>

        <div className="pt-10">
            <Button size="lg" onClick={onDone} className="h-14 md:h-20 px-12 md:px-20 text-lg md:text-2xl font-bold rounded-2xl md:rounded-3xl uppercase tracking-widest shadow-xl shadow-primary/20 transition-all hover:scale-105 active:scale-95">Complete</Button>
        </div>
    </div>
);

const StepDetails = ({ 
    member, 
    onUpdate, 
    primaryMember, 
    isGroup, 
    bannedClient, 
    existingClientWithBalance,
    isResolvingIdentity
}: any) => {
    const usePrimaryContact = () => { if (primaryMember) onUpdate({ phone: primaryMember.phone, email: primaryMember.email }); };
    
    return (
        <div className="space-y-6 text-left">
            <div className="space-y-2">
                <Label htmlFor={`phone-${member.id}`} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    <Phone className="w-3 h-3 text-primary opacity-60"/>
                    <span>Phone Number</span>
                </Label>
                <div className="kiosk-phone-input">
                    <PhoneInput
                        name={`phone-${member.id}`}
                        international
                        defaultCountry="US"
                        value={member.phone || ''}
                        onChange={(value) => onUpdate({ phone: value || '' })}
                        placeholder="(555) 000-0000"
                        className="flex h-12 md:h-14 w-full rounded-2xl border-2 border-white/50 bg-white/80 px-4 py-2 text-lg md:text-xl font-bold focus-within:ring-4 focus-within:ring-primary/10 focus-within:border-primary transition-all [&_input]:border-none [&_input]:focus-visible:ring-0 [&_input]:h-auto [&_input]:p-0 [&_input]:bg-transparent shadow-inner text-slate-900"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor={`name-${member.id}`} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    <User className="w-3 h-3 text-primary opacity-60"/>
                    <span>Full Name</span>
                </Label>
                <input id={`name-${member.id}`} value={member.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder={member.isPrimary ? "Your name" : "Guest's name"} className="flex h-12 md:h-14 w-full rounded-2xl border-2 border-white/50 bg-white/80 px-4 py-2 text-lg md:text-xl font-bold focus-visible:outline-none focus-visible:ring-4 focus-within:ring-primary/10 focus-visible:border-primary transition-all shadow-inner text-slate-900 placeholder:text-slate-300 uppercase tracking-tight"/>
            </div>

            {isGroup && !member.isPrimary && ( 
                <Button variant="ghost" size="sm" onClick={usePrimaryContact} className="w-full rounded-xl h-10 bg-white/40 backdrop-blur-xl text-slate-500 font-bold uppercase tracking-widest text-[9px]">
                    Use same contact as {primaryMember?.name.split(' ')[0] || '1st guest'}
                </Button> 
            )}

            <div className="space-y-2">
                <Label htmlFor={`email-${member.id}`} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    <Mail className="w-3 h-3 text-primary opacity-60"/>
                    <span>Email Address</span>
                </Label>
                <Input id={`email-${member.id}`} type="email" value={member.email || ''} onChange={(e) => onUpdate({ email: e.target.value })} placeholder="alex@example.com" className="h-12 md:h-14 text-lg font-bold rounded-2xl border-2 border-white/50 bg-white/80 focus-visible:ring-primary shadow-inner text-slate-900"/>
            </div>

            <AnimatePresence>
                {isResolvingIdentity && (
                    <motion.div key="resolving" className="flex items-center justify-center gap-2 text-[9px] uppercase font-black tracking-widest text-primary animate-pulse py-2 opacity-60">
                        <Loader className="w-3 h-3 animate-spin" /> Verifying Profile...
                    </motion.div>
                )}
                
                {bannedClient && (
                    <motion.div key="banned" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                        <div className="bg-destructive/10 text-destructive border border-destructive/20 p-4 rounded-xl flex gap-3">
                            <Ban className="h-5 w-5 shrink-0" />
                            <div>
                                <p className="text-xs font-bold uppercase tracking-tight mb-1">Check-in Restricted</p>
                                <p className="text-[10px] font-bold leading-relaxed opacity-80 uppercase">Account restricted. Please see the desk for assistance.</p>
                            </div>
                        </div>
                    </motion.div>
                )}
                {existingClientWithBalance && !bannedClient && (
                    <motion.div key="balance" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                        <div className="bg-destructive/5 border border-destructive/20 p-4 rounded-xl flex gap-3 text-destructive">
                            <Wallet className="h-5 w-5 shrink-0" />
                            <div>
                                <p className="text-xs font-bold uppercase tracking-tight mb-1">Balance Alert</p>
                                <p className="text-[10px] font-bold leading-relaxed opacity-80 uppercase">Balance of <strong>${existingClientWithBalance.outstandingBalance?.toFixed(2)}</strong> found. Settle at desk to join queue.</p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const ServiceSelectionCard = ({ service, isSelected, onToggle, pricingTiers }: { service: Service, isSelected: boolean, onToggle: () => void, pricingTiers: PricingTier[] }) => {
    const minPrice = useMemo(() => {
        if (!service.serviceTiers || service.serviceTiers.length === 0) return service.price;
        return Math.min(...service.serviceTiers.map(t => t.price));
    }, [service]);

    return (
        <motion.button 
            whileTap={{ scale: 0.95 }}
            onClick={onToggle} 
            className={cn(
                "relative p-4 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border-2 transition-all flex flex-col items-center justify-center gap-3 h-full group", 
                isSelected ? "border-primary bg-primary/5 shadow-xl ring-4 ring-primary/10" : "bg-white/60 border-white/40 hover:border-primary/20 shadow-sm"
            )}
        >
            <div className={cn("p-3 rounded-2xl bg-primary/5 transition-all group-hover:scale-110 shadow-inner", isSelected && "bg-primary text-white shadow-lg")}>
                <Sparkles className={cn("w-6 h-6 md:w-8 md:h-8", isSelected ? "text-white" : "text-primary opacity-40")} />
            </div>
            <div className="text-center space-y-1">
                <p className="font-bold uppercase tracking-tight text-[10px] md:text-sm text-slate-900 leading-tight">{service.name}</p>
                <p className="text-[9px] md:text-xs font-black text-primary tracking-tighter font-mono">${minPrice.toFixed(0)}+</p>
            </div>
            {isSelected && <div className="absolute top-2 right-2 bg-primary text-white rounded-full p-0.5 shadow-lg"><Check className="w-3 h-3" /></div>}
        </motion.button>
    );
};

const StepServices = ({ member, onUpdate, services, pricingTiers }: { member: any; onUpdate: (updates: Partial<PartyMember>) => void; services: Service[]; pricingTiers: PricingTier[]; }) => {
    const mainServices = useMemo(() => services.filter(s => s.type === 'service'), [services]);
    const selectedMainId = useMemo(() => member.serviceIds.find((id: string) => mainServices.some(s => s.id === id)), [member.serviceIds, mainServices]);
    
    const selectedMainService = useMemo(() => services.find(s => s.id === selectedMainId), [services, selectedMainId]);
    const categories = useMemo(() => Array.from(new Set(mainServices.map(s => s.category || 'Standard'))).sort(), [mainServices]);

    const [view, setView] = useState<'category' | 'main' | 'addon'>(selectedMainId ? 'addon' : 'category');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const compatibleAddOns = useMemo(() => {
        if (!selectedMainService) return [];
        return services.filter(s => s.type === 'addon' && (selectedMainService.compatibleAddOnIds || []).includes(s.id));
    }, [services, selectedMainService]);

    const handleCategorySelect = (cat: string) => { setSelectedCategory(cat); setView('main'); };

    const handleMainSelect = (id: string) => {
        const nextServiceIds = [id];
        const selectedMain = services.find(s => s.id === id);
        onUpdate({ serviceIds: nextServiceIds });
        
        const nextAddOns = services.filter(s => s.type === 'addon' && (selectedMain?.compatibleAddOnIds || []).includes(s.id));
        if (nextAddOns.length > 0) setView('addon');
        else onUpdate({ serviceIds: nextServiceIds }); // Transition handled by parent if needed
    };

    const toggleAddOn = (id: string) => {
        const isSelected = member.serviceIds.includes(id);
        const next = isSelected ? member.serviceIds.filter((sid: string) => sid !== id) : [...member.serviceIds, id];
        onUpdate({ serviceIds: next });
    };

    return (
        <AnimatePresence mode="wait">
            {view === 'category' && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="grid grid-cols-1 gap-3 md:gap-4" key="cat-sel">
                    <div className="space-y-2 text-left mb-4">
                        <h3 className="text-xl md:text-2xl font-bold uppercase tracking-tight text-slate-900">Choose Department</h3>
                        <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-60">Select a category to browse treatments</p>
                    </div>
                    {categories.map(category => (
                        <motion.button 
                            key={category} 
                            whileTap={{ scale: 0.98 }}
                            className="w-full p-6 md:p-10 text-xl md:text-3xl font-bold rounded-2xl md:rounded-[2rem] border-2 border-white/40 bg-white/60 backdrop-blur-xl hover:border-primary/20 hover:bg-primary/5 transition-all shadow-xl uppercase tracking-tight text-slate-800 text-left flex justify-between items-center group" 
                            onClick={() => handleCategorySelect(category)}
                        >
                            {category}
                            <ArrowRight className="w-6 h-6 md:w-8 md:h-8 text-primary opacity-0 group-hover:opacity-40 transition-all -translate-x-4 group-hover:translate-x-0" />
                        </motion.button>
                    ))}
                </motion.div>
            )}

            {view === 'main' && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6 text-left" key="main-sel">
                    <button onClick={() => setView('category')} className="mb-2 -ml-2 text-primary font-bold uppercase tracking-widest p-2 transition-all hover:bg-primary/5 rounded-xl flex items-center gap-2 text-[10px] md:text-xs">
                        <ArrowLeft className="h-4 w-4"/> Change Category
                    </button>
                    <div className="space-y-2 text-left mb-6">
                        <h3 className="text-xl md:text-2xl font-bold uppercase tracking-tight text-slate-900">{selectedCategory} Menu</h3>
                        <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-60">Select your primary treatment</p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
                        {mainServices.filter(s => (s.category || 'Standard') === selectedCategory).map(service => (
                            <ServiceSelectionCard key={service.id} service={service} isSelected={member.serviceIds.includes(service.id)} onToggle={() => handleMainSelect(service.id)} pricingTiers={pricingTiers} />
                        ))}
                    </div>
                </motion.div>
            )}

            {view === 'addon' && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8 text-left" key="addon-sel">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <button onClick={() => setView('main')} className="text-primary font-bold uppercase tracking-widest p-2 -ml-2 transition-all hover:bg-primary/5 rounded-xl flex items-center gap-2 text-[10px] md:text-xs w-fit">
                            <ArrowLeft className="h-4 w-4"/> Change Treatment
                        </button>
                        <Badge variant="outline" className="h-8 px-4 rounded-xl border-primary/20 text-primary bg-primary/5 font-black uppercase text-[10px] tracking-tight truncate max-w-xs">
                            <Sparkles className="w-3 h-3 mr-2 opacity-40"/>
                            Target: {selectedMainService?.name}
                        </Badge>
                    </div>
                    
                    <div className="space-y-2">
                        <h3 className="text-xl md:text-2xl font-bold uppercase tracking-tighter text-slate-900">Enhance your session?</h3>
                        <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-60 leading-relaxed">Optional add-ons compatible with your selection.</p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
                        {compatibleAddOns.map(addon => (
                            <ServiceSelectionCard key={addon.id} service={addon} isSelected={member.serviceIds.includes(addon.id)} onToggle={() => toggleAddOn(addon.id)} pricingTiers={pricingTiers} />
                        ))}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

const StepStaff = ({ member, onUpdate, staff, pricingTiers }: { member: any; onUpdate: (updates: Partial<PartyMember>) => void; staff: Staff[]; pricingTiers: PricingTier[]; }) => (
    <div className="space-y-6 text-left" key="staff-selection-step">
        <RadioGroup value={member.preferredStaffId || 'any'} onValueChange={(staffId) => onUpdate({ preferredStaffId: staffId })} className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            <StaffSelectionCard staff={{ id: 'any', name: 'First Available', avatarUrl: '' }} pricingTiers={pricingTiers} isSelected={member.preferredStaffId === 'any' || !member.preferredStaffId} />
            {staff?.map(s => <StaffSelectionCard key={s.id} staff={s} pricingTiers={pricingTiers} isSelected={member.preferredStaffId === s.id} />)}
        </RadioGroup>
        {(member.preferredStaffId && member.preferredStaffId !== 'any') && (
            <div className="flex items-center justify-between rounded-2xl border-2 border-white/50 bg-white/40 backdrop-blur-xl p-5 mt-6 shadow-inner">
                <div className="space-y-0.5 text-left">
                    <Label htmlFor={`wait-${member.id}`} className="font-bold text-base md:text-lg text-slate-800 uppercase tracking-tight">Wait for Pro?</Label>
                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest opacity-60">Estimated wait time may increase</p>
                </div>
                <Switch id={`wait-${member.id}`} checked={member.waitForPreferredStaff} onCheckedChange={(checked) => onUpdate({ waitForPreferredStaff: checked })} className="scale-125 data-[state=checked]:bg-primary" />
            </div>
        )}
    </div>
);

const StepConsents = ({ member, requiredForms, formAnswers, setFormAnswers }: { member: any, requiredForms: ConsentForm[], formAnswers: Record<string, any>, setFormAnswers: (answers: Record<string, any>) => void }) => (
    <div className="space-y-6 md:space-y-10 text-left" key="consent-step">
        {requiredForms.map(form => (
            <div key={form.id} className="space-y-6 md:space-y-8 p-6 md:p-10 rounded-[2rem] border-2 border-white/50 bg-white/60 backdrop-blur-xl shadow-xl">
                <h3 className="text-xl md:text-2xl font-bold flex items-center gap-3 uppercase tracking-tighter text-slate-900 text-left"><FileSignature className="w-6 h-6 md:w-8 md:h-8 text-primary opacity-60" /> {form.title}</h3>
                <div className="space-y-6 md:space-y-10">
                    {form.fields?.map(field => (
                        <div key={field.id} className="kiosk-form-field">
                            <FormFieldRenderer 
                                field={field} 
                                value={formAnswers[form.id]?.[field.id]}
                                onChange={(val) => setFormAnswers({
                                    ...formAnswers,
                                    [form.id]: { ...(formAnswers[form.id] || {}), [field.id]: val }
                                })}
                            />
                        </div>
                    ))}
                </div>
            </div>
        ))}
    </div>
);

const MemberSetup = ({
    member,
    onUpdate,
    partyMembers,
    memberSubStep,
    services,
    staff,
    pricingTiers,
    consentForms,
    formAnswers,
    setFormAnswers,
    onNext,
    onBack,
    isGroup,
    isLastMember,
    onAddAnother,
    onSubmit,
    isSubmitting,
    bannedClient,
    existingClientWithBalance,
    isResolvingIdentity,
    matchedAppointment,
    onAppointmentCheckIn
}: any) => {
    const subStepTitles = {
        details: { title: 'Personal Info', icon: <User className="w-4 h-4 md:w-5 md:h-5" /> },
        services: { title: 'Treatment', icon: <Sparkles className="w-4 h-4 md:w-5 md:h-5" /> },
        consents: { title: 'Agreements', icon: <FileSignature className="w-4 h-4 md:w-5 md:h-5" /> },
        staff: { title: 'Preferences', icon: <Users className="w-4 h-4 md:w-5 md:h-5" /> },
    };
    
    const primaryService = services.find((s: Service) => s.id === member.serviceIds[0]);
    const requiredForms = consentForms.filter((f: ConsentForm) => primaryService?.requiredFormIds?.includes(f.id));
    
    const subSteps: MemberSubStep[] = ['details', 'services'];
    if (requiredForms.length > 0) subSteps.push('consents');
    subSteps.push('staff');
    
    const currentSubStepIndex = subSteps.indexOf(memberSubStep);
    const progress = useMemo(() => {
        const stepProgress = (currentSubStepIndex) / (subSteps.length);
        if (isGroup) return (member.index / partyMembers.length * 100) + (stepProgress * (100 / partyMembers.length));
        return (currentSubStepIndex / (subSteps.length)) * 100;
    }, [currentSubStepIndex, subSteps.length, isGroup, member.index, partyMembers.length]);

    const hasNextSubStep = currentSubStepIndex < subSteps.length - 1;

    return (
        <div key={`member-setup-wrapper-${member.id}`}>
            <div className="p-8 md:p-12 pb-4 text-left">
                <div className="flex items-center justify-between gap-4 mb-2">
                    <h2 className="text-2xl md:text-4xl font-bold tracking-tighter uppercase text-slate-900 leading-none">{isGroup ? `Guest ${member.index + 1}` : 'Guest Check-in'}</h2>
                    {isGroup && <Badge className="bg-primary/10 text-primary border-none font-black px-3 py-1 rounded-xl text-xs md:text-sm shadow-sm">{member.index + 1} / {partyMembers.length}</Badge>}
                </div>
                <div className="flex items-center gap-3 text-primary font-bold uppercase tracking-[0.2em] text-[10px] md:text-sm">
                    {subStepTitles[memberSubStep as MemberSubStep].icon} {subStepTitles[memberSubStep as MemberSubStep].title}
                </div>
                <div className="pt-6 md:pt-8"><Progress value={progress} className="h-1.5 md:h-2 rounded-full bg-white/20" /></div>
            </div>

            <div className="p-8 md:p-12 pt-4 md:pt-6">
                <AnimatePresence mode="wait">
                    <motion.div key={memberSubStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                        {memberSubStep === 'details' && (
                            <div className="space-y-8">
                                {matchedAppointment && (
                                    <div className="p-6 rounded-[2.5rem] border-4 border-primary bg-primary/5 shadow-2xl space-y-6 text-left">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-primary rounded-2xl shadow-xl"><CalendarCheck className="w-8 h-8 text-white" /></div>
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-black uppercase text-primary tracking-widest">Appointment Match</p>
                                                <h3 className="text-xl font-black uppercase text-slate-900">{services.find((s:any) => s.id === matchedAppointment.serviceId)?.name}</h3>
                                            </div>
                                        </div>
                                        <p className="text-xs font-bold text-slate-600 uppercase leading-relaxed tracking-tight">You have a reserved slot at <strong>{format(safeDate(matchedAppointment.startTime), 'h:mm a')}</strong>. Would you like to check in immediately?</p>
                                        <Button size="lg" className="w-full h-14 rounded-2xl text-base font-black uppercase shadow-xl" onClick={() => onAppointmentCheckIn(matchedAppointment)}>Direct Check-In</Button>
                                        <Separator className="bg-primary/10 border-dashed" />
                                        <p className="text-[9px] text-center font-black uppercase text-primary opacity-40">Or continue to change services</p>
                                    </div>
                                )}
                                <StepDetails 
                                    member={member} 
                                    onUpdate={onUpdate} 
                                    isGroup={isGroup} 
                                    primaryMember={partyMembers?.[0]} 
                                    bannedClient={bannedClient}
                                    existingClientWithBalance={existingClientWithBalance}
                                    isResolvingIdentity={isResolvingIdentity}
                                />
                            </div>
                        )}
                        {memberSubStep === 'services' && <StepServices member={member} onUpdate={onUpdate} services={services} pricingTiers={pricingTiers} />}
                        {memberSubStep === 'consents' && <StepConsents member={member} requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} />}
                        {memberSubStep === 'staff' && <StepStaff member={member} onUpdate={onUpdate} staff={staff} pricingTiers={pricingTiers} />}
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="p-8 md:p-12 pt-0 flex flex-col sm:flex-row gap-4 md:gap-6 mt-4">
                <Button variant="ghost" size="lg" onClick={onBack} disabled={isSubmitting} className="text-slate-400 hover:text-slate-600 hover:bg-white/40 h-14 md:h-16 text-sm md:text-lg font-bold rounded-2xl uppercase tracking-widest">Back</Button>
                <div className="hidden sm:block flex-1" />
                {hasNextSubStep ? (
                    <Button 
                        size="lg" 
                        onClick={() => onNext(subSteps[currentSubStepIndex + 1])} 
                        disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity)) || (memberSubStep === 'services' && member.serviceIds.length === 0)} 
                        className="h-14 md:h-16 px-10 md:px-16 text-sm md:text-xl font-bold rounded-2xl shadow-xl shadow-primary/20 group uppercase tracking-widest"
                    >
                        Continue <ArrowRight className="ml-2 w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:translate-x-1"/>
                    </Button>
                ) : (
                    <div className="flex flex-col sm:flex-row gap-4 md:gap-6">
                        {isGroup && !isLastMember && (
                            <Button 
                                size="lg" 
                                variant="outline" 
                                onClick={onAddAnother} 
                                disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity)) || (memberSubStep === 'services' && member.serviceIds.length === 0)} 
                                className="h-14 md:h-16 px-10 md:px-12 text-sm md:text-xl font-bold rounded-2xl border-2 border-primary text-primary hover:bg-primary/5 uppercase tracking-widest"
                            >
                                Next Guest
                            </Button>
                        )}
                        <Button 
                            size="lg" 
                            onClick={onSubmit} 
                            disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity)) || (memberSubStep === 'services' && member.serviceIds.length === 0)} 
                            className="h-14 md:h-16 px-10 md:px-20 text-sm md:text-xl font-bold rounded-2xl shadow-xl shadow-primary/30 uppercase tracking-widest"
                        >
                            {isSubmitting ? <Loader className="animate-spin" /> : 'Complete'}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

type Step = 'partyType' | 'identityChoice' | 'phonePad' | 'identityConfirm' | 'welcomeBack' | 'memberSetup' | 'confirmation';
type MemberSubStep = 'details' | 'services' | 'consents' | 'staff';

export default function WalkInPage() {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const params = useParams();
  const tenantId = params.tenantId as string;

  const methods = useForm({
      defaultValues: {
          name: '',
          email: '',
          phone: '',
      }
  });

  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const staffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true)), [firestore, tenantId]);
  const pricingTiersQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);
  const consentFormsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  const clientsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients`), [firestore, tenantId]);
  
  const { data: tenant } = useDoc<Tenant>(tenantDocRef);
  const { data: services } = useCollection<Service>(servicesQuery);
  const { data: staff } = useCollection<Staff>(staffQuery);
  const { data: scheduleProfiles } = useCollection<any>(scheduleProfilesQuery);
  const { data: pricingTiers } = useCollection<PricingTier>(pricingTiersQuery);
  const { data: consentForms } = useCollection<ConsentForm>(consentFormsQuery);
  const { data: clients } = useCollection<Client>(clientsQuery);

  const [entered, setEntered] = useState(false);
  const [step, setStep] = useState<Step>('partyType');
  const [isGroup, setIsGroup] = useState(false);
  const [partyMembers, setPartyMembers] = useState<PartyMember[]>([]);
  const [currentMemberIndex, setCurrentMemberIndex] = useState(0);
  const [memberSubStep, setMemberSubStep] = useState<MemberSubStep>('details');
  const [formAnswers, setFormAnswers] = useState<Record<string, Record<string, any>>>({});
  const [confirmedParty, setConfirmedParty] = useState<WalkInTicketData[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);

  const [existingClientWithBalance, setExistingClientWithBalance] = useState<Client | null>(null);
  const [bannedClient, setBannedClient] = useState<Client | null>(null);
  const [isResolvingIdentity, setIsResolvingIdentity] = useState(false);
  const [matchedAppointment, setMatchedAppointment] = useState<Appointment | null>(null);
  const [matchedClient, setMatchedClient] = useState<Client | null>(null);
  const [showBirthdayCelebration, setShowBirthdayCelebration] = useState(false);
  const [birthdayName, setBirthdayName] = useState('');
  
  const [clientType, setClientType] = useState<'new' | 'returning' | null>(null);
  const [phonePadValue, setPhonePadValue] = useState('');

  const resolveIdentity = useCallback(async (email?: string, phone?: string) => {
    if (!firestore || !tenantId || (!email && !phone)) return;
    
    setIsResolvingIdentity(true);
    try {
        const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
        const matchPromises = [];
        if (email) matchPromises.push(getDocs(query(clientsRef, where("email", "==", email.toLowerCase().trim()))));
        if (phone) matchPromises.push(getDocs(query(clientsRef, where("phone", "==", phone))));

        const snapshots = await Promise.all(matchPromises);
        const allDocs = snapshots.flatMap(s => s.docs);

        if (allDocs.length > 0) {
            const matchedClientDoc = allDocs[0];
            const matchedClientData = matchedClientDoc.data() as Client;
            const matchedClientId = matchedClientDoc.id;
            const clientObj = { ...matchedClientData, id: matchedClientId };

            setMatchedClient(clientObj);

            if (clientObj.status === 'banned') {
                setBannedClient(clientObj);
                setExistingClientWithBalance(null);
                setMatchedAppointment(null);
            } else if (clientObj.outstandingBalance && clientObj.outstandingBalance > 0) {
                setExistingClientWithBalance(clientObj);
                setBannedClient(null);
                setMatchedAppointment(null);
            } else {
                setBannedClient(null);
                setExistingClientWithBalance(null);
                
                const aptsRef = collection(firestore, 'tenants', tenantId, 'appointments');
                const aptSnap = await getDocs(query(aptsRef, where("clientId", "==", matchedClientId), where("status", "==", "confirmed")));
                const todayApt = aptSnap.docs
                    .map(d => ({ ...d.data(), id: d.id } as Appointment))
                    .find(a => isSameDay(safeDate(a.startTime), new Date()));
                
                setMatchedAppointment(todayApt || null);
            }
        } else {
            setBannedClient(null);
            setExistingClientWithBalance(null);
            setMatchedAppointment(null);
            setMatchedClient(null);
            if (clientType === 'returning' && step === 'phonePad') {
                toast({ variant: 'destructive', title: 'Profile Not Found', description: "We couldn't find a record with that number. Proceeding as a first visit." });
                setClientType('new');
                setStep('memberSetup');
            }
        }
    } catch (e) {
        console.error("Identity resolution failed", e);
    } finally {
        setIsResolvingIdentity(false);
    }
  }, [firestore, tenantId, clientType, step, toast]);

  const handlePartyTypeSelect = (type: 'individual' | 'group') => {
    setIsGroup(type === 'group');
    setPartyMembers([{ id: nanoid(5), name: '', serviceIds: [], isPrimary: true, preferredStaffId: 'any', waitForPreferredStaff: false }]);
    if (type === 'group') setStep('memberSetup');
    else setStep('identityChoice');
  };

  const handleIdentitySelect = (type: 'new' | 'returning') => {
      setClientType(type);
      if (type === 'returning') {
          setStep('phonePad');
          setPhonePadValue('');
      } else {
          setStep('memberSetup');
      }
  };

  const handlePhonePadDigit = (digit: string) => {
      if (phonePadValue.length < 10) setPhonePadValue(prev => prev + digit);
  };

  const handlePhonePadDelete = () => {
      setPhonePadValue(prev => prev.slice(0, -1));
  };

  const handlePhonePadConfirm = async () => {
      if (phonePadValue.length < 10) return;
      await resolveIdentity(undefined, `+1${phonePadValue}`); 
      setStep('identityConfirm');
  };

  const handleIdentityConfirm = async () => {
      if (matchedClient) {
          handleMemberUpdate({ name: matchedClient.name, email: matchedClient.email, phone: matchedClient.phone });
          if (matchedAppointment) {
              await handleAppointmentCheckIn(matchedAppointment);
          } else {
              setMemberSubStep('services');
              setStep('welcomeBack');
          }
      }
  };

  const handleMemberUpdate = (updates: Partial<PartyMember>) => {
    setPartyMembers(prev => prev.map((m, idx) => idx === currentMemberIndex ? { ...m, ...updates } : m));
  };

  const handleNextSubStep = async (next: MemberSubStep) => {
    const member = partyMembers[currentMemberIndex];
    
    if (memberSubStep === 'details') {
        if (!member.phone || member.phone.length < 5) return toast({ variant: 'destructive', title: 'Phone Required', description: 'Enter your phone number to help us identify your record.' });
        if (!member.name.trim()) return toast({ variant: 'destructive', title: 'Name Required' });
        if (!member.email?.trim()) return toast({ variant: 'destructive', title: 'Email Required' });
        if (!/^\S+@\S+\.\S+$/.test(member.email!)) return toast({ variant: 'destructive', title: 'Invalid Email' });

        await resolveIdentity(member.email, member.phone);
        if (bannedClient || existingClientWithBalance) {
            return; 
        }
    }

    if (memberSubStep === 'services' && member.serviceIds.length === 0) return toast({ variant: 'destructive', title: 'Select Treatment' });
    
    setMemberSubStep(next);
  };

  const handleBack = () => {
    if (memberSubStep === 'details') {
        if (currentMemberIndex > 0) {
            setCurrentMemberIndex(currentMemberIndex - 1);
            setMemberSubStep('staff'); 
        } else {
            if (isGroup) setStep('partyType');
            else setStep('identityChoice');
        }
    } else {
        const subSteps: MemberSubStep[] = ['details', 'services'];
        const member = partyMembers[currentMemberIndex];
        const primaryService = services?.find((s: Service) => s.id === member.serviceIds[0]);
        const requiredForms = consentForms?.filter((f: ConsentForm) => primaryService?.requiredFormIds?.includes(f.id)) || [];
        if (requiredForms.length > 0) subSteps.push('consents');
        subSteps.push('staff');

        const currentIndex = subSteps.indexOf(memberSubStep);
        setMemberSubStep(subSteps[currentIndex - 1]);
    }
  };

  const handleAppointmentCheckIn = async (apt: Appointment) => {
      if (isSubmitting || !firestore || !tenantId) return;
      setIsSubmitting(true);
      const batch = writeBatch(firestore);
      
      try {
          const aptRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
          batch.update(aptRef, { checkInStatus: 'arrived' });
          
          if (apt.checkInToken) {
              const checkInRef = doc(firestore, 'appointmentCheckIns', apt.checkInToken);
              batch.update(checkInRef, { checkInStatus: 'arrived', tenantId: tenantId });
          }

          const matchedClientObj = clients?.find(c => c.id === apt.clientId);

          if (apt.staffId) {
              const notificationRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
              batch.set(notificationRef, {
                  id: nanoid(),
                  userId: apt.staffId,
                  type: 'client_movement',
                  message: `${apt.clientName || 'Your guest'} has checked in at the kiosk.`,
                  link: '/planner',
                  createdAt: new Date().toISOString(),
                  read: false,
              });
          }

          await batch.commit();
          const ticketData: WalkInTicketData = {
              id: apt.id,
              name: apt.clientName || 'Guest',
              services: services?.filter(s => s.id === apt.serviceId) || [],
              queuePosition: 0, 
              checkInTime: new Date().toISOString(),
          };
          setConfirmedParty([ticketData]);

          if (matchedClientObj && isBirthdayToday(matchedClientObj.birthday)) {
              setBirthdayName(matchedClientObj.name || 'Guest');
              setShowBirthdayCelebration(true);
          } else {
              setStep('confirmation');
          }
      } catch (e) {
          console.error(e);
          toast({ variant: 'destructive', title: 'Check-in Error' });
      } finally {
          setIsSubmitting(false);
      }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const batch = writeBatch(firestore);
    const groupId = nanoid();
    const now = new Date().toISOString();
    const tickets: WalkInTicketData[] = [];

    let birthdayMemberName = '';

    try {
        const queueQuery = query(collection(firestore, `tenants/${tenantId}/walkIns`), where("status", "==", "waiting"));
        const existingQueue = await getDocs(queueQuery);
        let pos = existingQueue.size + 1;

        for (const member of partyMembers) {
            let matchedClientObj = clients?.find(c => (member.email && c.email.toLowerCase() === member.email.toLowerCase()) || (member.phone && c.phone === member.phone));
            let clientId = matchedClientObj?.id;

            if (matchedClientObj && isBirthdayToday(matchedClientObj.birthday)) {
                birthdayMemberName = matchedClientObj.name || member.name;
            }

            if (!clientId) {
                clientId = nanoid();
                batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), { id: clientId, name: member.name, email: member.email || '', phone: member.phone || '', avatarUrl: `https://picsum.photos/seed/${clientId}/100`, lifetimeValue: 0, lastAppointment: now, status: 'active' });
            }

            const walkInId = nanoid();
            const memberWalkIn: any = {
                id: walkInId, 
                groupId, 
                isPrimaryContact: !!member.isPrimary, 
                clientId, 
                customerName: member.name, 
                customerPhone: member.phone || '',
                customerEmail: member.email || '', 
                serviceIds: member.serviceIds, 
                checkInTime: now, 
                status: 'waiting',
                queueOrder: Date.now() + tickets.length,
                waitForPreferredStaff: !!member.waitForPreferredStaff,
                estimatedDuration: services?.filter(s => member.serviceIds.includes(s.id)).reduce((acc, s) => acc + (s.duration || 0), 0) || 0,
            };

            if (isGroup) {
                memberWalkIn.groupName = `${partyMembers[0].name}'s Party`;
            }

            if (member.preferredStaffId && member.preferredStaffId !== 'any') {
                memberWalkIn.preferredStaffId = member.preferredStaffId;
            }

            batch.set(doc(firestore, `tenants/${tenantId}/walkIns`, walkInId), memberWalkIn);

            const memberAnswers = formAnswers[member.id] || {};
            Object.entries(memberAnswers).forEach(([formId, data]) => {
                const consentRef = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`));
                const form = consentForms?.find(f => f.id === formId);
                batch.set(consentRef, { id: consentRef.id, formId, formTitle: form?.title || 'Form', clientId, signedAt: now, formData: data });
            });

            tickets.push({ id: walkInId, name: member.name, services: services?.filter(s => member.serviceIds.includes(s.id)) || [], queuePosition: pos++, checkInTime: now });
        }

        await batch.commit();
        setConfirmedParty(tickets);
        
        if (birthdayMemberName) {
            setBirthdayName(birthdayMemberName);
            setShowBirthdayCelebration(true);
        } else {
            setStep('confirmation');
        }
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: 'Check-in Error' });
    } finally { setIsSubmitting(false); }
  };

  const isClosed = !isBusinessOpen(new Date(), scheduleProfiles?.[0]).open;
  
  const kioskSettings = tenant?.kioskSettings;
  const logoUrl = kioskSettings?.logoUrl;
  const wordmarkUrl = kioskSettings?.wordmarkUrl;
  const showWordmark = kioskSettings?.showWordmark !== false;

  const customPrimaryColor = kioskSettings?.primaryColor;
  const primaryColorHSL = customPrimaryColor && customPrimaryColor.startsWith('#') 
    ? hexToHSLComponents(customPrimaryColor) 
    : customPrimaryColor;

  const activeStaff = useMemo(() => {
    return (staff || []).filter(s => s.active && !s.onBreak);
  }, [staff]);

  function isBirthdayToday(birthday?: string) {
      if (!birthday) return false;
      const birth = safeDate(birthday);
      const today = new Date();
      return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  }

  if (!tenant || !services) return <div className="h-screen flex items-center justify-center bg-background"><Loader className="animate-spin text-primary w-10 h-10" /></div>;
  
  return (
    <div 
        className="min-h-screen bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-blue-50 via-white to-purple-50 text-foreground flex flex-col items-center justify-center p-4 overflow-x-hidden font-body relative"
        style={primaryColorHSL ? { '--primary': primaryColorHSL } as React.CSSProperties : {}}
    >
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
        </div>

        <FormProvider {...methods}>
            {isClosed ? (
                <div className="h-screen flex items-center justify-center bg-background p-4"><ClosedView schedule={scheduleProfiles?.[0]} logoUrl={logoUrl} tenantName={tenant.name} /></div>
            ) : (
                <AnimatePresence mode="wait">
                    {!entered ? (
                        <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center cursor-pointer p-4 group z-10" onClick={() => setEntered(true)}>
                            <div className={cn(
                                "relative overflow-hidden mb-12 md:mb-16 transition-all duration-1000 mx-auto",
                                showWordmark ? "w-24 h-24 md:w-32 md:h-32 rounded-2xl md:rounded-3xl" : "w-48 h-48 md:w-64 md:h-64 rounded-3xl md:rounded-[3rem]",
                                logoUrl ? "shadow-2xl border-4 border-white" : "p-8 md:p-12 bg-white/40 backdrop-blur-3xl border-2 border-white/30 group-hover:border-primary/20 group-hover:shadow-primary/10 shadow-xl"
                            )}>
                                {logoUrl ? (
                                    <Image src={logoUrl} alt={tenant.name} fill className="object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <ClarityFlowLogo className={cn(showWordmark ? "w-12 h-12 md:w-16 md:h-16" : "w-24 h-24 md:w-32 md:h-32")} />
                                    </div>
                                )}
                            </div>
                            
                            {showWordmark && (
                                <div className="animate-in fade-in slide-in-from-top-4 duration-1000">
                                    {wordmarkUrl ? (
                                        <div className="relative h-16 md:h-32 w-full max-w-[500px] mx-auto mb-8">
                                            <Image src={wordmarkUrl} alt={tenant.name} fill className="object-contain" />
                                        </div>
                                    ) : (
                                        <h1 className="text-4xl md:text-7xl font-bold tracking-tighter mb-8 uppercase text-slate-900 drop-shadow-sm leading-none text-center">{tenant.name || 'Welcome'}</h1>
                                    )}
                                </div>
                            )}

                            <p className="text-primary text-xs md:text-xl font-bold tracking-[0.4em] uppercase animate-pulse drop-shadow-sm mt-4 opacity-60 text-center">Tap to Begin</p>
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 1 }} className="mt-12 md:mt-16 flex justify-center">
                                <ArrowDown className="w-6 h-6 md:w-8 md:h-8 animate-bounce text-slate-400 opacity-30" />
                            </motion.div>
                        </motion.div>
                    ) : (
                        <ViewContainer>
                            {step === 'partyType' && <PartyTypeSelection onSelect={handlePartyTypeSelect} />}
                            {step === 'identityChoice' && <IdentityChoiceView onSelect={handleIdentitySelect} onBack={() => setStep('partyType')} />}
                            {step === 'phonePad' && <PhonePadView value={phonePadValue} onDigit={handlePhonePadDigit} onDelete={handlePhonePadDelete} onConfirm={handlePhonePadConfirm} onBack={() => setStep('identityChoice')} isVerifying={isResolvingIdentity} />}
                            {step === 'identityConfirm' && matchedClient && <IdentityConfirmView client={matchedClient} onConfirm={handleIdentityConfirm} onBack={() => setStep('phonePad')} />}
                            {step === 'welcomeBack' && matchedClient && <WelcomeBackView name={matchedClient.name} onContinue={() => setStep('memberSetup')} />}
                            {step === 'memberSetup' && partyMembers[currentMemberIndex] && (
                                <MemberSetup 
                                    member={{...partyMembers[currentMemberIndex], index: currentMemberIndex}}
                                    partyMembers={partyMembers}
                                    onUpdate={handleMemberUpdate}
                                    memberSubStep={memberSubStep}
                                    services={services} 
                                    staff={activeStaff} 
                                    pricingTiers={pricingTiers || []}
                                    consentForms={consentForms || []}
                                    formAnswers={formAnswers[partyMembers[currentMemberIndex].id] || {}}
                                    setFormAnswers={(a: any) => setFormAnswers(p => ({...p, [partyMembers[currentMemberIndex].id]: a}))}
                                    onNext={handleNextSubStep} onBack={handleBack}
                                    isGroup={isGroup} isLastMember={currentMemberIndex === partyMembers.length - 1}
                                    onAddAnother={() => { 
                                        setPartyMembers([...partyMembers, { id: nanoid(5), name: '', serviceIds: [], preferredStaffId: 'any', waitForPreferredStaff: false }]); 
                                        setCurrentMemberIndex(partyMembers.length); 
                                        setMemberSubStep('details'); 
                                    } }
                                    onSubmit={handleSubmit} isSubmitting={isSubmitting}
                                    bannedClient={bannedClient}
                                    existingClientWithBalance={existingClientWithBalance}
                                    isResolvingIdentity={isResolvingIdentity}
                                    matchedAppointment={matchedAppointment}
                                    onAppointmentCheckIn={handleAppointmentCheckIn}
                                />
                            )}
                            {step === 'confirmation' && <ConfirmationScreen confirmedParty={confirmedParty} onPrint={(t) => { setTicketToPrint(t); setIsPrintDialogOpen(true); }} onDone={() => { setEntered(false); setStep('partyType'); setPartyMembers([]); setFormAnswers({}); setMatchedAppointment(null); setPhonePadValue(''); setClientType(null); setMatchedClient(null); }} />}
                        </ViewContainer>
                    )}
                </AnimatePresence>
            )}
        </FormProvider>

        <AnimatePresence>
            {showBirthdayCelebration && (
                <BirthdayCelebrationView 
                    clientName={birthdayName} 
                    onDone={() => {
                        setShowBirthdayCelebration(false);
                        setStep('confirmation');
                    }} 
                />
            )}
        </AnimatePresence>

        <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
            <DialogContent className="max-w-sm rounded-[2rem] border-2 shadow-3xl p-0 overflow-hidden text-center">
                <DialogHeader className="p-6 bg-muted/5 border-b">
                    <DialogTitle className="text-xl font-bold uppercase tracking-tight text-center text-slate-900 leading-none">Ticket Issued</DialogTitle>
                </DialogHeader>
                <div className="flex justify-center p-8 bg-white text-center">
                    {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
                </div>
                <DialogFooter className="p-6 border-t bg-muted/5">
                    <Button className="w-full h-12 rounded-xl text-lg font-bold uppercase tracking-widest shadow-xl shadow-primary/20" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Authorize Print</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
  );
}

const ClosedView = ({ schedule, logoUrl, tenantName }: { schedule: any, logoUrl?: string, tenantName?: string }) => (
    <div className="text-center space-y-6 max-w-md bg-white/40 backdrop-blur-xl p-10 rounded-[3rem] border border-white/20 shadow-2xl">
        <div className="inline-block p-6 bg-white/50 rounded-full border border-white/30 mb-4 shadow-inner overflow-hidden">
            {logoUrl ? (
                <div className="relative w-16 h-16">
                    <Image src={logoUrl} alt={tenantName || 'Logo'} fill className="object-cover" />
                </div>
            ) : (
                <Clock className="w-12 h-12 text-primary" />
            )}
        </div>
        <h1 className="text-2xl md:text-4xl font-bold uppercase tracking-tighter text-slate-900">Closed</h1>
        <p className="text-sm md:text-base text-slate-600 font-medium leading-relaxed uppercase tracking-tight">Our kiosk is only available during business hours. Please come back during our scheduled times or book online.</p>
        {schedule && (
            <div className="p-4 rounded-2xl bg-white/60 border border-white/40 text-sm shadow-sm text-center">
                <p className="font-bold text-primary mb-2 uppercase tracking-widest text-[10px]">Today's Hours</p>
                <p className="text-lg font-bold text-slate-900 uppercase tracking-tight text-center">{isBusinessOpen(new Date(), schedule).hours || 'Closed'}</p>
            </div>
        )}
        <Button asChild className="w-full h-14 rounded-2xl shadow-xl text-lg font-bold uppercase tracking-widest">
            <Link href="/">Return Home</Link>
        </Button>
    </div>
);
