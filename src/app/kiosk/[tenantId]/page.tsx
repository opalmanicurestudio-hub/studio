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
import { useFirebase, useDoc, addDocumentNonBlocking, useCollection, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember, WalkIn, type PricingTier, type Appointment } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon, Loader, Clock, Trash2, PlusCircle, Check, Printer, DollarSign, Scissors, FileSignature, ListChecks, XCircle, Ban, Wallet, AlertTriangle, ArrowDown, Fingerprint, CalendarCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, getDay, parseISO, parse, isSameDay } from 'date-fns';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
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
    <div className="text-center space-y-6 max-w-md">
        <div className="inline-block p-6 bg-slate-900/50 rounded-full border border-slate-800 mb-4">
            <Clock className="w-12 h-12 text-primary" />
        </div>
        <h1 className="text-2xl md:text-4xl font-bold text-white">We're Currently Closed</h1>
        <p className="text-sm md:text-base text-slate-400">Our self-check-in kiosk is only available during business hours. Please come back during our scheduled times or book an appointment online.</p>
        {schedule && (
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-sm">
                <p className="font-bold text-primary mb-2 uppercase tracking-widest text-[10px]">Today's Hours</p>
                <p className="text-white text-lg">{isBusinessOpen(new Date(), schedule).hours || 'Closed'}</p>
            </div>
        )}
        <Button asChild variant="outline" className="w-full border-slate-700 text-slate-300 h-12">
            <Link href="/">Return Home</Link>
        </Button>
    </div>
);

const PartyTypeSelection = ({ onSelect }: { onSelect: (type: 'individual' | 'group') => void }) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full" key="party-type-selection">
        <h2 className="text-2xl md:text-6xl font-black tracking-tighter text-center mb-8 px-4 text-white uppercase">Who's joining us?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 p-4 md:p-10">
            <div className="rounded-3xl border-2 border-slate-700 bg-slate-800/50 text-slate-100 shadow-xl transition-all hover:shadow-primary/20 hover:-translate-y-1 hover:border-primary cursor-pointer group" onClick={() => onSelect('individual')}>
                <div className="p-8 md:p-16 flex flex-col items-center justify-center text-center">
                    <User className="w-12 h-12 md:w-16 md:h-16 mb-4 md:mb-6 text-primary group-hover:scale-110 transition-transform" />
                    <h3 className="text-xl md:text-3xl font-black tracking-tight uppercase">Solo Arrival</h3>
                    <p className="text-slate-400 mt-2 text-xs md:text-base font-medium">Single guest check-in</p>
                </div>
            </div>
             <div className="rounded-3xl border-2 border-slate-700 bg-slate-800/50 text-slate-100 shadow-xl transition-all hover:shadow-primary/20 hover:-translate-y-1 hover:border-primary cursor-pointer group" onClick={() => onSelect('group')}>
                <div className="p-8 md:p-16 flex flex-col items-center justify-center text-center">
                    <Users className="w-12 h-12 md:w-16 md:h-16 mb-4 md:mb-6 text-primary group-hover:scale-110 transition-transform" />
                    <h3 className="text-xl md:text-3xl font-black tracking-tight uppercase">My Group</h3>
                    <p className="text-slate-400 mt-2 text-xs md:text-base font-medium">Multiple guests together</p>
                </div>
            </div>
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
    services
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
}) => {
    const usePrimaryContact = () => { if (primaryMember) onUpdate({ phone: primaryMember.phone, email: primaryMember.email }); };
    
    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor={`name-${member.id}`} className="flex items-center gap-2 text-xs md:text-sm font-black uppercase tracking-widest text-slate-400">
                    <User className="w-3.5 h-3.5 text-primary"/>
                    <span>Full Name</span>
                </Label>
                <input id={`name-${member.id}`} value={member.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder={member.isPrimary ? "Enter your name" : "Guest's name"} className="flex h-12 md:h-14 w-full rounded-2xl border-2 border-slate-700 bg-slate-900/50 px-4 py-2 text-lg md:text-xl text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-all"/>
            </div>
            {isGroup && !member.isPrimary && ( 
                <Button variant="outline" size="sm" onClick={usePrimaryContact} className="w-full border-slate-700 text-slate-400 hover:text-slate-100 rounded-xl h-10">
                    Same as {primaryMember?.name.split(' ')[0] || 'first guest'}
                </Button> 
            )}
            <div className="space-y-2">
                <Label htmlFor={`phone-${member.id}`} className="flex items-center gap-2 text-xs md:text-sm font-black uppercase tracking-widest text-slate-400">
                    <Phone className="w-3.5 h-3.5 text-primary"/>
                    <span>Phone Number</span>
                </Label>
                <div className="kiosk-phone-input">
                    <PhoneInput
                        international
                        defaultCountry="US"
                        value={member.phone || ''}
                        onChange={(value) => onUpdate({ phone: value || '' })}
                        inputComponent={Input}
                        placeholder="(555) 000-0000"
                        className="flex h-12 md:h-14 w-full rounded-2xl border-2 border-slate-700 bg-slate-900/50 px-4 py-2 text-lg md:text-xl text-slate-100 focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all [&_input]:border-none [&_input]:focus-visible:ring-0 [&_input]:h-auto [&_input]:p-0"
                    />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor={`email-${member.id}`} className="flex items-center gap-2 text-xs md:text-sm font-black uppercase tracking-widest text-slate-400">
                    <Mail className="w-3.5 h-3.5 text-primary"/>
                    <span>Email Address</span>
                </Label>
                <Input id={`email-${member.id}`} type="email" value={member.email || ''} onChange={(e) => onUpdate({ email: e.target.value })} placeholder="jane@example.com" className="h-12 md:h-14 text-lg md:text-xl rounded-2xl border-2 bg-slate-900/50 border-slate-700 text-slate-100 focus-visible:ring-primary"/>
            </div>

            <AnimatePresence>
                {isResolvingIdentity && (
                    <motion.div key="resolving" className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-slate-500 animate-pulse">
                        <Loader className="w-3 h-3 animate-spin" /> Verifying Profile...
                    </motion.div>
                )}
                
                {matchedAppointment && !bannedClient && !existingClientWithBalance && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl border-2 border-primary bg-primary/10 shadow-lg shadow-primary/10">
                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-primary rounded-full mt-1">
                                <CalendarCheck className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-black text-white uppercase tracking-tight text-sm">Welcome back, {member.name.split(' ')[0]}!</h4>
                                <p className="text-xs text-slate-300 font-medium">We found your appointment today:</p>
                                <div className="mt-2 p-2 bg-slate-900/50 rounded-lg border border-primary/20">
                                    <p className="font-bold text-primary text-xs uppercase truncate">{services.find(s => s.id === matchedAppointment.serviceId)?.name}</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase">{format(safeDate(matchedAppointment.startTime), 'h:mm a')}</p>
                                </div>
                                <Button className="w-full mt-4 h-12 text-base font-black uppercase shadow-xl" onClick={() => onAppointmentCheckIn(matchedAppointment)}>
                                    Check In Now
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {bannedClient && (
                    <motion.div key="banned" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                        <Alert variant="destructive" className="bg-destructive/10 border-destructive shadow-sm border-2 rounded-2xl">
                            <Ban className="h-4 w-4 text-white" />
                            <AlertTitle className="text-xs font-black uppercase tracking-tight">Check-in Restricted</AlertTitle>
                            <AlertDescription className="text-xs mt-1 text-slate-200 font-medium">
                                Account restricted. Please see the front desk for further assistance.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}
                {existingClientWithBalance && !bannedClient && (
                    <motion.div key="balance" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 border-2 rounded-2xl">
                            <Wallet className="h-4 w-4 text-white" />
                            <AlertTitle className="text-xs font-black uppercase tracking-tight">Outstanding Balance Notice</AlertTitle>
                            <AlertDescription className="text-xs mt-1 text-slate-200 font-medium">
                                Balance of <strong>${existingClientWithBalance.outstandingBalance?.toFixed(2)}</strong> found. Please settle at the desk to join the queue.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}
            </AnimatePresence>

            <style jsx global>{`
                .kiosk-phone-input .PhoneInputCountry {
                    margin-right: 12px;
                }
                .kiosk-phone-input .PhoneInputCountryIcon {
                    width: 32px;
                    height: 24px;
                }
            `}</style>
        </div>
    );
};

const ServiceSelectionCard = ({ service, isSelected, onToggle, staffTierId, pricingTiers }: { service: Service; isSelected: boolean; onToggle: () => void; staffTierId?: string, pricingTiers: PricingTier[] }) => {
    const { priceText, durationText, hasTiers } = useMemo(() => {
        let finalDuration = service.duration;
        let finalPrice = service.price;
        let hasTiers = false;
        const staffTier = pricingTiers.find(t => t.id === staffTierId);
        if (staffTierId && staffTier) {
            const tierInfo = service.serviceTiers?.find(t => t.tierId === staffTierId);
            if (tierInfo) {
                finalDuration = tierInfo.durationMinutes;
                finalPrice = tierInfo.price;
                return { priceText: `$${finalPrice.toFixed(2)}`, durationText: `${finalDuration} min`, hasTiers: true };
            }
        }
        if (service.serviceTiers && service.serviceTiers.length > 0) {
            hasTiers = true;
            const prices = service.serviceTiers.map(t => t.price);
            const minPrice = Math.min(...prices);
            return { priceText: `From $${minPrice.toFixed(2)}`, durationText: `${finalDuration} min`, hasTiers };
        }
        return { priceText: `$${finalPrice.toFixed(2)}`, durationText: `${service.duration} min`, hasTiers: false };
    }, [service, staffTierId, pricingTiers]);

    return (
        <div 
            className={cn(
                "block cursor-pointer rounded-2xl border-2 transition-all hover:shadow-lg h-full overflow-hidden",
                isSelected ? "border-primary ring-2 ring-primary bg-primary/10 shadow-primary/20" : "border-slate-700 bg-slate-800/50"
            )}
            onClick={(e) => {
                e.preventDefault();
                onToggle();
            }}
        >
            <div className="flex flex-col h-full">
                <div className="w-full aspect-video relative bg-slate-700/50 overflow-hidden">
                    {service.imageUrl ? (
                        <Image src={service.imageUrl} alt={service.name} fill className="object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <Scissors className="w-6 h-6 md:w-8 md:h-8"/>
                        </div>
                    )}
                </div>
                <div className="p-3 text-center flex-1 flex flex-col justify-center">
                    <p className="font-bold text-xs md:text-sm text-slate-100 uppercase tracking-tight line-clamp-1">{service.name}</p>
                    <div className="flex items-center justify-center gap-2 mt-1">
                        <span className="text-[9px] md:text-[10px] text-primary font-black uppercase">{priceText}</span>
                        <span className="text-[9px] md:text-[10px] text-slate-500 font-bold uppercase">{durationText}</span>
                    </div>
                </div>
            </div>
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
        return ( <div className="grid grid-cols-1 gap-3 md:gap-4" key="category-selection">{categories.map(category => ( <button key={category} className="w-full p-6 md:p-10 text-xl md:text-3xl font-black rounded-[2rem] border-2 border-slate-700 bg-slate-800/50 text-slate-100 hover:border-primary hover:bg-primary/5 transition-all shadow-xl uppercase tracking-tighter" onClick={() => setSelectedCategory(category)}>{category}</button> ))}</div> )
    }
    
    return (
        <div className="space-y-4" key="service-selection-list">
            <button onClick={() => setSelectedCategory(null)} className="mb-2 -ml-2 text-slate-400 hover:text-slate-100 flex items-center gap-2 text-xs font-black uppercase tracking-widest p-2 transition-colors">
                <ArrowLeft className="h-4 w-4"/> Change Category
            </button>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
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

const StepStaff = ({ member, onUpdate, staff, pricingTiers }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; staff: Staff[]; pricingTiers: PricingTier[]; }) => (
    <div className="space-y-4" key="staff-selection-step">
        <RadioGroup value={member.preferredStaffId || 'any'} onValueChange={(staffId) => onUpdate({ preferredStaffId: staffId })} className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            <StaffSelectionCard staff={{ id: 'any', name: 'Any Available', avatarUrl: '' }} pricingTiers={pricingTiers} />
            {staff?.map(s => <StaffSelectionCard key={s.id} staff={s} pricingTiers={pricingTiers} />)}
        </RadioGroup>
        {(member.preferredStaffId && member.preferredStaffId !== 'any') && (
            <div className="flex items-center justify-between rounded-2xl border-2 border-slate-700 bg-slate-800/50 p-4 mt-4 shadow-inner">
                <div className="space-y-0.5">
                    <Label htmlFor={`wait-${member.id}`} className="font-bold text-slate-200 text-sm md:text-lg">Wait for Professional?</Label>
                    <p className="text-[10px] text-slate-500 uppercase font-black">Estimated wait time may increase</p>
                </div>
                <Switch id={`wait-${member.id}`} checked={member.waitForPreferredStaff} onCheckedChange={(checked) => onUpdate({ waitForPreferredStaff: checked })} />
            </div>
        )}
    </div>
);

const StepConsents = ({ member, requiredForms, formAnswers, setFormAnswers }: { member: PartyMember, requiredForms: ConsentForm[], formAnswers: Record<string, any>, setFormAnswers: (answers: Record<string, any>) => void }) => (
    <div className="space-y-6 md:space-y-8" key="consent-step">
        {requiredForms.map(form => (
            <div key={form.id} className="space-y-4 md:space-y-6 p-4 md:p-8 rounded-[2rem] border-2 border-slate-700 bg-slate-800/30 shadow-2xl">
                <h3 className="text-xl md:text-3xl font-black flex items-center gap-3 text-slate-100 uppercase tracking-tighter"><FileSignature className="w-6 h-6 md:w-8 md:h-8 text-primary" /> {form.title}</h3>
                <div className="space-y-6 md:space-y-10">
                    {form.fields?.map(field => (
                        <div key={field.id} className="text-slate-200">
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
        services: { title: 'Treatment', icon: <Scissors className="w-4 h-4 md:w-5 md:h-5" /> },
        addons: { title: 'Add-ons', icon: <PlusCircle className="w-4 h-4 md:w-5 md:h-5" /> },
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
            <div className="p-6 md:p-12 pb-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                    <h2 className="text-2xl md:text-5xl font-black tracking-tighter text-white uppercase">{isGroup ? `Guest ${member.index + 1}` : 'Guest Check-in'}</h2>
                    {isGroup && <Badge className="bg-primary/20 text-primary border-none font-black px-3 py-1 rounded-lg text-xs md:text-sm">{member.index + 1} / {partyMembers.length}</Badge>}
                </div>
                <div className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] md:text-xs">
                    {subStepTitles[memberSubStep as MemberSubStep].icon} {subStepTitles[memberSubStep as MemberSubStep].title}
                </div>
                <div className="pt-6 md:pt-8"><Progress value={progress} className="h-1 md:h-1.5 bg-slate-800" /></div>
            </div>

            <div className="p-6 md:p-12 pt-4 md:pt-6">
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
                            />
                        )}
                        {memberSubStep === 'services' && <StepServices key="step-services" member={member} onUpdate={onUpdate} services={services} staff={staff} pricingTiers={pricingTiers}/>}
                        {memberSubStep === 'consents' && <StepConsents key="step-consents" member={member} requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} />}
                        {memberSubStep === 'staff' && <StepStaff key="step-staff" member={member} onUpdate={onUpdate} staff={staff} pricingTiers={pricingTiers} />}
                    </motion.div>
                </AnimatePresence>
            </div>

            <Separator className="bg-slate-800/50" />
            <div className="p-6 md:p-12 flex flex-col sm:flex-row gap-3 md:gap-4">
                <Button variant="ghost" size="lg" onClick={onBack} disabled={isSubmitting} className="text-slate-500 hover:text-slate-100 hover:bg-slate-800/50 h-14 md:h-16 text-sm md:text-xl font-bold rounded-2xl">Back</Button>
                <div className="hidden sm:block flex-1" />
                {hasNextSubStep ? (
                    <Button 
                        size="lg" 
                        onClick={() => onNext(subSteps[currentSubStepIndex + 1])} 
                        disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                        className="h-14 md:h-16 px-10 md:px-14 text-lg md:text-2xl font-black rounded-2xl shadow-xl shadow-primary/20 group"
                    >
                        Continue <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1"/>
                    </Button>
                ) : (
                    <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                        {isGroup && !isLastMember && (
                            <Button 
                                size="lg" 
                                variant="outline" 
                                onClick={onAddAnother} 
                                disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                                className="h-14 md:h-16 border-slate-700 text-slate-300 px-8 md:px-10 text-sm md:text-xl font-bold rounded-2xl"
                            >
                                Next Guest
                            </Button>
                        )}
                        <Button 
                            size="lg" 
                            onClick={onSubmit} 
                            disabled={isSubmitting || (memberSubStep === 'details' && (!!bannedClient || !!existingClientWithBalance || isResolvingIdentity))} 
                            className="h-14 md:h-16 px-10 md:px-16 text-lg md:text-2xl font-black rounded-2xl shadow-2xl shadow-primary/30 uppercase tracking-tight"
                        >
                            {isSubmitting ? <Loader className="animate-spin" /> : 'Join Queue'}
                        </Button>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

const ConfirmationScreen = ({ confirmedParty, onPrint, onDone }: { confirmedParty: WalkInTicketData[], onPrint: (t: WalkInTicketData) => void, onDone: () => void }) => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-8 md:p-20 text-center space-y-8 md:space-y-12" key="confirmation-screen">
        <div className="w-20 h-20 md:w-32 md:h-32 bg-green-500/20 rounded-full flex items-center justify-center mx-auto shadow-2xl shadow-green-500/20">
            <CheckCircle className="w-12 h-12 md:w-20 md:h-20 text-green-500" />
        </div>
        <div className="space-y-3">
            <h2 className="text-3xl md:text-6xl font-black tracking-tighter text-white uppercase">In line!</h2>
            <p className="text-slate-400 text-sm md:text-2xl font-medium">Watch for our text notification.</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 max-w-3xl mx-auto">
            {confirmedParty.map(ticket => (
                <Card key={ticket.id} className="bg-slate-800/30 border-2 border-slate-700 rounded-[2rem] text-left shadow-xl">
                    <CardContent className="p-5 md:p-8 flex justify-between items-center">
                        <div>
                            <p className="font-black text-white text-base md:text-2xl uppercase tracking-tighter">{ticket.name}</p>
                            <p className="text-[10px] md:text-xs text-primary font-black uppercase tracking-widest mt-1">Queue: #{ticket.queuePosition}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => onPrint(ticket)} className="text-primary hover:bg-primary/10 rounded-xl h-10 w-10 md:h-14 md:w-14">
                            <Printer className="w-5 h-5 md:w-8 md:h-8" />
                        </Button>
                    </CardContent>
                </Card>
            ))}
        </div>

        <div className="pt-8 md:pt-12">
            <Button size="lg" onClick={onDone} className="h-14 md:h-20 px-12 md:px-20 text-xl md:text-3xl font-black rounded-3xl uppercase tracking-widest shadow-2xl shadow-primary/20">Finish</Button>
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
                
                // Search for TODAY'S active appointment
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
    if (memberSubStep === 'details' && !member.name.trim()) return toast({ variant: 'destructive', title: 'Name Required' });
    
    if (memberSubStep === 'details' && !member.email?.trim()) return toast({ variant: 'destructive', title: 'Email Required' });
    if (memberSubStep === 'details' && !/^\S+@\S+\.\S+$/.test(member.email!)) return toast({ variant: 'destructive', title: 'Invalid Email' });

    if (memberSubStep === 'details') {
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

          // Notify staff
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
              queuePosition: 0, // Not applicable for appointments
              checkInTime: new Date().toISOString(),
          };
          setConfirmedParty([ticketData]);
          setStep('confirmation');
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

    try {
        const queueQuery = query(collection(firestore, `tenants/${tenantId}/walkIns`), where("status", "==", "waiting"));
        const existingQueue = await getDocs(queueQuery);
        let pos = existingQueue.size + 1;

        for (const member of partyMembers) {
            let matchedClient = clients?.find(c => (member.email && c.email.toLowerCase() === member.email.toLowerCase()) || (member.phone && c.phone === member.phone));
            let clientId = matchedClient?.id;

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
        setStep('confirmation');
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: 'Check-in Error' });
    } finally { setIsSubmitting(false); }
  };

  const isClosed = !isBusinessOpen(new Date(), scheduleProfiles?.[0]).open;

  const activeStaff = useMemo(() => {
    return (staff || []).filter(s => s.active && !s.onBreak);
  }, [staff]);

  if (!tenant || !services) return <div className="h-screen flex items-center justify-center bg-slate-950"><Loader className="animate-spin text-primary w-10 h-10" /></div>;
  if (isClosed) return <div className="h-screen flex items-center justify-center bg-slate-950 p-4"><ClosedView schedule={scheduleProfiles?.[0]} /></div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center justify-center p-4 overflow-x-hidden font-body">
        <AnimatePresence mode="wait">
            {!entered ? (
                <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center cursor-pointer p-4 group" onClick={() => setEntered(true)}>
                    <div className="inline-block p-6 md:p-8 bg-slate-900/50 rounded-full shadow-2xl mb-8 md:mb-12 border-2 border-slate-800 group-hover:border-primary group-hover:shadow-primary/20 transition-all duration-500"><ClarityFlowLogo className="!text-white w-12 h-12 md:w-24 md:h-24" /></div>
                    <h1 className="text-4xl md:text-7xl lg:text-9xl font-black tracking-tighter text-white mb-6 uppercase">Welcome</h1>
                    <p className="text-slate-500 text-sm md:text-3xl font-black tracking-[0.2em] uppercase animate-pulse">Tap to Check-in</p>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 1 }} className="mt-12 md:mt-20 flex justify-center">
                        <ArrowDown className="w-6 h-6 md:w-10 md:h-10 animate-bounce text-muted-foreground" />
                    </motion.div>
                </motion.div>
            ) : (
                <motion.div key="content" className="w-full max-w-4xl mx-auto bg-slate-900/40 border-2 border-slate-800 rounded-[2.5rem] md:rounded-[4rem] shadow-2xl overflow-hidden backdrop-blur-3xl ring-1 ring-white/5">
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
        <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
            <DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="text-lg">Ticket Printed</DialogTitle></DialogHeader><div className="flex justify-center p-4">{ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}</div><DialogFooter><Button className="w-full h-12" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Print & Close</Button></DialogFooter></DialogContent>
        </Dialog>
    </div>
  );
}
