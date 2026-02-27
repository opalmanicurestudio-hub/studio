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
import { useFirebase, useDoc, addDocumentNonBlocking, useCollection, useMemoFirebase, setDocumentNonBlocking } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember, WalkIn, type PricingTier } from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon, Loader, Clock, Trash2, PlusCircle, Check, Printer, DollarSign, Scissors, FileSignature, ListChecks, XCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, getDay, parseISO, parse } from 'date-fns';
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

type Step = 'partyType' | 'memberSetup' | 'confirmation';
type MemberSubStep = 'details' | 'services' | 'addons' | 'consents' | 'staff';

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
        <h1 className="text-4xl font-bold text-white">We're Currently Closed</h1>
        <p className="text-slate-400">Our self-check-in kiosk is only available during business hours. Please come back during our scheduled times or book an appointment online.</p>
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
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-8">Who are we serving today?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
            <div className="rounded-2xl border-2 border-slate-700 bg-slate-800/50 text-slate-100 shadow-lg transition-all hover:shadow-primary/20 hover:-translate-y-1 hover:border-primary cursor-pointer" onClick={() => onSelect('individual')}>
                <div className="p-8 md:p-16 flex flex-col items-center justify-center text-center">
                    <User className="w-12 h-12 md:w-16 md:h-16 mb-6 text-primary" />
                    <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Just Me</h3>
                    <p className="text-slate-400 mt-2">I'm checking in for myself.</p>
                </div>
            </div>
             <div className="rounded-2xl border-2 border-slate-700 bg-slate-800/50 text-slate-100 shadow-lg transition-all hover:shadow-primary/20 hover:-translate-y-1 hover:border-primary cursor-pointer" onClick={() => onSelect('group')}>
                <div className="p-8 md:p-16 flex flex-col items-center justify-center text-center">
                    <Users className="w-12 h-12 md:w-16 md:h-16 mb-6 text-primary" />
                    <h3 className="text-3xl md:text-4xl font-bold tracking-tight">My Group</h3>
                    <p className="text-slate-400 mt-2">I'm checking in for myself and others.</p>
                </div>
            </div>
        </div>
    </motion.div>
);

const StepDetails = ({ member, onUpdate, primaryMember, isGroup }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; primaryMember?: PartyMember; isGroup: boolean; }) => {
    const usePrimaryContact = () => { if (primaryMember) onUpdate({ phone: primaryMember.phone, email: primaryMember.email }); };
    return (
        <div className="space-y-6">
            <div className="space-y-2"><Label htmlFor={`name-${member.id}`} className="flex items-center gap-2 text-base text-slate-300"><User className="w-5 h-5 text-primary"/><span>Name</span></Label><Input id={`name-${member.id}`} value={member.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder={member.isPrimary ? "Your Full Name" : "Guest's Name"} className="h-14 text-xl bg-slate-900/50 border-slate-700 text-slate-100"/></div>
            {isGroup && !member.isPrimary && ( <Button variant="outline" onClick={usePrimaryContact} className="w-full border-slate-700 text-slate-300 hover:text-slate-100">Use contact info from {primaryMember?.name.split(' ')[0] || 'first guest'}</Button> )}
            <div className="space-y-2"><Label htmlFor={`phone-${member.id}`} className="flex items-center gap-2 text-base text-slate-300"><Phone className="w-5 h-5 text-primary"/><span>Phone</span></Label><Input id={`phone-${member.id}`} type="tel" value={member.phone || ''} onChange={(e) => onUpdate({ phone: e.target.value })} placeholder="For SMS updates" className="h-14 text-xl bg-slate-900/50 border-slate-700 text-slate-100"/></div>
            <div className="space-y-2"><Label htmlFor={`email-${member.id}`} className="flex items-center gap-2 text-base text-slate-300"><Mail className="w-5 h-5 text-primary"/><span>Email</span></Label><Input id={`email-${member.id}`} type="email" value={member.email || ''} onChange={(e) => onUpdate({ email: e.target.value })} placeholder="Optional" className="h-14 text-xl bg-slate-900/50 border-slate-700 text-slate-100"/></div>
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
        return { priceText: `$${finalPrice.toFixed(2)}`, durationText: `${finalDuration} min`, hasTiers: false };
    }, [service, staffTierId, pricingTiers]);

    return (
        <div 
            className={cn(
                "block cursor-pointer rounded-xl border-2 transition-all hover:shadow-lg h-full",
                isSelected ? "border-primary ring-2 ring-primary bg-primary/5 shadow-primary/10" : "border-slate-700 bg-slate-800/50"
            )}
            onClick={(e) => {
                e.preventDefault();
                onToggle();
            }}
        >
            <div className="p-3 flex flex-col items-center justify-between gap-3 h-full">
                <div className="w-full aspect-[4/3] relative bg-slate-700/50 rounded-lg overflow-hidden">
                    {service.imageUrl ? (
                        <Image src={service.imageUrl} alt={service.name} fill className="object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <Scissors className="w-8 h-8"/>
                        </div>
                    )}
                </div>
                <div className="text-center">
                    <p className="font-semibold text-sm text-slate-100">{service.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{durationText} &middot; {priceText}</p>
                    {hasTiers && <p className="text-[10px] text-slate-500">Price varies by provider</p>}
                </div>
            </div>
        </div>
    );
};

const StepServices = ({ member, onUpdate, services, staff, pricingTiers }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; services: Service[]; staff: Staff[]; pricingTiers: PricingTier[]; }) => {
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const handleServiceToggle = (serviceId: string) => { 
        onUpdate({ serviceIds: [serviceId] }); 
    };
    const categories = useMemo(() => Array.from(new Set(services.map(s => s.category || 'Uncategorized'))).sort(), [services]);
    
    if (!selectedCategory) {
        return ( <div className="grid grid-cols-1 gap-4">{categories.map(category => ( <button key={category} className="w-full p-8 text-2xl font-bold rounded-2xl border border-slate-700 bg-slate-800/50 text-slate-100 hover:bg-slate-700/50 transition-colors shadow-lg" onClick={() => setSelectedCategory(category)}>{category}</button> ))}</div> )
    }
    
    return (
        <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setSelectedCategory(null)} className="mb-2 -ml-2 text-slate-400 hover:text-slate-100">
                <ArrowLeft className="mr-2 h-4 w-4"/>Back to Categories
            </Button>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
    <div className="space-y-4">
        <RadioGroup value={member.preferredStaffId || 'any'} onValueChange={(staffId) => onUpdate({ preferredStaffId: staffId })} className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StaffSelectionCard staff={{ id: 'any', name: 'Any Available', avatarUrl: '' }} pricingTiers={pricingTiers} />
            {staff?.map(s => <StaffSelectionCard key={s.id} staff={s} pricingTiers={pricingTiers} />)}
        </RadioGroup>
        {(member.preferredStaffId && member.preferredStaffId !== 'any') && (
            <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 p-4 mt-4">
                <Label htmlFor={`wait-${member.id}`} className="font-medium text-slate-200 text-lg">Wait for {staff?.find(s => s.id === member.preferredStaffId)?.name.split(' ')[0]}?</Label>
                <Switch id={`wait-${member.id}`} checked={member.waitForPreferredStaff} onCheckedChange={(checked) => onUpdate({ waitForPreferredStaff: checked })} />
            </div>
        )}
    </div>
);

const StepConsents = ({ member, requiredForms, formAnswers, setFormAnswers }: { member: PartyMember, requiredForms: ConsentForm[], formAnswers: Record<string, any>, setFormAnswers: (answers: Record<string, any>) => void }) => (
    <div className="space-y-8">
        {requiredForms.map(form => (
            <div key={form.id} className="space-y-6 p-6 rounded-2xl border border-slate-700 bg-slate-800/30">
                <h3 className="text-2xl font-bold flex items-center gap-3 text-slate-100"><FileSignature className="w-6 h-6 text-primary" /> {form.title}</h3>
                <div className="space-y-8">
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
    isSubmitting
}: any) => {
    const subStepTitles = {
        details: { title: 'Guest Details', icon: <User className="w-5 h-5" /> },
        services: { title: 'Select Service', icon: <Scissors className="w-5 h-5" /> },
        addons: { title: 'Add-ons', icon: <PlusCircle className="w-5 h-5" /> },
        consents: { title: 'Important Forms', icon: <FileSignature className="w-5 h-5" /> },
        staff: { title: 'Preferred Staff', icon: <Users className="w-5 h-5" /> },
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="p-6 md:p-8">
                <h2 className="text-4xl font-black tracking-tight text-white">{isGroup ? `Guest ${member.index + 1}` : 'Check-in'}</h2>
                <div className="flex items-center justify-between gap-4 mt-2">
                    <p className="flex items-center gap-2 text-slate-400 font-bold uppercase tracking-widest text-xs">
                        {subStepTitles[memberSubStep as MemberSubStep].icon} {subStepTitles[memberSubStep as MemberSubStep].title}
                    </p>
                    {isGroup && <p className="text-xs font-black text-primary bg-primary/10 px-2 py-1 rounded-md">{member.index + 1} / {partyMembers.length}</p>}
                </div>
                <div className="pt-6"><Progress value={progress} className="h-2 bg-slate-800" /></div>
            </div>

            <div className="p-6 md:p-8 pt-0">
                <AnimatePresence mode="wait">
                    <motion.div key={memberSubStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                        {memberSubStep === 'details' && <StepDetails member={member} onUpdate={onUpdate} isGroup={isGroup} primaryMember={partyMembers?.[0]} />}
                        {memberSubStep === 'services' && <StepServices member={member} onUpdate={onUpdate} services={services} staff={staff} pricingTiers={pricingTiers}/>}
                        {memberSubStep === 'consents' && <StepConsents member={member} requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} />}
                        {memberSubStep === 'staff' && <StepStaff member={member} onUpdate={onUpdate} staff={staff} pricingTiers={pricingTiers} />}
                    </motion.div>
                </AnimatePresence>
            </div>

            <Separator className="bg-slate-800" />
            <div className="p-6 md:p-8 flex flex-col sm:flex-row gap-4">
                <Button variant="ghost" size="lg" onClick={onBack} disabled={isSubmitting} className="text-slate-400 h-14 text-lg">Back</Button>
                <div className="flex-1" />
                {hasNextSubStep ? (
                    <Button size="lg" onClick={() => onNext(subSteps[currentSubStepIndex + 1])} disabled={isSubmitting} className="h-14 px-10 text-xl font-bold">Continue <ArrowRight className="ml-2"/></Button>
                ) : (
                    <div className="flex flex-col sm:flex-row gap-3">
                        {isGroup && !isLastMember && <Button size="lg" variant="outline" onClick={onAddAnother} disabled={isSubmitting} className="h-14 border-slate-700 text-slate-300 px-8 text-lg">Next Guest</Button>}
                        <Button size="lg" onClick={onSubmit} disabled={isSubmitting} className="h-14 px-12 text-xl font-black shadow-xl shadow-primary/20">{isSubmitting ? <Loader className="animate-spin" /> : 'Finish & Join Queue'}</Button>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

const ConfirmationScreen = ({ confirmedParty, onPrint, onDone }: { confirmedParty: WalkInTicketData[], onPrint: (t: WalkInTicketData) => void, onDone: () => void }) => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-8 md:p-16 text-center space-y-8">
        <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-green-500" />
        </div>
        <div className="space-y-2">
            <h2 className="text-5xl font-black tracking-tight text-white">You're in line!</h2>
            <p className="text-slate-400 text-xl">We'll text you as soon as your pro is ready.</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {confirmedParty.map(ticket => (
                <Card key={ticket.id} className="bg-slate-800/30 border-slate-700 text-left">
                    <CardContent className="p-4 flex justify-between items-center">
                        <div>
                            <p className="font-bold text-white">{ticket.name}</p>
                            <p className="text-xs text-slate-400">Position: #{ticket.queuePosition}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => onPrint(ticket)} className="text-primary hover:bg-primary/10">
                            <Printer className="w-5 h-5" />
                        </Button>
                    </CardContent>
                </Card>
            ))}
        </div>

        <div className="pt-8">
            <Button size="lg" onClick={onDone} className="h-16 px-12 text-2xl font-black">Finish</Button>
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

  const handlePartyTypeSelect = (type: 'individual' | 'group') => {
    setIsGroup(type === 'group');
    setPartyMembers([{ id: nanoid(5), name: '', serviceIds: [], isPrimary: true, preferredStaffId: 'any', waitForPreferredStaff: false }]);
    setStep('memberSetup');
  };

  const handleMemberUpdate = (updates: Partial<PartyMember>) => {
    setPartyMembers(prev => prev.map((m, idx) => idx === currentMemberIndex ? { ...m, ...updates } : m));
  };

  const handleNextSubStep = (next: MemberSubStep) => {
    const member = partyMembers[currentMemberIndex];
    if (memberSubStep === 'details' && !member.name.trim()) return toast({ variant: 'destructive', title: 'Missing Name' });
    if (memberSubStep === 'services' && member.serviceIds.length === 0) return toast({ variant: 'destructive', title: 'Select a Service' });
    if (memberSubStep === 'consents') {
        const service = services?.find(s => s.id === member.serviceIds[0]);
        const reqFormIds = service?.requiredFormIds || [];
        const answers = formAnswers[member.id] || {};
        const allDone = reqFormIds.every(id => {
            const f = consentForms?.find(cf => cf.id === id);
            return f?.fields?.every(field => {
                if (field.type === 'heading' || field.type === 'paragraph') return true;
                return answers[id]?.[field.id] !== undefined;
            });
        });
        if (!allDone) return toast({ variant: 'destructive', title: 'Form Incomplete', description: 'Please fill and sign all required forms.' });
    }
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
            let clientId: string | undefined;
            if (member.email) clientId = clients?.find(c => c.email.toLowerCase() === member.email!.toLowerCase())?.id;
            if (!clientId && member.phone) clientId = clients?.find(c => c.phone === member.phone)?.id;

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
                estimatedDuration: services?.filter(s => member.serviceIds.includes(s.id)).reduce((acc, s) => acc + (s.duration || 0), 0) || 0
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
        toast({ variant: 'destructive', title: 'Error Joining Waitlist' });
    } finally { setIsSubmitting(false); }
  };

  const isClosed = !isBusinessOpen(new Date(), scheduleProfiles?.[0]).open;

  if (!tenant || !services) return <div className="h-screen flex items-center justify-center bg-slate-950"><Loader className="animate-spin text-primary" /></div>;
  if (isClosed) return <div className="h-screen flex items-center justify-center bg-slate-950 p-4"><ClosedView schedule={scheduleProfiles?.[0]} /></div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center justify-center p-4">
        <AnimatePresence mode="wait">
            {!entered ? (
                <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center cursor-pointer" onClick={() => setEntered(true)}>
                    <div className="inline-block p-6 bg-slate-900/50 rounded-full shadow-2xl mb-8 border border-slate-800"><ClarityFlowLogo className="!text-white w-20 h-20" /></div>
                    <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-white mb-4">Welcome to {tenant?.name}</h1>
                    <p className="text-slate-400 text-2xl font-medium tracking-wide uppercase">Tap Screen to Check In</p>
                </motion.div>
            ) : (
                <motion.div key="content" className="w-full max-w-4xl mx-auto bg-slate-900/40 border border-slate-800 rounded-[2.5rem] shadow-2xl overflow-hidden backdrop-blur-xl">
                    {step === 'partyType' && <PartyTypeSelection onSelect={handlePartyTypeSelect} />}
                    {step === 'memberSetup' && partyMembers[currentMemberIndex] && (
                        <MemberSetup 
                            member={{...partyMembers[currentMemberIndex], index: currentMemberIndex}}
                            partyMembers={partyMembers}
                            onUpdate={handleMemberUpdate}
                            memberSubStep={memberSubStep}
                            services={services} staff={staff} pricingTiers={pricingTiers}
                            consentForms={consentForms || []}
                            formAnswers={formAnswers[partyMembers[currentMemberIndex].id] || {}}
                            setFormAnswers={(a: any) => setFormAnswers(p => ({...p, [partyMembers[currentMemberIndex].id]: a}))}
                            onNext={handleNextSubStep} onBack={handleBack}
                            isGroup={isGroup} isLastMember={currentMemberIndex === partyMembers.length - 1}
                            onAddAnother={() => { setPartyMembers([...partyMembers, { id: nanoid(5), name: '', serviceIds: [], preferredStaffId: 'any', waitForPreferredStaff: false }]); setCurrentMemberIndex(partyMembers.length); setMemberSubStep('details'); }}
                            onSubmit={handleSubmit} isSubmitting={isSubmitting}
                        />
                    )}
                    {step === 'confirmation' && <ConfirmationScreen confirmedParty={confirmedParty} onPrint={(t) => { setTicketToPrint(t); setIsPrintDialogOpen(true); }} onDone={() => { setEntered(false); setStep('partyType'); setPartyMembers([]); setFormAnswers({}); }} />}
                </motion.div>
            )}
        </AnimatePresence>
        <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
            <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Ticket Printed</DialogTitle></DialogHeader><div className="flex justify-center p-4">{ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}</div><DialogFooter><Button className="w-full" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Print & Close</Button></DialogFooter></DialogContent>
        </Dialog>
    </div>
  );
}
