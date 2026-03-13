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
import { useFirebase, useDoc, useCollection, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch, increment, arrayUnion } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember, WalkIn, type PricingTier, type Appointment } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon, Loader, Clock, Trash2, PlusCircle, Check, Printer, DollarSign, Activity, FileSignature, ListChecks, XCircle, Ban, Wallet, AlertTriangle, ArrowDown, Fingerprint, CalendarCheck, CheckCircle2, Star, Zap, Cake, PartyPopper, Gift } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { format, getDay, parseISO, parse, isSameDay, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';
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

type Step = 'partyType' | 'memberSetup' | 'confirmation';
type MemberSubStep = 'details' | 'services' | 'addons' | 'consents' | 'staff';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
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

const ClosedView = ({ schedule }: { schedule: any }) => (
    <div className="text-center space-y-6 max-w-md bg-white/40 backdrop-blur-2xl p-10 rounded-[3rem] border border-white/20 shadow-2xl">
        <div className="inline-block p-6 bg-white/50 rounded-full border border-white/30 mb-4 shadow-inner">
            <Clock className="w-12 h-12 text-primary" />
        </div>
        <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900">Closed</h1>
        <p className="text-sm md:text-base text-slate-600 font-medium leading-relaxed">Our kiosk is only available during business hours. Please come back during our scheduled times or book online.</p>
        {schedule && (
            <div className="p-4 rounded-2xl bg-white/60 border border-white/40 text-sm shadow-sm">
                <p className="font-black text-primary mb-2 uppercase tracking-widest text-[10px]">Today's Hours</p>
                <p className="text-lg font-black text-slate-900">{isBusinessOpen(new Date(), schedule).hours || 'Closed'}</p>
            </div>
        )}
        <Button asChild className="w-full h-14 rounded-2xl shadow-xl text-lg font-black uppercase tracking-tight">
            <Link href="/">Return Home</Link>
        </Button>
    </div>
);

const PartyTypeSelection = ({ onSelect }: { onSelect: (type: 'individual' | 'group') => void }) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full" key="party-type-selection">
        <h2 className="text-3xl md:text-7xl font-black tracking-tighter text-center mb-8 px-4 uppercase text-slate-900 drop-shadow-sm">Welcome</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 p-4 md:p-10">
            <div className="rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-xl shadow-2xl transition-all hover:shadow-primary/30 hover:-translate-y-1 hover:border-primary/50 cursor-pointer group" onClick={() => onSelect('individual')}>
                <div className="p-10 md:p-20 flex flex-col items-center justify-center text-center">
                    <div className="p-6 bg-primary/10 rounded-full mb-6 group-hover:bg-primary/20 transition-colors">
                        <User className="w-12 h-12 md:w-20 md:h-20 text-primary group-hover:scale-110 transition-transform" />
                    </div>
                    <h3 className="text-xl md:text-4xl font-black tracking-tight uppercase text-slate-800">Solo</h3>
                    <p className="text-slate-500 mt-2 text-xs md:text-lg font-bold uppercase tracking-widest opacity-60">Just Me</p>
                </div>
            </div>
             <div className="rounded-[3rem] border-2 border-white/40 bg-white/60 backdrop-blur-xl shadow-2xl transition-all hover:shadow-primary/30 hover:-translate-y-1 hover:border-primary/50 cursor-pointer group" onClick={() => onSelect('group')}>
                <div className="p-10 md:p-20 flex flex-col items-center justify-center text-center">
                    <div className="p-6 bg-primary/10 rounded-full mb-6 group-hover:bg-primary/20 transition-colors">
                        <Users className="w-12 h-12 md:w-20 md:h-20 text-primary group-hover:scale-110 transition-transform" />
                    </div>
                    <h3 className="text-xl md:text-4xl font-black tracking-tight uppercase text-slate-800">My Party</h3>
                    <p className="text-slate-500 mt-2 text-xs md:text-lg font-bold uppercase tracking-widest opacity-60">Group Check-in</p>
                </div>
            </div>
        </div>
    </motion.div>
);

const BirthdayCelebrationView = ({ clientName, onDone }: { clientName: string, onDone: () => void }) => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl">
        <div className="relative w-full max-w-lg bg-white rounded-[3rem] border-4 shadow-3xl overflow-hidden p-10 md:p-16 text-center space-y-10">
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="absolute -top-20 -right-20 opacity-5"><Sparkles className="w-64 h-64 text-primary" /></motion.div>
            </div>
            
            <div className="flex flex-col items-center gap-2 mb-2">
                <Sparkles className="w-10 h-10 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Special Milestone</span>
            </div>

            <motion.div 
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 12, stiffness: 200 }}
                className="w-32 h-32 md:w-48 md:h-48 bg-primary/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-12"
            >
                <PartyPopper className="w-16 h-16 md:w-24 md:h-24 text-primary -rotate-12" />
            </motion.div>
            
            <div className="space-y-3">
                <h2 className="text-3xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                    Happy Birthday, <br/>
                    <span className="text-primary italic font-serif lowercase tracking-normal">{clientName.split(' ')[0]}!</span>
                </h2>
                <p className="text-sm md:text-xl font-medium text-slate-500 leading-relaxed max-w-xs mx-auto">
                    We're thrilled to celebrate with you today. Expect a little something extra during your visit!
                </p>
            </div>

            <div className="p-5 rounded-2xl bg-primary/5 border-2 border-dashed border-primary/20 flex items-center justify-center gap-3 shadow-inner">
                <Gift className="w-5 h-5 text-primary animate-bounce" />
                <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-primary">A birthday surprise awaits you</span>
            </div>

            <Button onClick={onDone} className="w-full h-16 md:h-20 rounded-2xl text-lg md:text-2xl font-black uppercase shadow-2xl shadow-primary/30 group">
                Check In Now <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" />
            </Button>
        </div>
    </motion.div>
);

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
}: { 
    member: PartyMember; 
    onUpdate: (updates: Partial<PartyMember>) => void; 
    primaryMember?: PartyMember; 
    isGroup: boolean; 
    bannedClient: Client | null;
    existingClientWithBalance: Client | null;
    isResolvingIdentity: boolean;
    matchedAppointment: Appointment | null;
    onAppointmentCheckIn: (apt: Appointment) => void;
    services: Service[];
    staff: Staff[];
}) => {
    const usePrimaryContact = () => { if (primaryMember) onUpdate({ phone: primaryMember.phone, email: primaryMember.email }); };
    
    const assignedStaff = useMemo(() => {
        if (!matchedAppointment || !staff) return null;
        return staff.find(s => s.id === matchedAppointment.staffId);
    }, [matchedAppointment, staff]);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor={`phone-${member.id}`} className="flex items-center gap-2 text-xs md:text-sm font-black uppercase tracking-widest text-muted-foreground">
                    <Phone className="w-3.5 h-3.5 text-primary"/>
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
                        className="flex h-12 md:h-16 w-full rounded-2xl border-2 border-white/50 bg-white/80 px-4 py-2 text-lg md:text-2xl font-bold focus-within:ring-4 focus-within:ring-primary/20 focus-within:border-primary transition-all [&_input]:border-none [&_input]:focus-visible:ring-0 [&_input]:h-auto [&_input]:p-0 [&_input]:bg-transparent shadow-inner text-slate-900"
                    />
                </div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 ml-1">Enter phone first for auto-recognition</p>
            </div>

            <div className="space-y-2">
                <Label htmlFor={`name-${member.id}`} className="flex items-center gap-2 text-xs md:text-sm font-black uppercase tracking-widest text-muted-foreground">
                    <User className="w-3.5 h-3.5 text-primary"/>
                    <span>Full Name</span>
                </Label>
                <input id={`name-${member.id}`} value={member.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder={member.isPrimary ? "Enter your name" : "Guest's name"} className="flex h-12 md:h-16 w-full rounded-2xl border-2 border-white/50 bg-white/80 px-4 py-2 text-lg md:text-2xl font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-all shadow-inner text-slate-900 placeholder:text-slate-300"/>
            </div>

            {isGroup && !member.isPrimary && ( 
                <Button variant="outline" size="sm" onClick={usePrimaryContact} className="w-full rounded-xl h-10 border-white/40 bg-white/40 backdrop-blur-sm text-slate-600 font-bold">
                    Same as {primaryMember?.name.split(' ')[0] || 'first guest'}
                </Button> 
            )}

            <div className="space-y-2">
                <Label htmlFor={`email-${member.id}`} className="flex items-center gap-2 text-xs md:text-sm font-black uppercase tracking-widest text-muted-foreground">
                    <Mail className="w-3.5 h-3.5 text-primary"/>
                    <span>Email Address</span>
                </Label>
                <Input id={`email-${member.id}`} type="email" value={member.email || ''} onChange={(e) => onUpdate({ email: e.target.value })} placeholder="jane@example.com" className="h-12 md:h-16 text-lg md:text-2xl font-bold rounded-2xl border-2 border-white/50 bg-white/80 focus-visible:ring-primary shadow-inner text-slate-900"/>
            </div>

            <AnimatePresence>
                {isResolvingIdentity && (
                    <motion.div key="resolving" className="flex items-center justify-center gap-2 text-[10px] uppercase font-black tracking-widest text-primary animate-pulse py-2">
                        <Loader className="w-3 h-3 animate-spin" /> Verifying Profile...
                    </motion.div>
                )}
                
                {matchedAppointment && !bannedClient && !existingClientWithBalance && (
                    <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="p-6 md:p-8 rounded-[3rem] border-4 border-primary/20 bg-white/80 backdrop-blur-xl shadow-2xl shadow-primary/10 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Sparkles className="w-24 h-24 text-primary" />
                        </div>
                        
                        <div className="flex flex-col items-center text-center space-y-6 relative z-10">
                            <div className="space-y-2">
                                <div className="inline-flex items-center gap-2 bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10 mb-2">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Identity Verified</span>
                                </div>
                                <h4 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                                    Welcome Back, {member.name.split(' ')[0]}!
                                </h4>
                                <p className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest opacity-60">We identified your session for today.</p>
                            </div>

                            <Card className="w-full bg-muted/20 border-2 rounded-[2rem] shadow-inner overflow-hidden">
                                <CardContent className="p-6 flex flex-col items-center gap-4">
                                    <div className="flex items-center gap-4 w-full">
                                        <div className="relative shrink-0">
                                            <Avatar className="w-16 h-16 border-4 border-white shadow-xl rounded-2xl">
                                                <AvatarImage src={assignedStaff?.avatarUrl} className="object-cover" />
                                                <AvatarFallback className="font-black bg-primary/10 text-primary uppercase text-sm">{(assignedStaff?.name || 'S').charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div className="absolute -top-1 -right-1 bg-primary text-white p-1 rounded-full shadow-lg border-2 border-white">
                                                <Star className="w-2.5 h-2.5 fill-current" />
                                            </div>
                                        </div>
                                        <div className="text-left min-w-0">
                                            <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest mb-0.5">With {assignedStaff?.name.split(' ')[0] || 'your pro'}</p>
                                            <p className="font-black text-base md:text-lg uppercase tracking-tight text-slate-900 truncate">
                                                {services.find(s => s.id === matchedAppointment.serviceId)?.name}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1.5 text-[10px] font-black uppercase text-muted-foreground opacity-60">
                                                <Clock className="w-3 h-3" />
                                                {format(safeDate(matchedAppointment.startTime), 'h:mm a')}
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Button 
                                className="w-full h-16 md:h-20 text-lg md:text-2xl font-black uppercase shadow-3xl shadow-primary/30 rounded-[2rem] active:scale-95 transition-all group" 
                                onClick={() => onAppointmentCheckIn(matchedAppointment)}
                            >
                                Tap to Check In
                                <ArrowRight className="ml-3 w-6 h-6 md:w-8 md:h-8 transition-transform group-hover:translate-x-2" />
                            </Button>
                        </div>
                    </motion.div>
                )}

                {bannedClient && (
                    <motion.div key="banned" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                        <Alert variant="destructive" className="bg-destructive/10 border-destructive shadow-2xl border-4 rounded-[2rem] p-6">
                            <Ban className="h-6 w-6" />
                            <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Check-in Restricted</AlertTitle>
                            <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase">
                                Your account is currently restricted. Please see the front desk for further assistance.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}
                {existingClientWithBalance && !bannedClient && (
                    <motion.div key="balance" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-2 rounded-[2rem] p-6 shadow-xl">
                            <Wallet className="h-6 w-6" />
                            <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Balance Detected</AlertTitle>
                            <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase">
                                Account balance of <strong>${existingClientWithBalance.outstandingBalance?.toFixed(2)}</strong> found. Please settle at the desk to join the queue.
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
    const categories = useMemo(() => Array.from(new Set(services.map(s => s.category || 'Uncategorized'))).sort(), [services]);
    
    if (!selectedCategory) {
        return ( <div className="grid grid-cols-1 gap-4 md:gap-6" key="category-selection">{categories.map(category => ( <button key={category} className="w-full p-8 md:p-14 text-2xl md:text-5xl font-black rounded-[2.5rem] border-4 border-white/50 bg-white/60 backdrop-blur-xl hover:border-primary hover:bg-primary/5 transition-all shadow-2xl uppercase tracking-tighter text-slate-800" onClick={() => setSelectedCategory(category)}>{category}</button> ))}</div> )
    }
    
    return (
        <div className="space-y-6" key="service-selection-list">
            <button onClick={() => setSelectedCategory(null)} className="mb-2 -ml-2 text-primary font-black uppercase tracking-widest p-3 transition-all hover:bg-primary/10 rounded-xl flex items-center gap-2 text-xs md:text-sm">
                <ArrowLeft className="h-5 w-5"/> Change Category
            </button>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 md:gap-6">
                {services.filter(s => (s.category || 'Uncategorized') === selectedCategory).map(service => ( 
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

const ServiceSelectionCard = ({ service, isSelected, onToggle, staffTierId, pricingTiers }: { service: Service; isSelected: boolean; onToggle: () => void; staffTierId?: string, pricingTiers: PricingTier[] }) => {
    const { priceText, durationText } = useMemo(() => {
        let finalDuration = service.duration;
        let finalPrice = service.price;
        if (service.serviceTiers && service.serviceTiers.length > 0) {
            const prices = service.serviceTiers.map(t => t.price);
            const minPrice = Math.min(...prices);
            return { priceText: `From $${minPrice.toFixed(2)}`, durationText: `${service.duration} min` };
        }
        return { priceText: `$${finalPrice.toFixed(2)}`, durationText: `${finalDuration} min` };
    }, [service]);

    return (
        <div 
            className={cn(
                "block cursor-pointer rounded-2xl border-2 transition-all hover:shadow-2xl h-full overflow-hidden",
                isSelected ? "border-primary ring-4 ring-primary/20 bg-primary/5 shadow-primary/10" : "bg-white/60 backdrop-blur-md border-white/40 shadow-sm"
            )}
            onClick={(e) => {
                e.preventDefault();
                onToggle();
            }}
        >
            <div className="flex flex-col h-full">
                <div className="w-full aspect-video relative bg-muted/20 overflow-hidden">
                    {service.imageUrl ? (
                        <Image src={service.imageUrl} alt={service.name} fill className="object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                            <Sparkles className="w-8 h-8 md:w-12 md:h-12"/>
                        </div>
                    )}
                </div>
                <div className="p-4 text-center flex-1 flex flex-col justify-center">
                    <p className="font-black text-sm md:text-base uppercase tracking-tight line-clamp-1 text-slate-800">{service.name}</p>
                    <div className="flex items-center justify-center gap-3 mt-2">
                        <span className="text-[10px] md:text-xs text-primary font-black uppercase tracking-widest">{priceText}</span>
                        <span className="text-[10px] md:text-xs text-muted-foreground font-black uppercase opacity-60">{durationText}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StepStaff = ({ member, onUpdate, staff, pricingTiers }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; staff: Staff[]; pricingTiers: PricingTier[]; }) => (
    <div className="space-y-6" key="staff-selection-step">
        <RadioGroup value={member.preferredStaffId || 'any'} onValueChange={(staffId) => onUpdate({ preferredStaffId: staffId })} className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
            <StaffSelectionCard staff={{ id: 'any', name: 'First Available', avatarUrl: '' }} pricingTiers={pricingTiers} />
            {staff?.map(s => <StaffSelectionCard key={s.id} staff={s} pricingTiers={pricingTiers} />)}
        </RadioGroup>
        {(member.preferredStaffId && member.preferredStaffId !== 'any') && (
            <div className="flex items-center justify-between rounded-3xl border-2 border-white/50 bg-white/40 backdrop-blur-xl p-6 mt-6 shadow-inner">
                <div className="space-y-1">
                    <Label htmlFor={`wait-${member.id}`} className="font-black text-lg md:text-2xl text-slate-800 uppercase tracking-tight">Wait for Pro?</Label>
                    <p className="text-xs text-muted-foreground uppercase font-black tracking-widest opacity-60">Estimated wait time may increase</p>
                </div>
                <Switch id={`wait-${member.id}`} checked={member.waitForPreferredStaff} onCheckedChange={(checked) => onUpdate({ waitForPreferredStaff: checked })} className="scale-150" />
            </div>
        )}
    </div>
);

const StepConsents = ({ member, requiredForms, formAnswers, setFormAnswers }: { member: PartyMember, requiredForms: ConsentForm[], formAnswers: Record<string, any>, setFormAnswers: (answers: Record<string, any>) => void }) => (
    <div className="space-y-8 md:space-y-12" key="consent-step">
        {requiredForms.map(form => (
            <div key={form.id} className="space-y-6 md:space-y-8 p-6 md:p-12 rounded-[3rem] border-2 border-white/50 bg-white/60 backdrop-blur-2xl shadow-2xl">
                <h3 className="text-2xl md:text-4xl font-black flex items-center gap-4 uppercase tracking-tighter text-slate-900"><FileSignature className="w-8 h-8 md:w-12 md:h-12 text-primary" /> {form.title}</h3>
                <div className="space-y-8 md:space-y-12">
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
        details: { title: 'Personal Info', icon: <User className="w-4 h-4 md:w-6 md:h-6" /> },
        services: { title: 'Treatment', icon: <Sparkles className="w-4 h-4 md:w-6 md:h-6" /> },
        addons: { title: 'Add-ons', icon: <PlusCircle className="w-4 h-4 md:w-6 md:h-6" /> },
        consents: { title: 'Agreements', icon: <FileSignature className="w-4 h-4 md:w-6 md:h-6" /> },
        staff: { title: 'Preferences', icon: <Users className="w-4 h-4 md:w-6 md:h-6" /> },
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
            <div className="p-8 md:p-16 pb-4">
                <div className="flex items-center justify-between gap-4 mb-2 text-left">
                    <h2 className="text-3xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">{isGroup ? `Guest ${member.index + 1}` : 'Guest Check-in'}</h2>
                    {isGroup && <Badge className="bg-primary text-white border-none font-black px-4 py-1.5 rounded-2xl text-sm md:text-xl shadow-lg shadow-primary/20">{member.index + 1} / {partyMembers.length}</Badge>}
                </div>
                <div className="flex items-center gap-3 text-primary font-black uppercase tracking-widest text-xs md:text-lg">
                    {subStepTitles[memberSubStep as MemberSubStep].icon} {subStepTitles[memberSubStep as MemberSubStep].title}
                </div>
                <div className="pt-8 md:pt-12"><Progress value={progress} className="h-2 md:h-3 rounded-full bg-white/20" /></div>
            </div>

            <div className="p-8 md:p-16 pt-4 md:pt-8 text-left">
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

            <div className="p-8 md:p-16 pt-0 flex flex-col sm:flex-row gap-4 md:gap-6 mt-4">
                <Button variant="ghost" size="lg" onClick={onBack} disabled={isSubmitting} className="text-slate-400 hover:text-slate-600 hover:bg-white/40 h-16 md:h-24 text-lg md:text-3xl font-black rounded-3xl uppercase tracking-tighter">Back</Button>
                <div className="hidden sm:block flex-1" />
                {hasNextSubStep ? (
                    <Button 
                        size="lg" 
                        onClick={() => onNext(subSteps[currentSubStepIndex + 1])} 
                        disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                        className="h-16 md:h-24 px-12 md:px-20 text-xl md:text-4xl font-black rounded-[2rem] shadow-2xl shadow-primary/30 group uppercase tracking-tighter"
                    >
                        Continue <ArrowRight className="ml-3 w-8 h-8 md:w-12 md:h-12 transition-transform group-hover:translate-x-2"/>
                    </Button>
                ) : (
                    <div className="flex flex-col sm:flex-row gap-4 md:gap-6">
                        {isGroup && !isLastMember && (
                            <Button 
                                size="lg" 
                                variant="outline" 
                                onClick={onAddAnother} 
                                disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                                className="h-16 md:h-24 px-10 md:px-14 text-lg md:text-3xl font-black rounded-[2rem] border-4 border-primary text-primary hover:bg-primary/5 uppercase tracking-tighter"
                            >
                                Next Guest
                            </Button>
                        )}
                        <Button 
                            size="lg" 
                            onClick={onSubmit} 
                            disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                            className="h-16 md:h-24 px-12 md:px-24 text-xl md:text-4xl font-black rounded-[2rem] shadow-2xl shadow-primary/40 uppercase tracking-tighter"
                        >
                            {isSubmitting ? <Loader className="animate-spin" /> : 'Finish'}
                        </Button>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

const ConfirmationScreen = ({ confirmedParty, onPrint, onDone }: { confirmedParty: WalkInTicketData[], onPrint: (t: WalkInTicketData) => void, onDone: () => void }) => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-10 md:p-24 text-center space-y-10 md:space-y-16" key="confirmation-screen">
        <div className="w-24 h-24 md:w-40 md:h-40 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/10 rotate-12">
            <CheckCircle className="w-14 h-14 md:w-24 md:h-24 text-green-500 -rotate-12" />
        </div>
        <div className="space-y-4">
            <h2 className="text-4xl md:text-8xl font-black tracking-tighter uppercase text-slate-900 drop-shadow-sm">You're in!</h2>
            <p className="text-slate-500 text-lg md:text-3xl font-bold uppercase tracking-widest opacity-70">Watch for our text notification.</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto">
            {confirmedParty.map(ticket => (
                <Card key={ticket.id} className="bg-white/80 backdrop-blur-md border-2 border-white/50 rounded-[2.5rem] text-left shadow-2xl group overflow-hidden">
                    <CardContent className="p-6 md:p-10 flex justify-between items-center">
                        <div className="space-y-1">
                            <p className="text-[10px] md:text-xs text-primary font-black uppercase tracking-widest opacity-60 mb-1">Queue Spot</p>
                            <p className="font-black text-2xl md:text-5xl uppercase tracking-tighter text-slate-900">#{ticket.queuePosition}</p>
                            <p className="text-xs md:text-lg font-bold text-slate-500 uppercase tracking-tight truncate max-w-[150px]">{ticket.name}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => onPrint(ticket)} className="text-primary hover:bg-primary/10 rounded-3xl h-14 w-14 md:h-20 md:w-20 transition-all active:scale-90 bg-white/50 border border-white shadow-sm">
                            <Printer className="w-7 h-7 md:w-10 md:h-10" />
                        </Button>
                    </CardContent>
                </Card>
            ))}
        </div>

        <div className="pt-10 md:pt-16">
            <Button size="lg" onClick={onDone} className="h-16 md:h-28 px-16 md:px-32 text-2xl md:text-5xl font-black rounded-[2.5rem] md:rounded-[3.5rem] uppercase tracking-widest shadow-2xl shadow-primary/30 transition-all hover:scale-105 active:scale-95">Complete</Button>
        </div>
    </motion.div>
);

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

  const isBirthdayToday = (birthdayStr?: string) => {
    if (!birthdayStr) return false;
    const birth = safeDate(birthdayStr);
    const today = new Date();
    // CRITICAL FIX: Only compare month and date to ignore birth year mismatch
    return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  };

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
            }
        } else {
            setBannedClient(null);
            setExistingClientWithBalance(null);
            setMatchedAppointment(null);
        }
    } catch (e) {
        console.error("Identity resolution failed", e);
    } finally {
        setIsResolvingIdentity(false);
    }
  }, [firestore, tenantId]);

  useEffect(() => {
    const currentMember = partyMembers[currentMemberIndex];
    if (!currentMember) return;

    const timer = setTimeout(() => {
        if ((currentMember.email && currentMember.email.includes('@')) || (currentMember.phone && currentMember.phone.length > 5)) {
            resolveIdentity(currentMember.email, currentMember.phone);
        }
    }, 500);
    return () => clearTimeout(timer);
  }, [partyMembers, currentMemberIndex, resolveIdentity]);

  const handlePartyTypeSelect = (type: 'individual' | 'group') => {
    setIsGroup(type === 'group');
    setPartyMembers([{ id: nanoid(5), name: '', serviceIds: [], isPrimary: true, preferredStaffId: 'any', waitForPreferredStaff: false }]);
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
            setStep('partyType');
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

          if (isBirthdayToday(matchedClient?.birthday)) {
              setBirthdayName(matchedClient?.name || 'Guest');
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

            if (isBirthdayToday(matchedClient?.birthday)) {
                birthdayMemberName = matchedClient?.name || member.name;
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

  const activeStaff = useMemo(() => {
    return (staff || []).filter(s => s.active && !s.onBreak);
  }, [staff]);

  if (!tenant || !services) return <div className="h-screen flex items-center justify-center bg-background"><Loader className="animate-spin text-primary w-10 h-10" /></div>;
  if (isClosed) return <div className="h-screen flex items-center justify-center bg-background p-4"><ClosedView schedule={scheduleProfiles?.[0]} /></div>;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-blue-50 via-white to-purple-50 text-foreground flex flex-col items-center justify-center p-4 overflow-x-hidden font-body relative">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-200/20 blur-[120px] rounded-full animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-200/20 blur-[120px] rounded-full animate-pulse" />
        </div>

        <AnimatePresence mode="wait">
            {!entered ? (
                <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center cursor-pointer p-4 group z-10" onClick={() => setEntered(true)}>
                    <div className="inline-block p-10 md:p-16 bg-white/60 backdrop-blur-3xl rounded-full shadow-[0_20px_50px_rgba(8,_112,_184,_0.1)] mb-12 md:mb-20 border-2 border-white/50 group-hover:border-primary group-hover:shadow-primary/20 transition-all duration-700 active:scale-95"><ClarityFlowLogo className="w-16 h-16 md:w-32 md:h-32" /></div>
                    <h1 className="text-5xl md:text-[10rem] font-black tracking-tighter mb-8 uppercase text-slate-900 drop-shadow-sm leading-none">Welcome</h1>
                    <p className="text-primary text-sm md:text-4xl font-black tracking-[0.3em] uppercase animate-pulse drop-shadow-sm">Tap to Begin</p>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 1 }} className="mt-16 md:mt-24 flex justify-center">
                        <ArrowDown className="w-8 h-8 md:w-12 md:h-12 animate-bounce text-slate-400" />
                    </motion.div>
                </motion.div>
            ) : (
                <motion.div key="content" className="w-full max-w-5xl mx-auto bg-white/60 border-4 border-white/50 rounded-[3rem] md:rounded-[5rem] shadow-[0_32px_64px_rgba(0,0,0,0.1)] overflow-hidden backdrop-blur-3xl ring-1 ring-white/20 z-10">
                    {step === 'partyType' && <PartyTypeSelection onSelect={handlePartyTypeSelect} />}
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
                    {step === 'confirmation' && <ConfirmationScreen confirmedParty={confirmedParty} onPrint={(t) => { setTicketToPrint(t); setIsPrintDialogOpen(true); }} onDone={() => { setEntered(false); setStep('partyType'); setPartyMembers([]); setFormAnswers({}); setMatchedAppointment(null); }} />}
                </motion.div>
            )}
        </AnimatePresence>

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
            <DialogContent className="max-w-sm rounded-3xl"><DialogHeader><DialogTitle className="text-xl font-black uppercase text-center text-slate-900">Ticket Ready</DialogTitle></DialogHeader><div className="flex justify-center p-4">{ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}</div><DialogFooter><Button className="w-full h-14 rounded-2xl text-xl font-black uppercase shadow-xl" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Print & Close</Button></DialogFooter></DialogContent>
        </Dialog>
    </div>
  );
}