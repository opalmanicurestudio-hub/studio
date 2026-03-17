
'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
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
import { useFirebase, useDoc, useCollection, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch, increment, arrayUnion } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember, WalkIn, type PricingTier, type Appointment } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon, Loader, Clock, Trash2, PlusCircle, Check, Printer, DollarSign, Activity, FileSignature, ListChecks, XCircle, Ban, Wallet, AlertTriangle, ArrowDown, Fingerprint, CalendarCheck, CheckCircle2, Star, Zap, Cake, PartyPopper, Gift, Delete, Eraser, Backspace } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { format, getDay, parseISO, parse, isSameDay, isSameMonth } from 'date-fns';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { StaffSelectionCard } from '@/components/shared/StaffSelectionCard';
import { motion, AnimatePresence } from 'framer-motion';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
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

const ClosedView = ({ schedule, logoUrl, tenantName }: { schedule: any, logoUrl?: string, tenantName?: string }) => (
    <div className="text-center space-y-6 max-w-md bg-white/40 backdrop-blur-2xl p-10 rounded-[3rem] border border-white/20 shadow-2xl">
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
            <div className="p-4 rounded-2xl bg-white/60 border border-white/40 text-sm shadow-sm">
                <p className="font-bold text-primary mb-2 uppercase tracking-widest text-[10px]">Today's Hours</p>
                <p className="text-lg font-bold text-slate-900 uppercase tracking-tight">{isBusinessOpen(new Date(), schedule).hours || 'Closed'}</p>
            </div>
        )}
        <Button asChild className="w-full h-14 rounded-2xl shadow-xl text-lg font-bold uppercase tracking-widest">
            <Link href="/">Return Home</Link>
        </Button>
    </div>
);

const PartyTypeSelection = ({ onSelect }: { onSelect: (type: 'individual' | 'group') => void }) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full space-y-12 py-12" key="party-type-selection">
        <div className="space-y-2 text-center px-6">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tighter text-slate-900">Welcome</h2>
            <p className="text-slate-500 text-sm md:text-lg font-medium uppercase tracking-[0.2em] opacity-60">Who are we checking in today?</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 px-6 md:px-16">
            <div 
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-2xl p-10 md:p-16 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('individual')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-8 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <User className="w-16 h-16 md:w-24 md:h-24 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-2xl md:text-4xl font-bold tracking-tight uppercase text-slate-800 leading-none">Solo</h3>
                    <p className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-40">Checking in for myself</p>
                </div>
            </div>

             <div 
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-2xl p-10 md:p-16 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('group')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-8 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <Users className="w-16 h-16 md:w-24 md:h-24 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-2xl md:text-4xl font-bold tracking-tight uppercase text-slate-800 leading-none">My Party</h3>
                    <p className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-40">Checking in a group</p>
                </div>
            </div>
        </div>
    </motion.div>
);

const IdentityChoiceView = ({ onSelect, onBack }: { onSelect: (type: 'new' | 'returning') => void, onBack: () => void }) => (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="w-full space-y-12 py-12" key="identity-choice">
        <div className="space-y-2 text-center px-6">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tighter text-slate-900">Good to see you</h2>
            <p className="text-slate-500 text-sm md:text-lg font-medium uppercase tracking-[0.2em] opacity-60">Is this your first time with us?</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 px-6 md:px-16">
            <div 
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-2xl p-10 md:p-12 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('returning')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-6 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <Star className="w-12 h-12 md:w-16 md:h-16 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl md:text-2xl font-bold tracking-tight uppercase text-slate-800 leading-none">Return Guest</h3>
                    <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.3em] opacity-40">I've visited before</p>
                </div>
            </div>

             <div 
                className="group relative rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-2xl p-10 md:p-12 flex flex-col items-center justify-center text-center transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 cursor-pointer shadow-xl"
                onClick={() => onSelect('new')}
            >
                <div className="p-6 bg-primary/5 rounded-full mb-6 group-hover:bg-primary/10 transition-all duration-500 shadow-inner">
                    <PlusCircle className="w-12 h-12 md:w-16 md:h-16 text-primary group-hover:scale-110 transition-transform duration-700" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl md:text-2xl font-bold tracking-tight uppercase text-slate-800 leading-none">First Visit</h3>
                    <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.3em] opacity-40">I'm a new guest</p>
                </div>
            </div>
        </div>
        <div className="text-center px-6">
            <Button variant="ghost" onClick={onBack} className="text-slate-400 font-bold uppercase tracking-widest text-[10px] md:text-xs hover:text-slate-600">Back to Start</Button>
        </div>
    </motion.div>
);

const PhonePadView = ({ value, onDigit, onDelete, onConfirm, onBack, isVerifying }: { value: string, onDigit: (d: string) => void, onDelete: () => void, onConfirm: () => void, onBack: () => void, isVerifying: boolean }) => {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];
    
    const formattedDisplay = useMemo(() => {
        if (!value) return '( _ _ _ )  _ _ _ - _ _ _ _';
        const cleaned = value.replace(/\D/g, '');
        let match = null;
        if (cleaned.length <= 3) return `( ${cleaned}${'_'.repeat(3 - cleaned.length)} )  _ _ _ - _ _ _ _`;
        if (cleaned.length <= 6) return `( ${cleaned.slice(0, 3)} )  ${cleaned.slice(3)}${'_'.repeat(6 - cleaned.length)} - _ _ _ _`;
        return `( ${cleaned.slice(0, 3)} )  ${cleaned.slice(3, 6)} - ${cleaned.slice(6)}${'_'.repeat(10 - cleaned.length)}`;
    }, [value]);

    return (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md mx-auto space-y-10 py-12 px-6" key="phone-pad">
            <div className="space-y-2 text-center">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tighter uppercase text-slate-900 leading-none">Identity Key</h2>
                <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] opacity-60">Enter your professional phone signature</p>
            </div>

            <div className="p-8 rounded-[2rem] bg-white/60 backdrop-blur-xl border-2 border-white/50 shadow-inner text-center">
                <p className="text-xl md:text-3xl font-black font-mono tracking-widest text-primary leading-none">
                    {formattedDisplay}
                </p>
            </div>

            <div className="grid grid-cols-3 gap-4 max-w-[320px] mx-auto">
                {digits.map((d, i) => {
                    if (d === '') return <div key={i} />;
                    if (d === 'delete') {
                        return (
                            <button 
                                key={i} 
                                onClick={onDelete}
                                className="h-16 w-16 md:h-20 md:w-20 rounded-full flex items-center justify-center text-slate-400 hover:text-destructive hover:bg-destructive/5 transition-all active:scale-90"
                            >
                                <Backspace className="w-6 h-6 md:w-8 md:h-8" strokeWidth={1.5} />
                            </button>
                        );
                    }
                    return (
                        <button 
                            key={i} 
                            onClick={() => onDigit(d)}
                            className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-white/80 border-2 border-white/50 text-2xl md:text-3xl font-bold text-slate-800 shadow-sm hover:border-primary hover:text-primary transition-all active:scale-90"
                        >
                            {d}
                        </button>
                    );
                })}
            </div>

            <div className="space-y-4 pt-4">
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
        </motion.div>
    );
};

const ConfirmationScreen = ({ confirmedParty, onPrint, onDone }: { confirmedParty: WalkInTicketData[], onPrint: (t: WalkInTicketData) => void, onDone: () => void }) => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-10 md:p-24 text-center space-y-10 md:space-y-16" key="confirmation-screen">
        <div className="w-24 h-24 md:w-32 md:h-32 bg-green-500/5 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl shadow-green-500/5 rotate-6">
            <CheckCircle className="w-12 h-12 text-green-500 -rotate-6" />
        </div>
        <div className="space-y-4">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tighter uppercase text-slate-900 drop-shadow-sm">You're in!</h2>
            <p className="text-slate-500 text-sm md:text-xl font-bold uppercase tracking-[0.2em] opacity-70">Watch for our text notification.</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto">
            {confirmedParty.map(ticket => (
                <Card key={ticket.id} className="bg-white/80 backdrop-blur-md border-2 border-white/50 rounded-[2rem] text-left shadow-xl group overflow-hidden">
                    <CardContent className="p-6 md:p-8 flex justify-between items-center">
                        <div className="space-y-1 text-left">
                            <p className="text-[10px] text-primary font-black uppercase tracking-[0.2em] opacity-60 mb-1">Queue Spot</p>
                            <p className="font-bold text-2xl md:text-4xl uppercase tracking-tighter text-slate-900">#{ticket.queuePosition}</p>
                            <p className="text-xs md:sm font-bold text-slate-500 uppercase tracking-tight truncate max-w-[150px]">{ticket.name}</p>
                        </div>
                        <button onClick={() => onPrint(ticket)} className="text-primary hover:bg-primary/10 rounded-2xl h-12 w-12 md:h-16 md:w-16 transition-all active:scale-90 bg-white/50 border border-white shadow-sm flex items-center justify-center">
                            <Printer className="w-6 h-6 md:w-8 md:h-8" />
                        </button>
                    </CardContent>
                </Card>
            ))}
        </div>

        <div className="pt-10">
            <Button size="lg" onClick={onDone} className="h-14 md:h-20 px-12 md:px-20 text-lg md:text-2xl font-bold rounded-2xl md:rounded-3xl uppercase tracking-widest shadow-xl shadow-primary/20 transition-all hover:scale-105 active:scale-95">Complete</Button>
        </div>
    </motion.div>
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} key={`member-setup-wrapper-${member.id}`}>
            <div className="p-8 md:p-12 pb-4">
                <div className="flex items-center justify-between gap-4 mb-2 text-left">
                    <h2 className="text-2xl md:text-4xl font-bold tracking-tighter uppercase text-slate-900">{isGroup ? `Guest ${member.index + 1}` : 'Guest Check-in'}</h2>
                    {isGroup && <Badge className="bg-primary/10 text-primary border-none font-black px-3 py-1 rounded-xl text-xs md:text-sm shadow-sm">{member.index + 1} / {partyMembers.length}</Badge>}
                </div>
                <div className="flex items-center gap-3 text-primary font-bold uppercase tracking-[0.2em] text-[10px] md:text-sm">
                    {subStepTitles[memberSubStep as MemberSubStep].icon} {subStepTitles[memberSubStep as MemberSubStep].title}
                </div>
                <div className="pt-6 md:pt-8"><Progress value={progress} className="h-1.5 md:h-2 rounded-full bg-white/20" /></div>
            </div>

            <div className="p-8 md:p-12 pt-4 md:pt-6 text-left">
                <AnimatePresence mode="wait">
                    <motion.div key={memberSubStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                        {memberSubStep === 'details' && (
                            <StepDetails 
                                key="step-details"
                                member={member} 
                                onUpdate={onUpdate} 
                                isGroup={isGroup} 
                                primaryMember={partyMembers?.[0]} 
                                bannedClient={bannedClient}
                                existingClientWithBalance={existingClientWithBalance}
                                isResolvingIdentity={isResolvingIdentity}
                                matchedAppointment={matchedAppointment}
                                onAppointmentCheckIn={onAppointmentCheckIn}
                                services={services}
                                staff={staff}
                            />
                        )}
                        {memberSubStep === 'services' && <StepServices key="step-services" member={member} onUpdate={onUpdate} services={services} staff={staff} pricingTiers={pricingTiers}/>}
                        {memberSubStep === 'consents' && <StepConsents key="step-consents" member={member} requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} />}
                        {memberSubStep === 'staff' && <StepStaff key="step-staff" member={member} onUpdate={onUpdate} staff={staff} pricingTiers={pricingTiers} />}
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
                        disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
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
                                disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                                className="h-14 md:h-16 px-10 md:px-12 text-sm md:text-xl font-bold rounded-2xl border-2 border-primary text-primary hover:bg-primary/5 uppercase tracking-widest"
                            >
                                Next Guest
                            </Button>
                        )}
                        <Button 
                            size="lg" 
                            onClick={onSubmit} 
                            disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                            className="h-14 md:h-16 px-10 md:px-20 text-sm md:text-xl font-bold rounded-2xl shadow-xl shadow-primary/30 uppercase tracking-widest"
                        >
                            {isSubmitting ? <Loader className="animate-spin" /> : 'Complete'}
                        </Button>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

const StepDetails = ({ 
    member, 
    onUpdate, 
    primaryMember, 
    isGroup, 
    bannedClient, 
    existingClientWithBalance,
    isResolvingIdentity,
    matchedAppointment,
    onAppointmentCheckIn,
    services,
    staff
}: any) => {
    const usePrimaryContact = () => { if (primaryMember) onUpdate({ phone: primaryMember.phone, email: primaryMember.email }); };
    
    const assignedStaff = useMemo(() => {
        if (!matchedAppointment || !staff) return null;
        return staff.find((s: any) => s.id === matchedAppointment.staffId);
    }, [matchedAppointment, staff]);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor={`phone-${member.id}`} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    <Phone className="w-3 h-3 text-primary opacity-60"/>
                    <span>Phone Number</span>
                </Label>
                <div className="kiosk-phone-input">
                    <PhoneInput
                        international
                        defaultCountry="US"
                        value={member.phone || ''}
                        onChange={(value) => onUpdate({ phone: value || '' })}
                        inputComponent={Input as any}
                        placeholder="(555) 000-0000"
                        className="flex h-12 md:h-14 w-full rounded-2xl border-2 border-white/50 bg-white/80 px-4 py-2 text-lg md:text-xl font-bold focus-within:ring-4 focus-within:ring-primary/10 focus-within:border-primary transition-all [&_input]:border-none [&_input]:focus-visible:ring-0 [&_input]:h-auto [&_input]:p-0 [&_input]:bg-transparent shadow-inner text-slate-900"
                    />
                </div>
            </div>

            <div className="space-y-2 text-left">
                <Label htmlFor={`name-${member.id}`} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    <User className="w-3 h-3 text-primary opacity-60"/>
                    <span>Full Name</span>
                </Label>
                <input id={`name-${member.id}`} value={member.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder={member.isPrimary ? "Your name" : "Guest's name"} className="flex h-12 md:h-14 w-full rounded-2xl border-2 border-white/50 bg-white/80 px-4 py-2 text-lg md:text-xl font-bold focus-visible:outline-none focus-visible:ring-4 focus-within:ring-primary/10 focus-visible:border-primary transition-all shadow-inner text-slate-900 placeholder:text-slate-300 uppercase tracking-tight"/>
            </div>

            {isGroup && !member.isPrimary && ( 
                <Button variant="ghost" size="sm" onClick={usePrimaryContact} className="w-full rounded-xl h-10 bg-white/40 backdrop-blur-sm text-slate-500 font-bold uppercase tracking-widest text-[9px]">
                    Use same contact as {primaryMember?.name.split(' ')[0] || '1st guest'}
                </Button> 
            )}

            <div className="space-y-2 text-left">
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
                
                {matchedAppointment && !bannedClient && !existingClientWithBalance && (
                    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="p-6 md:p-8 rounded-[2rem] border-2 border-primary/10 bg-white/80 backdrop-blur-xl shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Sparkles className="w-20 h-20 text-primary" />
                        </div>
                        
                        <div className="flex flex-col items-center text-center space-y-6 relative z-10">
                            <div className="space-y-2">
                                <div className="inline-flex items-center gap-2 bg-primary/5 px-4 py-1 rounded-full border border-primary/10 mb-2">
                                    <CheckCircle2 className="w-3 h-3 text-primary" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Identity Confirmed</span>
                                </div>
                                <h4 className="text-xl md:text-3xl font-bold uppercase tracking-tighter text-slate-900 leading-none">
                                    Welcome, {member.name.split(' ')[0]}
                                </h4>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest opacity-60">Your session is ready for check-in.</p>
                            </div>

                            <Card className="w-full bg-muted/10 border-2 rounded-2xl shadow-inner overflow-hidden">
                                <CardContent className="p-5 flex flex-col items-center gap-4">
                                    <div className="flex items-center gap-4 w-full">
                                        <div className="relative shrink-0">
                                            <Avatar className="w-12 h-12 border-2 border-white shadow-lg rounded-xl">
                                                <AvatarImage src={assignedStaff?.avatarUrl} className="object-cover" />
                                                <AvatarFallback className="font-bold bg-primary/5 text-primary uppercase text-[10px]">{(assignedStaff?.name || 'S').charAt(0)}</AvatarFallback>
                                            </Avatar>
                                        </div>
                                        <div className="text-left min-w-0">
                                            <p className="text-[9px] font-bold uppercase text-primary/60 tracking-widest mb-0.5">With {assignedStaff?.name.split(' ')[0] || 'Pro'}</p>
                                            <p className="font-bold text-sm md:text-base uppercase tracking-tight text-slate-900 truncate">
                                                {services.find((s: any) => s.id === matchedAppointment.serviceId)?.name}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1 text-[9px] font-bold uppercase text-muted-foreground opacity-60">
                                                <Clock className="w-2.5 h-2.5" />
                                                {format(safeDate(matchedAppointment.startTime), 'h:mm a')}
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Button 
                                className="w-full h-14 md:h-16 text-sm md:text-lg font-black uppercase shadow-xl shadow-primary/20 rounded-2xl active:scale-95 transition-all group tracking-[0.1em]" 
                                onClick={() => onAppointmentCheckIn(matchedAppointment)}
                            >
                                Confirm Check-In
                                <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5 transition-transform group-hover:translate-x-1" />
                            </Button>
                        </div>
                    </motion.div>
                )}

                {bannedClient && (
                    <motion.div key="banned" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                        <Alert variant="destructive" className="bg-destructive/5 border-destructive shadow-xl border-2 rounded-2xl p-6 text-left">
                            <Ban className="h-5 w-5" />
                            <AlertTitle className="text-xs font-bold uppercase tracking-tight mb-1 text-left">Check-in Restricted</AlertTitle>
                            <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase text-left">
                                Account restricted. Please see the desk for assistance.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}
                {existingClientWithBalance && !bannedClient && (
                    <motion.div key="balance" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-2 rounded-2xl p-6 shadow-xl text-left">
                            <Wallet className="h-5 w-5" />
                            <AlertTitle className="text-xs font-bold uppercase tracking-tight mb-1 text-left">Balance Alert</AlertTitle>
                            <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase text-left">
                                Balance of <strong>${existingClientWithBalance.outstandingBalance?.toFixed(2)}</strong> found. Settle at desk to join queue.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const StepServices = ({ member, onUpdate, services, pricingTiers }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; services: Service[]; pricingTiers: PricingTier[]; }) => {
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const handleServiceToggle = (serviceId: string) => { 
        onUpdate({ serviceIds: [serviceId] }); 
    };
    const categories = useMemo(() => Array.from(new Set(services.map(s => s.category || 'Standard'))).sort(), [services]);
    
    if (!selectedCategory) {
        return ( <div className="grid grid-cols-1 gap-3 md:gap-4" key="category-selection">{categories.map(category => ( <button key={category} className="w-full p-6 md:p-10 text-xl md:text-3xl font-bold rounded-2xl md:rounded-[2rem] border-2 border-white/50 bg-white/60 backdrop-blur-xl hover:border-primary hover:bg-primary/5 transition-all shadow-lg uppercase tracking-tight text-slate-800" onClick={() => setSelectedCategory(category)}>{category}</button> ))}</div> )
    }
    
    return (
        <div className="space-y-6" key="service-selection-list">
            <button onClick={() => setSelectedCategory(null)} className="mb-2 -ml-2 text-primary font-bold uppercase tracking-widest p-2 transition-all hover:bg-primary/5 rounded-xl flex items-center gap-2 text-[10px] md:text-xs">
                <ArrowLeft className="h-4 w-4"/> Change Category
            </button>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
                {services.filter(s => (s.category || 'Standard') === selectedCategory).map(service => ( 
                    <ServiceSelectionCard 
                        key={service.id} 
                        service={service} 
                        isSelected={member.serviceIds.includes(service.id)} 
                        onToggle={() => handleServiceToggle(service.id)} 
                        pricingTiers={pricingTiers}
                    /> 
                ))}
            </div>
        </div>
    );
};

const StepStaff = ({ member, onUpdate, staff, pricingTiers }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; staff: Staff[]; pricingTiers: PricingTier[]; }) => (
    <div className="space-y-6" key="staff-selection-step">
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

const StepConsents = ({ member, requiredForms, formAnswers, setFormAnswers }: { member: PartyMember, requiredForms: ConsentForm[], formAnswers: Record<string, any>, setFormAnswers: (answers: Record<string, any>) => void }) => (
    <div className="space-y-6 md:space-y-10" key="consent-step text-left">
        {requiredForms.map(form => (
            <div key={form.id} className="space-y-6 md:space-y-8 p-6 md:p-10 rounded-[2rem] border-2 border-white/50 bg-white/60 backdrop-blur-2xl shadow-xl text-left">
                <h3 className="text-xl md:text-2xl font-bold flex items-center gap-3 uppercase tracking-tighter text-slate-900"><FileSignature className="w-6 h-6 md:w-8 md:h-8 text-primary opacity-60" /> {form.title}</h3>
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

const ServiceSelectionCard = ({ service, isSelected, onToggle, pricingTiers }: { service: Service, isSelected: boolean, onToggle: () => void, pricingTiers: PricingTier[] }) => {
    const minPrice = useMemo(() => {
        if (!service.serviceTiers || service.serviceTiers.length === 0) return service.price;
        return Math.min(...service.serviceTiers.map(t => t.price));
    }, [service]);

    return (
        <button onClick={onToggle} className={cn("relative p-4 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border-2 transition-all flex flex-col items-center justify-center gap-3 h-full group", isSelected ? "border-primary bg-primary/5 shadow-xl ring-4 ring-primary/10" : "bg-white/60 border-white/40 hover:border-primary/20 shadow-sm")}>
            <div className={cn("p-3 rounded-2xl bg-primary/5 transition-all group-hover:scale-110", isSelected && "bg-primary text-white shadow-lg")}>
                <Sparkles className={cn("w-6 h-6 md:w-8 md:h-8", isSelected ? "text-white" : "text-primary opacity-40")} />
            </div>
            <div className="text-center space-y-1">
                <p className="font-bold uppercase tracking-tight text-xs md:text-sm text-slate-900 leading-tight">{service.name}</p>
                <p className="text-[10px] md:text-xs font-black text-primary tracking-tighter font-mono">${minPrice.toFixed(0)}+</p>
            </div>
            {isSelected && <div className="absolute top-2 right-2 bg-primary text-white rounded-full p-0.5 shadow-lg"><Check className="w-3 h-3" /></div>}
        </button>
    );
};

type Step = 'partyType' | 'identityChoice' | 'phonePad' | 'memberSetup' | 'confirmation';
type MemberSubStep = 'details' | 'services' | 'consents' | 'staff';

export default function WalkInPage() {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const params = useParams();
  const tenantId = params.tenantId as string;

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
            const matchedClient = { ...matchedClientData, id: matchedClientId };

            if (matchedClient.status === 'banned') {
                setBannedClient(matchedClient);
                setExistingClientWithBalance(null);
                setMatchedAppointment(null);
            } else if (matchedClient.outstandingBalance && matchedClient.outstandingBalance > 0) {
                setExistingClientWithBalance(matchedClient);
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
                
                // If we are in returning flow, pre-populate name and email
                if (clientType === 'returning') {
                    handleMemberUpdate({ name: matchedClient.name, email: matchedClient.email, phone: matchedClient.phone });
                }
            }
        } else {
            setBannedClient(null);
            setExistingClientWithBalance(null);
            setMatchedAppointment(null);
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
  }, [firestore, tenantId, clientType, step]);

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
      await resolveIdentity(undefined, `+1${phonePadValue}`); // Assume US for numpad
      setStep('memberSetup');
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

          const matchedClient = clients?.find(c => c.id === apt.clientId);

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

          if (matchedClient && isBirthdayToday(matchedClient.birthday)) {
              setBirthdayName(matchedClient.name || 'Guest');
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
            let matchedClient = clients?.find(c => (member.email && c.email.toLowerCase() === member.email.toLowerCase()) || (member.phone && c.phone === member.phone));
            let clientId = matchedClient?.id;

            if (matchedClient && isBirthdayToday(matchedClient.birthday)) {
                birthdayMemberName = matchedClient.name || member.name;
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

        {isClosed ? (
            <div className="h-screen flex items-center justify-center bg-background p-4"><ClosedView schedule={scheduleProfiles?.[0]} logoUrl={logoUrl} tenantName={tenant.name} /></div>
        ) : (
            <AnimatePresence mode="wait">
                {!entered ? (
                    <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center cursor-pointer p-4 group z-10" onClick={() => setEntered(true)}>
                        <div className={cn(
                            "relative overflow-hidden mb-12 md:mb-16 transition-all duration-1000 mx-auto",
                            showWordmark ? "w-24 h-24 md:w-32 md:h-32 rounded-2xl md:rounded-3xl" : "w-48 h-48 md:w-64 md:h-64 rounded-3xl md:rounded-[3rem]",
                            logoUrl ? "shadow-2xl border-2 border-white" : "p-8 md:p-12 bg-white/40 backdrop-blur-3xl border-2 border-white/30 group-hover:border-primary/20 group-hover:shadow-primary/10 shadow-xl"
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
                    <motion.div key="content" className="w-full max-w-4xl mx-auto bg-white/40 border-2 border-white/50 rounded-[2.5rem] md:rounded-[4rem] shadow-[0_32px_64px_rgba(0,0,0,0.05)] overflow-hidden backdrop-blur-3xl ring-1 ring-white/20 z-10">
                        {step === 'partyType' && <PartyTypeSelection onSelect={handlePartyTypeSelect} />}
                        {step === 'identityChoice' && <IdentityChoiceView onSelect={handleIdentitySelect} onBack={() => setStep('partyType')} />}
                        {step === 'phonePad' && <PhonePadView value={phonePadValue} onDigit={handlePhonePadDigit} onDelete={handlePhonePadDelete} onConfirm={handlePhonePadConfirm} onBack={() => setStep('identityChoice')} isVerifying={isResolvingIdentity} />}
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
                                onAddAnother={() => { setPartyMembers([...partyMembers, { id: nanoid(5), name: '', serviceIds: [], preferredStaffId: 'any', waitForPreferredStaff: false }]); setCurrentMemberIndex(partyMembers.length); setMemberSubStep('details'); }}
                                onSubmit={handleSubmit} isSubmitting={isSubmitting}
                                bannedClient={bannedClient}
                                existingClientWithBalance={existingClientWithBalance}
                                isResolvingIdentity={isResolvingIdentity}
                                matchedAppointment={matchedAppointment}
                                onAppointmentCheckIn={handleAppointmentCheckIn}
                            />
                        )}
                        {step === 'confirmation' && <ConfirmationScreen confirmedParty={confirmedParty} onPrint={(t) => { setTicketToPrint(t); setIsPrintDialogOpen(true); }} onDone={() => { setEntered(false); setStep('partyType'); setPartyMembers([]); setFormAnswers({}); setMatchedAppointment(null); setPhonePadValue(''); setClientType(null); }} />}
                    </motion.div>
                )}
            </AnimatePresence>
        )}

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
            <DialogContent className="max-w-sm rounded-[2rem] border-2 shadow-3xl p-0 overflow-hidden"><DialogHeader className="p-6 bg-muted/5 border-b"><DialogTitle className="text-xl font-bold uppercase tracking-tight text-center text-slate-900 leading-none">Ticket Issued</DialogTitle></DialogHeader><div className="flex justify-center p-8 bg-white text-center">{ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}</div><DialogFooter className="p-6 border-t bg-muted/5"><Button className="w-full h-12 rounded-xl text-lg font-bold uppercase tracking-widest shadow-xl shadow-primary/20" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Authorize Print</Button></DialogFooter></DialogContent>
        </Dialog>
    </div>
  );
}
