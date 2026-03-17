'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
    Clock, 
    Car, 
    MapPin, 
    Check, 
    AlertTriangle, 
    X, 
    CreditCard, 
    Loader, 
    ChevronLeft, 
    ChevronRight, 
    TicketIcon, 
    User as UserIcon, 
    Activity, 
    CheckCircle, 
    Wallet, 
    CheckCircle2, 
    Sparkles, 
    Zap, 
    Calendar as CalendarIcon, 
    ShieldCheck, 
    Ban, 
    XCircle, 
    ShoppingCart, 
    Fingerprint, 
    Star, 
    ArrowRight, 
    Cake, 
    PartyPopper, 
    Gift,
    FileSignature,
    ListChecks,
    ArrowDown,
    Lock,
    Info,
    ListOrdered,
    Shield,
    Undo2,
    CalendarDays,
    TrendingDown,
    Landmark
} from 'lucide-react';
import { format, parseISO, addMinutes, areIntervalsOverlapping, isBefore, startOfDay, setHours, setMinutes, eachDayOfInterval, startOfWeek, isSameDay, subWeeks, addWeeks, addDays, isToday, parse, endOfDay } from 'date-fns';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type ConsentForm } from '@/lib/data';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking, useDoc, setDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, getDocs, writeBatch, increment, arrayUnion, arrayRemove } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { motion, AnimatePresence } from 'framer-motion';
import { formatPhoneNumber } from 'react-phone-number-input';
import { Textarea } from '@/components/ui/textarea';
import { nanoid } from 'nanoid';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import { ScrollArea } from '@/components/ui/scroll-area';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    return new Date(val);
};

const timeStringToDate = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (!timeStr) return d;
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    d.setHours(hours, minutes);
    return d;
}

const ViewContainer = ({ children }: { children: React.ReactNode }) => (
    <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-lg px-2 sm:px-0"
    >
        <Card className="border-4 rounded-[2.5rem] md:rounded-[3rem] shadow-3xl overflow-hidden bg-white/90 backdrop-blur-xl">
            {children}
        </Card>
    </motion.div>
);

const ViewHeader = ({ title, subtitle, icon: Icon }: { title: string, subtitle: string, icon?: any }) => (
    <CardHeader className="p-6 md:p-8 pb-4 border-b bg-muted/5 text-left">
        <div className="flex items-center gap-3 mb-2">
            {Icon ? <Icon className="w-4 h-4 md:w-5 md:h-5 text-primary" /> : <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />}
            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Studio Portal</span>
        </div>
        <CardTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{subtitle}</CardDescription>
    </CardHeader>
);

const RescheduleView = ({ appointment, service, staff, schedule, allAppointments, onConfirm, onCancel, recoveryFee }: any) => {
    const [date, setDate] = useState<Date>(safeDate(appointment.startTime));
    const [time, setTime] = useState<string>(format(safeDate(appointment.startTime), 'HH:mm'));
    const [isSaving, setIsSaving] = useState(false);

    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const timeSlots = useMemo(() => {
        if (!service || !date || !schedule || !staff || !allAppointments) return [];
        const bookingInterval = 15;
        const dayName = format(date, 'eeee').toLowerCase();
        const assignedPro = staff.find((s: Staff) => s.id === appointment.staffId);
        
        const sched = assignedPro?.availability?.week?.[dayName] || schedule.week?.[dayName];
        if (!sched?.enabled) return [];

        const openT = timeStringToDate(sched.start, date);
        const closeT = timeStringToDate(sched.end, date);
        
        const busyIntervals: { start: Date, end: Date }[] = [];
        allAppointments.filter((a: any) => isSameDay(safeDate(a.startTime), date) && a.staffId === appointment.staffId && a.id !== appointment.id && a.status !== 'cancelled').forEach((a: any) => {
            busyIntervals.push({ start: safeDate(a.startTime), end: safeDate(a.endTime) });
        });

        const options: string[] = [];
        let curr = openT;
        while (curr < closeT) {
            const potentialEnd = addMinutes(curr, service.duration);
            if (potentialEnd > closeT) break;
            const overlap = busyIntervals.some(interval => areIntervalsOverlapping({ start: curr, end: potentialEnd }, interval, { inclusive: false }));
            if (!overlap) options.push(format(curr, 'HH:mm'));
            curr = addMinutes(curr, bookingInterval);
        }
        return options;
    }, [date, service, schedule, staff, allAppointments, appointment.staffId, appointment.id]);

    const handleAction = async () => {
        setIsSaving(true);
        const [h, m] = time.split(':').map(Number);
        const start = setMinutes(setHours(startOfDay(date), h), m);
        const end = addMinutes(start, service.duration);
        await onConfirm(start.toISOString(), end.toISOString());
        setIsSaving(false);
    };

    return (
        <ViewContainer>
            <ViewHeader title="Reschedule" subtitle="Shift your window" icon={Undo2} />
            <CardContent className="p-6 md:p-8 space-y-8 text-left">
                {recoveryFee > 0 && (
                    <div className="p-5 rounded-2xl bg-destructive/5 border-2 border-destructive/10 space-y-2 shadow-inner">
                        <p className="text-[9px] font-black uppercase text-destructive/60 tracking-widest">Protocol Adjustment Fee</p>
                        <div className="flex justify-between items-baseline">
                            <p className="text-3xl font-black text-destructive tracking-tighter font-mono">${recoveryFee.toFixed(2)}</p>
                            <Badge className="bg-destructive text-white border-none text-[8px] h-5 font-black uppercase">Late Move</Badge>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 leading-relaxed uppercase opacity-80 pt-2 border-t border-destructive/10">This fee covers the reserved studio overhead for your original window.</p>
                    </div>
                )}
                <div className="rounded-[2rem] border-2 bg-muted/10 p-6 space-y-6 shadow-inner text-center">
                    <div className="flex justify-between items-center px-2">
                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => setDate(subWeeks(date, 1))}><ChevronLeft className="w-4 h-4" /></Button>
                        <span className="font-black uppercase tracking-widest text-[10px]">{format(date, 'MMMM yyyy')}</span>
                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => setDate(addWeeks(date, 1))}><ChevronRight className="w-4 h-4" /></Button>
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                        {weekDays.map(day => (
                            <button key={day.toISOString()} onClick={() => setDate(day)} disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)} className={cn("flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all", isSameDay(day, date) ? "bg-primary text-white border-primary" : "bg-white border-transparent")}>
                                <span className="text-[8px] uppercase font-black opacity-60">{format(day, 'E')}</span>
                                <span className="font-black text-sm">{format(day, 'd')}</span>
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-6 border-t border-dashed">
                        {timeSlots.map(t => (
                            <Button key={t} variant={time === t ? 'default' : 'outline'} onClick={() => setTime(t)} className="h-10 text-[10px] font-black uppercase rounded-xl border-2 shadow-sm">
                                {format(timeStringToDate(t, new Date()), 'h:mm a')}
                            </Button>
                        ))}
                    </div>
                </div>
            </CardContent>
            <CardFooter className="p-6 md:p-8 pt-0 flex flex-col gap-3">
                <Button onClick={handleAction} disabled={!time || isSaving} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all">
                    {isSaving ? <Loader className="animate-spin" /> : 'Confirm New Window'}
                </Button>
                <Button variant="ghost" onClick={onCancel} className="w-full font-black uppercase text-[10px] text-muted-foreground">Go Back</Button>
            </CardFooter>
        </ViewContainer>
    );
};

const CancelView = ({ onConfirm, onCancel, recoveryFee, items }: { onConfirm: () => void, onCancel: () => void, recoveryFee: number, items: any[] }) => (
    <ViewContainer>
        <ViewHeader title="Cancel" subtitle="Protocol Termination" icon={Ban} />
        <CardContent className="p-8 md:p-10 text-center space-y-10">
            <div className="w-20 h-20 bg-destructive/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl rotate-12">
                <AlertTriangle className="w-10 h-10 text-destructive -rotate-12" />
            </div>
            
            <div className="space-y-4">
                <div className="space-y-1">
                    <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">Confirm Cancellation?</h3>
                    <p className="text-[10px] font-bold text-slate-500 leading-relaxed uppercase opacity-60">This will void your reserved studio window.</p>
                </div>

                {recoveryFee > 0 && (
                    <div className="p-6 rounded-[2.5rem] bg-destructive/5 border-2 border-destructive/10 space-y-4 shadow-inner text-left">
                        <div className="flex justify-between items-center px-1">
                            <p className="text-[9px] font-black uppercase text-destructive tracking-[0.2em]">Protocol Recovery Manifest</p>
                            <Badge className="bg-destructive text-white border-none h-4 px-1.5 font-black text-[7px] uppercase">LATE NOTICE</Badge>
                        </div>
                        <div className="space-y-2">
                            {items.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center text-[10px] font-bold uppercase opacity-80 border-b border-destructive/10 pb-2 last:border-0 last:pb-0">
                                    <span className="truncate pr-2">{item.name} Overhead</span>
                                    <span className="font-mono text-destructive">${item.fee.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="pt-4 border-t-2 border-dashed border-destructive/20 flex justify-between items-baseline px-1">
                            <span className="text-[10px] font-black uppercase text-destructive">Total Account Burden</span>
                            <span className="text-3xl font-black font-mono text-destructive tracking-tighter">${recoveryFee.toFixed(2)}</span>
                        </div>
                    </div>
                )}
            </div>
        </CardContent>
        <CardFooter className="p-8 pt-0 flex flex-col gap-3">
            <Button variant="destructive" onClick={onConfirm} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-xl shadow-destructive/20">Authorize Cancellation</Button>
            <Button variant="ghost" onClick={onCancel} className="w-full font-black uppercase text-[10px] text-muted-foreground">Keep Appointment</Button>
        </CardFooter>
    </ViewContainer>
);

const WelcomeOnboardingView = ({ client, service, tenant, needsDeposit, needsIntake, onStart, onReschedule, onCancel }: any) => (
    <ViewContainer>
        <ViewHeader title="Welcome" subtitle="Onboarding Protocol" icon={Sparkles} />
        <CardContent className="p-6 md:p-10 space-y-8 text-left">
            <div className="space-y-2">
                <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                    Hello, {client?.name.split(' ')[0]}!
                </h3>
                <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    We are preparing your <strong>{service?.name}</strong> at {tenant?.name}. To finalize your check-in, please complete our onboarding sequence:
                </p>
            </div>

            <div className="space-y-3">
                {[
                    { label: 'Identity Verification', status: 'ready', icon: Fingerprint, color: 'text-primary' },
                    { label: 'Secure Retainer', status: needsDeposit ? 'pending' : 'certified', icon: CreditCard, color: needsDeposit ? 'text-amber-600' : 'text-green-600' },
                    { label: 'Professional Intake', status: needsIntake ? 'pending' : 'certified', icon: FileSignature, color: needsIntake ? 'text-amber-600' : 'text-green-600' },
                ].map((step, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-muted/20 border-2 border-transparent shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-xl bg-white shadow-inner", step.color)}>
                                <step.icon className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-black uppercase tracking-tight text-slate-700">{step.label}</span>
                        </div>
                        <Badge variant="outline" className={cn("text-[8px] font-black uppercase h-5 px-2 shadow-sm border-2", step.status === 'certified' ? "bg-green-500 text-white border-green-600" : "bg-white")}>
                            {step.status === 'certified' ? 'Certified' : 'Required'}
                        </Badge>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4">
                <Button variant="outline" onClick={onReschedule} className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm hover:bg-primary/[0.03]">
                    <Undo2 className="w-3.5 h-3.5 mr-2 opacity-40" /> Reschedule
                </Button>
                <Button variant="outline" onClick={onCancel} className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm text-destructive hover:bg-destructive/5 border-destructive/20">
                    <XCircle className="w-3.5 h-3.5 mr-2 opacity-40" /> Cancel Visit
                </Button>
            </div>
        </CardContent>
        <CardFooter className="p-6 md:p-8 pt-0">
            <Button onClick={onStart} className="w-full h-16 md:h-20 rounded-[2rem] text-xl font-black uppercase shadow-3xl shadow-primary/30 group">
                Begin Sequence <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-2" />
            </Button>
        </CardFooter>
    </ViewContainer>
);

const IntakeView = ({ requiredForms, onComplete, formAnswers, setFormAnswers }: { requiredForms: ConsentForm[], onComplete: () => void, formAnswers: Record<string, any>, setFormAnswers: any }) => {
    const [currentFormIndex, setCurrentFormIndex] = useState(0);
    const form = requiredForms[currentFormIndex];
    const isLast = currentFormIndex === requiredForms.length - 1;

    const handleNext = () => {
        const answers = formAnswers[form.id] || {};
        const allFilled = (form.fields || []).every(f => (f.type === 'heading' || f.type === 'paragraph' || !!answers[f.id]));
        if (!allFilled) return;
        if (isLast) onComplete();
        else setCurrentFormIndex(currentFormIndex + 1);
    };

    return (
        <ViewContainer>
            <ViewHeader title="Intake" subtitle={`Agreement ${currentFormIndex + 1} of ${requiredForms.length}`} icon={FileSignature} />
            <ScrollArea className="max-h-[60vh]">
                <CardContent className="p-6 md:p-8 space-y-10 text-left">
                    <div className="space-y-2">
                        <Badge className="bg-primary/10 text-primary border-none font-black uppercase text-[8px] tracking-widest h-5 px-2 mb-2">Requirement</Badge>
                        <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-none">{form.title}</h3>
                    </div>
                    <div className="space-y-8">
                        {form.fields?.map(field => (
                            <FormFieldRenderer 
                                key={field.id} 
                                field={field} 
                                value={formAnswers[form.id]?.[field.id]}
                                onChange={(val) => setFormAnswers((prev: any) => ({
                                    ...prev,
                                    [form.id]: { ...(prev[form.id] || {}), [field.id]: val }
                                }))}
                            />
                        ))}
                    </div>
                </CardContent>
            </ScrollArea>
            <CardFooter className="p-6 md:p-8 pt-4 border-t bg-muted/5">
                <Button onClick={handleNext} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 group">
                    {isLast ? 'Finalize & Authenticate' : 'Next Agreement'}
                    <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" />
                </Button>
            </CardFooter>
        </ViewContainer>
    );
};

const DepositPaymentView = ({ amount, onComplete }: { amount: number, onComplete: () => void }) => {
    const [isPaying, setIsPaying] = useState(false);
    const handlePay = async () => { setIsPaying(true); await new Promise(r => setTimeout(r, 1500)); onComplete(); setIsPaying(false); };
    return (
        <ViewContainer>
            <ViewHeader title="Secure Retainer" subtitle="Authorize scheduled window" icon={CreditCard} />
            <CardContent className="p-6 md:p-10 text-center space-y-10">
                <div className="p-8 md:p-10 rounded-[2.5rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-2xl shadow-primary/5">
                    <p className="text-[9px] md:text-[10px] font-black uppercase text-primary/60 tracking-[0.3em]">Required Deposit</p>
                    <p className="text-4xl md:text-6xl font-black text-primary tracking-tighter font-mono">${amount.toFixed(2)}</p>
                    <div className="pt-4 border-t border-primary/10"><Badge variant="outline" className="bg-white border-2 text-primary font-black uppercase text-[9px] h-6 px-3 shadow-sm">PROTECTED PAYMENT</Badge></div>
                </div>
                <div className="space-y-6 text-left">
                    <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner" /></div>
                    <div className="grid grid-cols-2 gap-6"><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div></div>
                </div>
                <div className="flex items-center justify-center gap-3 opacity-40"><Lock className="w-4 h-4"/><span className="text-[9px] font-black uppercase tracking-widest">Encrypted SSL Secure Tunnel</span></div>
            </CardContent>
            <CardFooter className="p-6 md:p-8 pt-0"><Button onClick={handlePay} disabled={isPaying} className="w-full h-16 md:h-20 rounded-[2.5rem] text-xl md:text-2xl font-black uppercase shadow-3xl shadow-primary/30 group">{isPaying ? <Loader className="animate-spin h-8 w-8" /> : <>Authorize Payment <ArrowRight className="ml-3 w-8 h-8 transition-transform group-hover:translate-x-2"/></>}</Button></CardFooter>
        </ViewContainer>
    );
};

const BirthdayCelebrationView = ({ clientName, onDone }: { clientName: string, onDone: () => void }) => (
    <ViewContainer>
        <div className="relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none overflow-hidden"><motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="absolute -top-20 -right-20 opacity-5"><Sparkles className="w-64 h-64 text-primary" /></motion.div></div>
            <ViewHeader title="Happy Birthday!" subtitle="Celebrating Excellence" icon={Cake} />
            <CardContent className="p-10 text-center space-y-8 relative z-10"><motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", damping: 12, stiffness: 200 }} className="w-32 h-32 bg-primary/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-12"><PartyPopper className="w-16 h-16 text-primary -rotate-12" /></motion.div><div className="space-y-3"><h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Cheers to <br/><span className="text-primary italic font-serif lowercase tracking-normal">{clientName.split(' ')[0]}!</span></h2><p className="text-sm md:text-base font-medium text-slate-500 leading-relaxed max-w-xs mx-auto">We're thrilled to celebrate with you today. Expect a little something extra during your visit!</p></div><div className="p-5 rounded-2xl bg-primary/5 border-2 border-dashed border-primary/20 flex items-center justify-center gap-3 shadow-inner"><Gift className="w-5 h-5 text-primary animate-bounce" /><span className="text-[10px] font-black uppercase tracking-widest text-primary">Ask your pro for a birthday surprise</span></div></CardContent>
            <CardFooter className="p-8 pt-0"><Button onClick={onDone} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 group">Check In Now <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" /></Button></CardFooter>
        </div>
    </ViewContainer>
);

const ServicingView = ({ serviceName }: { serviceName: string }) => (
    <ViewContainer>
        <ViewHeader title="In Service" subtitle="Your session is active" icon={Clock} />
        <CardContent className="p-10 text-center space-y-6"><div className="w-24 h-24 bg-primary/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-6"><Activity className="w-12 h-12 text-primary -rotate-6" /></div><div className="space-y-2"><p className="font-black text-xl uppercase tracking-tight text-slate-900">Sit Back & Relax</p><p className="text-sm font-medium text-slate-500 leading-relaxed text-center">Your <strong>{serviceName}</strong> is currently underway. We'll provide your checkout ticket once complete.</p></div></CardContent>
    </ViewContainer>
);

const CheckoutView = ({ qrCodeUrl, ticketId }: { qrCodeUrl: string, ticketId: string }) => (
    <ViewContainer>
        <ViewHeader title="Finalize" subtitle="Ready for checkout" icon={ShoppingCart} />
        <CardContent className="p-8 text-center space-y-8"><p className="text-sm font-bold text-slate-600 uppercase tracking-tight">Scan this code at the desk to pay.</p><div className="p-6 bg-white rounded-[2.5rem] shadow-2xl border-4 border-primary/10 inline-block mx-auto"><Image src={qrCodeUrl} alt="Checkout QR Code" width={220} height={220} className="rounded-xl" /></div><div className="bg-primary/5 p-6 rounded-[2rem] border-2 border-primary/10 space-y-1"><p className="text-[10px] uppercase font-black tracking-widest text-primary/60">Checkout Ticket</p><p className="text-4xl font-black font-mono tracking-tighter text-primary">#{ticketId}</p></div></CardContent>
    </ViewContainer>
);

const ThankYouView = ({ tenantId, onLeaveReview }: { tenantId: string, onLeaveReview: () => void }) => (
    <ViewContainer>
        <ViewHeader title="Complete" subtitle="Session Finished" icon={CheckCircle2} />
        <CardContent className="p-10 text-center space-y-8"><div className="w-24 h-24 bg-green-500/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 -rotate-6"><CheckCircle2 className="w-14 h-14 text-green-500 rotate-6" /></div><div className="space-y-2"><p className="font-black text-xl uppercase tracking-tight text-slate-900">Thank You!</p><p className="text-sm font-medium text-slate-500 leading-relaxed text-center">We hope you enjoyed your experience. We look forward to seeing you again soon.</p></div></CardContent>
        <CardFooter className="p-8 pt-0 flex flex-col gap-3"><Button asChild className="w-full h-14 rounded-2xl text-lg font-black uppercase shadow-xl shadow-primary/20"><a href={`/book/${tenantId}`}>Book Next Session</a></Button><Button variant="ghost" onClick={onLeaveReview} className="w-full font-bold uppercase text-[10px] tracking-widest text-muted-foreground">Leave a Review</Button></CardFooter>
    </ViewContainer>
);

const CancelledView = ({ tenantId, fee, onSettle }: { tenantId?: string, fee?: number, onSettle?: () => void }) => {
    const [step, setStep] = useState<'info' | 'payment' | 'success'>('info');
    return (
        <ViewContainer>
            <ViewHeader title="Cancelled" subtitle="Appointment Void" icon={Ban} />
            <CardContent className="p-8 md:p-10 text-center space-y-8">
                {step === 'info' ? (
                    <><div className="w-24 h-24 bg-destructive/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-destructive/5 rotate-12"><XCircle className="w-12 h-12 text-destructive -rotate-12" /></div><div className="space-y-2 text-left"><p className="font-black text-xl uppercase tracking-tight text-slate-900 text-center">Session Voided</p><p className="text-sm font-medium text-slate-500 leading-relaxed text-center">This appointment has been cancelled. We've updated our studio manifest.</p></div>{fee && Number(fee) > 0 && (<div className="p-6 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 space-y-2 shadow-inner text-left"><p className="text-[10px] font-black uppercase tracking-widest text-destructive/60">Outstanding Protocol Fee</p><div className="flex justify-between items-baseline"><p className="text-4xl font-black text-destructive tracking-tighter font-mono">${Number(fee).toFixed(2)}</p><Badge variant="outline" className="h-5 px-2 font-black text-[8px] uppercase border-destructive/20 text-destructive shadow-sm">RECOVERY</Badge></div><p className="text-[10px] font-bold text-slate-500 uppercase leading-relaxed pt-2 border-t border-destructive/10">Settle now to clear your account and rebook immediately.</p></div>)}</>
                ) : (
                    <div className="space-y-6 animate-in fade-in zoom-in-95 text-left"><div className="p-4 bg-primary/10 rounded-full w-fit mx-auto mb-4"><CreditCard className="w-8 h-8 text-primary" /></div><div className="space-y-2 text-center"><h3 className="text-xl font-black uppercase tracking-tighter">Settle Balance</h3><p className="text-xs font-bold uppercase tracking-widest opacity-60">Authorize ${Number(fee).toFixed(2)}</p></div><div className="space-y-4"><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner" /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div></div></div></div>
                )}
            </CardContent>
            <CardFooter className="p-8 pt-0 flex flex-col gap-3">{fee && Number(fee) > 0 && step === 'info' ? (<Button onClick={() => setStep('payment')} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 group">Settle & Rebook <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" /></Button>) : fee && Number(fee) > 0 && step === 'payment' ? (<Button onClick={onSettle} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30">Authorize Payment</Button>) : (tenantId && (<Button asChild className="w-full h-14 rounded-2xl text-lg font-black uppercase shadow-xl shadow-primary/20"><a href={`/book/${tenantId}`}>Secure New Window</a></Button>))}{step === 'payment' && (<Button variant="ghost" onClick={() => setStep('info')} className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">Back</Button>)}{step === 'info' && (<Button asChild variant="ghost" className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground"><a href="/">Return to Homepage</a></Button>)}</CardFooter>
        </ViewContainer>
    );
};

const ReviewFormView = ({ onSubmit, onCancel, serviceName, staffName }: { onSubmit: (rating: number, text: string) => void, onCancel: () => void, serviceName: string, staffName: string }) => {
    const [rating, setRating] = useState(5);
    const [text, setText] = useState('');
    return (
        <ViewContainer>
            <ViewHeader title="Feedback" subtitle={`How was your ${serviceName}?`} icon={Star} />
            <CardContent className="p-8 space-y-8 text-center"><div className="space-y-4"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-center">Rate your experience with {staffName}</p><div className="flex justify-center gap-2">{[1, 2, 3, 4, 5].map((star) => (<button key={star} type="button" onClick={() => setRating(star)} className="transition-all active:scale-90"><Star className={cn("w-10 h-10 md:w-12 md:h-12 transition-colors", star <= rating ? "text-amber-400 fill-current" : "text-muted opacity-30")} /></button>))}</div></div><div className="space-y-3 text-left"><Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Your Story (Optional)</Label><Textarea placeholder="Share your thoughts..." className="rounded-2xl border-2 bg-muted/5 min-h-[120px]" value={text} onChange={(e) => setText(e.target.value)} /></div></CardContent>
            <CardFooter className="p-8 pt-0 flex flex-col gap-3"><Button onClick={() => onSubmit(rating, text)} className="w-full h-16 rounded-2xl text-lg font-black uppercase shadow-2xl shadow-primary/30">Submit Review</Button><Button variant="ghost" onClick={onCancel} className="w-full font-black uppercase tracking-widest text-[10px]">Maybe Later</Button></CardFooter>
        </ViewContainer>
    );
};

export default function CheckInPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;
    const { toast } = useToast();
    const { firestore } = useFirebase();

    const appointmentCheckInRef = useMemoFirebase(() => !firestore || !token ? null : doc(firestore, 'appointmentCheckIns', token), [firestore, token]);
    const { data: appointmentData, isLoading: appointmentLoading } = useDoc<Appointment>(appointmentCheckInRef);

    const tenantId = appointmentData?.tenantId;
    const tenantDocRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
    const clientDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.clientId ? null : doc(firestore, `tenants/${tenantId}/clients`, appointmentData.clientId), [firestore, tenantId, appointmentData?.clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientDocRef);
    const serviceDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.serviceId ? null : doc(firestore, `tenants/${tenantId}/services`, appointmentData.serviceId), [firestore, tenantId, appointmentData?.serviceId]);
    const { data: service, isLoading: serviceLoading } = useDoc<Service>(serviceDocRef);
    const staffDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.staffId ? null : doc(firestore, `tenants/${tenantId}/staff`, appointmentData.staffId), [firestore, tenantId, appointmentData?.staffId]);
    const { data: assignedStaff, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);
    const { data: allAppointments } = useCollection<Appointment>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]));
    const { data: consentForms } = useCollection<ConsentForm>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]));
    const { data: scheduleProfiles } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/scheduleProfiles`), [firestore, tenantId]));

    const [hasStarted, setHasStarted] = useState(false);
    const [currentStatus, setCurrentStatus] = useState<Appointment['checkInStatus']>('pending');
    const [lateTime, setLateTime] = useState(0);
    const [showLateOptions, setShowLateOptions] = useState(false);
    const [isReviewFlow, setIsReviewFlow] = useState(false);
    const [isCancelFlow, setIsCancelFlow] = useState(false);
    const [isRescheduleFlow, setIsRescheduleFlow] = useState(false);
    const [reviewSubmitted, setReviewSubmitted] = useState(false);
    const [showBirthdayCelebration, setShowBirthdayCelebration] = useState(false);
    const [birthdayName, setBirthdayName] = useState('');
    const [isIntakeFlow, setIsIntakeFlow] = useState(false);
    const [formAnswers, setFormAnswers] = useState<Record<string, Record<string, any>>>({});

    const appointment = useMemo(() => appointmentData ? { ...appointmentData, startTime: safeDate(appointmentData.startTime), endTime: safeDate(appointmentData.endTime) } : null, [appointmentData]);
    
    const recoveryFeeItems = useMemo(() => {
        if (!appointment || !service || !tenant) return [];
        const tmhr = tenant.tmhr || 50;
        const mainFee = service.customCancellationFee || (service.duration / 60) * tmhr;
        return [{ name: service.name, fee: mainFee }];
    }, [appointment, service, tenant]);

    const totalRecoveryFee = useMemo(() => recoveryFeeItems.reduce((acc, i) => acc + i.fee, 0), [recoveryFeeItems]);

    useEffect(() => { if (appointment?.checkInStatus) { setCurrentStatus(appointment.checkInStatus); if (appointment.checkInStatus === 'running_late') setLateTime(appointment.lateTimeMinutes || 0); } }, [appointment]);

    const handleUpdateStatus = (newStatus: Appointment['checkInStatus'], lateMinutes?: number) => {
        if (!appointment || !firestore || !tenantId || !tenant) return;
        if (newStatus === 'arrived' && requiredForms.length > 0) { setIsIntakeFlow(true); return; }
        const tmhr = tenant.tmhr || 50;
        const grace = tenant.lateArrivalGracePeriod || 15;
        const updateData: Partial<Appointment> = { checkInStatus: newStatus };
        if (lateMinutes !== undefined) updateData.lateTimeMinutes = lateMinutes;
        const batch = writeBatch(firestore);
        
        if (newStatus === 'running_late' && lateMinutes && lateMinutes > grace) {
            const fee = Math.ceil((lateMinutes / 60) * tmhr);
            if (appointment.clientId && fee > 0) batch.update(doc(firestore, `tenants/${tenantId}/clients`, appointment.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: appointment.id, appointmentDate: safeDate(appointment.startTime).toISOString(), feeAmount: fee, reason: `Late Arrival Overhead Recovery (+${lateMinutes}m)` }) });
        }
        batch.update(doc(firestore, 'appointmentCheckIns', token), updateData);
        batch.update(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), updateData);
        batch.commit().then(() => { setCurrentStatus(newStatus); });
    };

    const handleConfirmCancel = async () => {
        if (!appointment || !firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        const updates = { status: 'cancelled' as const, cancellationReason: 'client_request' as const, cancellationFeeApplied: totalRecoveryFee };
        batch.update(doc(firestore, 'appointmentCheckIns', token), updates);
        batch.update(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), updates);
        if (totalRecoveryFee > 0 && appointment.clientId) {
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, appointment.clientId), { outstandingBalance: increment(totalRecoveryFee), unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: appointment.id, appointmentDate: safeDate(appointment.startTime).toISOString(), feeAmount: totalRecoveryFee, reason: 'Late Cancellation Overhead Recovery' }) });
        }
        await batch.commit();
        setIsCancelFlow(false);
        toast({ title: "Appointment Cancelled" });
    };

    const handleConfirmReschedule = async (newStart: string, newEnd: string) => {
        if (!appointment || !firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        const fee = totalRecoveryFee; // Applied if within window
        const updates = { startTime: newStart, endTime: newEnd, status: 'confirmed' as const };
        batch.update(doc(firestore, 'appointmentCheckIns', token), updates);
        batch.update(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), updates);
        if (fee > 0 && appointment.clientId) {
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, appointment.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: appointment.id, appointmentDate: safeDate(appointment.startTime).toISOString(), feeAmount: fee, reason: 'Reschedule Adjustment Protocol' }) });
        }
        await batch.commit();
        setIsRescheduleFlow(false);
        toast({ title: "Appointment Rescheduled" });
    };

    const requiredForms = useMemo(() => {
        if (!service || !consentForms) return [];
        const requiredIds = service.requiredFormIds || [];
        return consentForms.filter(f => requiredIds.includes(f.id));
    }, [service, consentForms]);

    const isBirthdayToday = useMemo(() => {
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        const today = new Date();
        return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
    }, [client?.birthday]);

    if (appointmentLoading || clientLoading || serviceLoading || tenantLoading || staffLoading) return <div className="flex flex-col items-center gap-4"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-[10px] font-black uppercase tracking-widest opacity-60">Initializing Portal...</p></div>;
    
    if (isCancelFlow) return <CancelView onConfirm={handleConfirmCancel} onCancel={() => setIsCancelFlow(false)} recoveryFee={totalRecoveryFee} items={recoveryFeeItems} />;
    if (isRescheduleFlow) return <RescheduleView appointment={appointment} service={service} staff={staff || []} schedule={scheduleProfiles?.[0]} allAppointments={allAppointments || []} onConfirm={handleConfirmReschedule} onCancel={() => setIsRescheduleFlow(false)} recoveryFee={totalRecoveryFee} />;
    
    if (appointment?.status === 'cancelled' || currentStatus === 'auto_cancelled') return <CancelledView tenantId={tenant?.id} fee={appointment.cancellationFeeApplied} />;
    if (!hasStarted && appointment?.status !== 'completed' && appointment?.status !== 'servicing' && appointment?.status !== 'ready_for_checkout') return <WelcomeOnboardingView client={client} service={service} tenant={tenant} needsDeposit={appointment?.status === 'deposit_pending'} needsIntake={requiredForms.length > 0} onStart={() => setHasStarted(true)} onReschedule={() => setIsRescheduleFlow(true)} onCancel={() => setIsCancelFlow(true)} />;
    
    if (isIntakeFlow) return <IntakeView requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} onComplete={() => { setIsIntakeFlow(false); setCurrentStatus('arrived'); handleUpdateStatus('arrived'); }} />;
    if (showBirthdayCelebration) return <BirthdayCelebrationView clientName={client?.name || 'Guest'} onDone={() => setShowBirthdayCelebration(false)} />;
    if (appointment?.status === 'servicing') return <ServicingView serviceName={service?.name || 'Service'} />;
    if (appointment?.status === 'ready_for_checkout') return <CheckoutView qrCodeUrl={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(`clarityflow://checkout/${appointment.id}`)}`} ticketId={appointment.id.slice(-6).toUpperCase()} />;
    if (appointment?.status === 'completed') return <ThankYouView tenantId={tenant?.id || ''} onLeaveReview={() => setIsReviewFlow(true)} />;

    return (
        <ViewContainer>
            <ViewHeader title="Identity Check" subtitle="Verify your session" icon={Fingerprint} />
            <CardContent className="p-6 md:p-10 space-y-10">
                <div className="p-6 rounded-[2rem] bg-muted/10 border-2 space-y-6 shadow-inner">
                     <div className="flex items-center gap-6">
                        <Avatar className="w-16 h-16 rounded-2xl border-4 border-background shadow-xl"><AvatarImage src={service.imageUrl} className="object-cover" /><AvatarFallback className="bg-primary/10 text-primary"><Activity className="w-8 h-8" /></AvatarFallback></Avatar>
                        <div className="min-w-0 flex-1 text-left"><p className="font-black text-lg md:text-2xl uppercase tracking-tighter text-slate-900 truncate leading-none mb-2">{service.name}</p><p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-primary">{format(appointment.startTime, 'EEEE, MMMM d')} &middot; {format(appointment.startTime, 'h:mm a')}</p></div>
                    </div>
                    {assignedStaff && (
                        <div className="pt-6 border-t border-dashed border-border/50">
                            <div className="flex items-center gap-4 text-left">
                                <Avatar className="h-10 w-10 border-2 border-background shadow-md rounded-xl"><AvatarImage src={assignedStaff.avatarUrl} className="object-cover" /><AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback></Avatar>
                                <div className="text-left"><p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1">Your Professional</p><p className="font-black text-sm uppercase text-slate-800 leading-none">{assignedStaff.name}</p></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    {currentStatus === 'pending' ? (
                        <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-2 gap-4"><Button size="lg" onClick={() => setShowLateOptions(true)} variant="outline" className="h-20 rounded-3xl border-4 font-black uppercase tracking-widest text-xs flex flex-col gap-2"><Clock className="h-6 w-6 opacity-40" />Running Late</Button><Button size="lg" onClick={() => handleUpdateStatus('on_my_way')} className="h-20 rounded-3xl border-4 border-primary/20 bg-primary/5 text-primary font-black uppercase tracking-widest text-xs flex flex-col gap-2 shadow-inner"><Car className="h-6 w-6" />On My Way</Button></div>
                            <Button size="lg" variant="default" onClick={() => handleUpdateStatus('arrived')} className="h-20 rounded-[2rem] font-black uppercase tracking-[0.2em] text-lg shadow-3xl shadow-primary/30 active:scale-95 transition-all"><MapPin className="mr-3 h-6 w-6" />I Have Arrived</Button>
                        </div>
                    ) : (
                        <div className="p-10 bg-primary/5 border-4 border-primary/20 rounded-[3rem] text-center space-y-6 shadow-xl">
                            <div className={cn("w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl rotate-6", 
                                currentStatus === 'arrived' ? "bg-green-500 shadow-green-500/20" : 
                                currentStatus === 'on_my_way' ? "bg-blue-500 shadow-blue-500/20" : 
                                "bg-amber-500 shadow-amber-500/20"
                            )}>
                                {currentStatus === 'arrived' ? <CheckCircle2 className="w-14 h-14 text-white -rotate-6" /> : 
                                 currentStatus === 'on_my_way' ? <Car className="w-14 h-14 text-white -rotate-6" /> : 
                                 <Clock className="w-14 h-14 text-white -rotate-6 animate-pulse" />}
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                                    {currentStatus === 'arrived' ? 'Arrived' : 
                                     currentStatus === 'on_my_way' ? 'En Route' : 
                                     `Late +${lateTime}m`}
                                </h3>
                                <p className="text-sm font-bold uppercase tracking-tight text-slate-500 opacity-80 leading-relaxed text-center">
                                    {currentStatus === 'on_my_way' ? "We'll see you shortly! Please check in at the terminal upon arrival." : "We've updated our terminal. We'll be with you shortly."}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter className="p-8 pt-0 flex flex-col gap-3">
                <Button variant="ghost" onClick={() => setIsRescheduleFlow(true)} className="w-full font-black uppercase text-[10px] tracking-widest text-primary">Reschedule Appointment</Button>
                <Button variant="ghost" onClick={() => setIsCancelFlow(true)} className="w-full font-black uppercase text-[10px] tracking-widest text-destructive">Cancel Appointment</Button>
            </CardFooter>
        </ViewContainer>
    );
}
