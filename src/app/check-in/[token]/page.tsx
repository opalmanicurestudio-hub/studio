
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
    ArrowDown
} from 'lucide-react';
import { format, parseISO, addMinutes, areIntervalsOverlapping, isBefore, startOfDay, setHours, setMinutes, eachDayOfInterval, startOfWeek, isSameDay, subWeeks, addWeeks, addDays, isToday, parse } from 'date-fns';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type ConsentForm } from '@/lib/data';
import { type Transaction } from '@/lib/financial-data';
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

const ViewContainer = ({ children }: { children: React.ReactNode }) => (
    <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-lg"
    >
        <Card className="border-4 rounded-[3rem] shadow-3xl overflow-hidden bg-white/90 backdrop-blur-xl">
            {children}
        </Card>
    </motion.div>
);

const ViewHeader = ({ title, subtitle, icon: Icon }: { title: string, subtitle: string, icon?: any }) => (
    <CardHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
        <div className="flex items-center gap-3 mb-2">
            {Icon ? <Icon className="w-5 h-5 text-primary" /> : <Sparkles className="w-5 h-5 text-primary" />}
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Studio Portal</span>
        </div>
        <CardTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</CardTitle>
        <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{subtitle}</CardDescription>
    </CardHeader>
);

const IntakeView = ({ requiredForms, onComplete, formAnswers, setFormAnswers }: { requiredForms: ConsentForm[], onComplete: () => void, formAnswers: Record<string, any>, setFormAnswers: any }) => {
    const [currentFormIndex, setCurrentMemberIndex] = useState(0);
    const form = requiredForms[currentFormIndex];
    
    const isLast = currentFormIndex === requiredForms.length - 1;

    const handleNext = () => {
        const answers = formAnswers[form.id] || {};
        const allFieldsFilled = (form.fields || []).every(f => {
            if (f.type === 'heading' || f.type === 'paragraph') return true;
            return !!answers[f.id];
        });

        if (!allFieldsFilled) {
            return; // In real app, show toast
        }

        if (isLast) onComplete();
        else setCurrentMemberIndex(currentFormIndex + 1);
    };

    return (
        <ViewContainer>
            <ViewHeader title="Intake" subtitle={`Agreement ${currentFormIndex + 1} of ${requiredForms.length}`} icon={FileSignature} />
            <ScrollArea className="max-h-[60vh]">
                <CardContent className="p-8 space-y-10 text-left">
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
            <CardFooter className="p-8 pt-4 border-t bg-muted/5">
                <Button onClick={handleNext} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 group">
                    {isLast ? 'Finalize & Authenticate' : 'Next Agreement'}
                    <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" />
                </Button>
            </CardFooter>
        </ViewContainer>
    );
};

const BirthdayCelebrationView = ({ clientName, onDone }: { clientName: string, onDone: () => void }) => (
    <ViewContainer>
        <div className="relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <motion.div 
                    animate={{ rotate: 360 }} 
                    transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    className="absolute -top-20 -right-20 opacity-5"
                >
                    <Sparkles className="w-64 h-64 text-primary" />
                </motion.div>
            </div>

            <ViewHeader title="Happy Birthday!" subtitle="Celebrating Excellence" icon={Cake} />
            
            <CardContent className="p-10 text-center space-y-8 relative z-10">
                <motion.div 
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", damping: 12, stiffness: 200 }}
                    className="w-32 h-32 bg-primary/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-12"
                >
                    <PartyPopper className="w-16 h-16 text-primary -rotate-12" />
                </motion.div>
                
                <div className="space-y-3">
                    <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                        Cheers to <br/>
                        <span className="text-primary italic font-serif lowercase tracking-normal">{clientName.split(' ')[0]}!</span>
                    </h2>
                    <p className="text-sm md:text-base font-medium text-slate-500 leading-relaxed max-w-xs mx-auto">
                        We're thrilled to have you in the studio on your special day. Today is all about you!
                    </p>
                </div>

                <div className="p-5 rounded-2xl bg-primary/5 border-2 border-dashed border-primary/20 flex items-center justify-center gap-3 shadow-inner">
                    <Gift className="w-5 h-5 text-primary animate-bounce" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">Ask your pro for a birthday surprise</span>
                </div>
            </CardContent>
            
            <CardFooter className="p-8 pt-0">
                <Button onClick={onDone} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 group">
                    Check In Now <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" />
                </Button>
            </CardFooter>
        </div>
    </ViewContainer>
);

const ServicingView = ({ serviceName }: { serviceName: string }) => (
    <ViewContainer>
        <ViewHeader title="In Service" subtitle="Your session is active" icon={Clock} />
        <CardContent className="p-10 text-center space-y-6">
            <div className="w-24 h-24 bg-primary/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-6">
                <Activity className="w-12 h-12 text-primary -rotate-6" />
            </div>
            <div className="space-y-2">
                <p className="font-black text-xl uppercase tracking-tight text-slate-900">Sit Back & Relax</p>
                <p className="text-sm font-medium text-slate-500 leading-relaxed">Your <strong>{serviceName}</strong> is currently underway. We'll provide your checkout ticket once complete.</p>
            </div>
        </CardContent>
    </ViewContainer>
);

const CheckoutView = ({ qrCodeUrl, ticketId }: { qrCodeUrl: string, ticketId: string }) => (
    <ViewContainer>
        <ViewHeader title="Finalize" subtitle="Ready for checkout" icon={ShoppingCart} />
        <CardContent className="p-8 text-center space-y-8">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-tight">Scan this code at the desk to pay.</p>
            <div className="p-6 bg-white rounded-[2.5rem] shadow-2xl border-4 border-primary/10 inline-block mx-auto">
                <Image src={qrCodeUrl} alt="Checkout QR Code" width={220} height={220} className="rounded-xl" />
            </div>
            <div className="bg-primary/5 p-6 rounded-[2rem] border-2 border-primary/10 space-y-1">
                <p className="text-[10px] uppercase font-black tracking-widest text-primary/60">Checkout Ticket</p>
                <p className="text-4xl font-black font-mono tracking-tighter text-primary">#{ticketId}</p>
            </div>
        </CardContent>
    </ViewContainer>
);

const ThankYouView = ({ tenantId, onLeaveReview }: { tenantId: string, onLeaveReview: () => void }) => (
    <ViewContainer>
        <ViewHeader title="Complete" subtitle="Session Finished" icon={CheckCircle2} />
        <CardContent className="p-10 text-center space-y-8">
            <div className="w-24 h-24 bg-green-500/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 -rotate-6">
                <CheckCircle2 className="w-14 h-14 text-green-500 rotate-6" />
            </div>
            <div className="space-y-2">
                <p className="font-black text-xl uppercase tracking-tight text-slate-900">Thank You!</p>
                <p className="text-sm font-medium text-slate-500 leading-relaxed">We hope you enjoyed your experience. We look forward to seeing you again soon.</p>
            </div>
        </CardContent>
        <CardFooter className="p-8 pt-0 flex flex-col gap-3">
            <Button asChild className="w-full h-14 rounded-2xl text-lg font-black uppercase shadow-xl shadow-primary/20"><a href={`/book/${tenantId}`}>Book Next Session</a></Button>
            <Button variant="ghost" onClick={onLeaveReview} className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">Leave a Review</Button>
        </CardFooter>
    </ViewContainer>
);

const CancelledView = ({ tenantId, fee, onSettle }: { tenantId?: string, fee?: number, onSettle?: () => void }) => {
    const [step, setStep] = useState<'info' | 'payment' | 'success'>('info');

    return (
        <ViewContainer>
            <ViewHeader title="Cancelled" subtitle="Appointment Void" icon={Ban} />
            <CardContent className="p-8 md:p-10 text-center space-y-8">
                {step === 'info' ? (
                    <>
                        <div className="w-24 h-24 bg-destructive/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-destructive/5 rotate-12">
                            <XCircle className="w-12 h-12 text-destructive -rotate-12" />
                        </div>
                        <div className="space-y-2 text-left">
                            <p className="font-black text-xl uppercase tracking-tight text-slate-900 text-center">Session Voided</p>
                            <p className="text-sm font-medium text-slate-500 leading-relaxed text-center">This appointment has been cancelled due to policy violation (late notice or scheduling conflict).</p>
                        </div>
                        {fee && Number(fee) > 0 && (
                            <div className="p-6 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 space-y-2 shadow-inner text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-destructive/60">Outstanding Protocol Fee</p>
                                <div className="flex justify-between items-baseline">
                                    <p className="text-4xl font-black text-destructive tracking-tighter font-mono">${Number(fee).toFixed(2)}</p>
                                    <Badge variant="outline" className="h-5 px-2 font-black text-[8px] uppercase border-destructive/20 text-destructive">OVERHEAD RECOVERY</Badge>
                                </div>
                                <p className="text-[10px] font-bold text-slate-500 uppercase leading-relaxed pt-2 border-t border-destructive/10">This fee has been added to your dossier. Settle now to clear your account and rebook immediately.</p>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="space-y-6 animate-in fade-in zoom-in-95 text-left">
                        <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto mb-4"><CreditCard className="w-8 h-8 text-primary" /></div>
                        <div className="space-y-2 text-center">
                            <h3 className="text-xl font-black uppercase tracking-tighter">Settle Balance</h3>
                            <p className="text-xs font-bold uppercase tracking-widest opacity-60">Authorize ${Number(fee).toFixed(2)}</p>
                        </div>
                        <div className="space-y-4">
                            <div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Protocol</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner" /></div>
                            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div><div className="space-y-2"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div></div>
                        </div>
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-8 pt-0 flex flex-col gap-3">
                {fee && Number(fee) > 0 && step === 'info' ? (
                    <Button onClick={() => setStep('payment')} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30 group">
                        Settle & Rebook <ArrowRight className="ml-2 w-6 h-6 transition-transform group-hover:translate-x-1" />
                    </Button>
                ) : fee && Number(fee) > 0 && step === 'payment' ? (
                    <Button onClick={onSettle} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30">Authorize Payment</Button>
                ) : (
                    tenantId && (
                        <Button asChild className="w-full h-14 rounded-2xl text-lg font-black uppercase shadow-xl shadow-primary/20">
                            <a href={`/book/${tenantId}`}>Secure New Window</a>
                        </Button>
                    )
                )}
                {step === 'payment' && (
                    <Button variant="ghost" onClick={() => setStep('info')} className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">Back</Button>
                )}
                {step === 'info' && (
                    <Button asChild variant="ghost" className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">
                        <a href="/">Return to Homepage</a>
                    </Button>
                )}
            </CardFooter>
        </ViewContainer>
    );
};

const ReviewFormView = ({ onSubmit, onCancel, serviceName, staffName }: { onSubmit: (rating: number, text: string) => void, onCancel: () => void, serviceName: string, staffName: string }) => {
    const [rating, setRating] = useState(5);
    const [text, setText] = useState('');
    return (
        <ViewContainer>
            <ViewHeader title="Feedback" subtitle={`How was your ${serviceName}?`} icon={Star} />
            <CardContent className="p-8 space-y-8 text-center">
                <div className="space-y-4"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Rate your experience with {staffName}</p><div className="flex justify-center gap-2">{[1, 2, 3, 4, 5].map((star) => (<button key={star} type="button" onClick={() => setRating(star)} className="transition-all active:scale-90"><Star className={cn("w-10 h-10 md:w-12 md:h-12 transition-colors", star <= rating ? "text-amber-400 fill-current" : "text-muted opacity-30")} /></button>))}</div></div>
                <div className="space-y-3 text-left"><Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Your Story (Optional)</Label><Textarea placeholder="Share your thoughts on the treatment..." className="rounded-2xl border-2 bg-muted/5 min-h-[120px] focus-visible:ring-primary/20 font-medium" value={text} onChange={(e) => setText(e.target.value)} /></div>
            </CardContent>
            <CardFooter className="p-8 pt-0 flex flex-col gap-3"><Button onClick={() => onSubmit(rating, text)} className="w-full h-16 rounded-2xl text-lg font-black uppercase shadow-2xl shadow-primary/30">Submit Review</Button><Button variant="ghost" onClick={onCancel} className="w-full font-black uppercase tracking-widest text-[10px]">Maybe Later</Button></CardFooter>
        </ViewContainer>
    );
};

const ReviewSubmittedView = ({ onDone }: { onDone: () => void }) => (<ViewContainer><ViewHeader title="Success" subtitle="Review Authenticated" icon={CheckCircle2} /><CardContent className="p-10 text-center space-y-6"><div className="w-24 h-24 bg-primary/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-6"><Sparkles className="w-12 h-12 text-primary -rotate-6" /></div><div className="space-y-2"><p className="font-black text-xl uppercase tracking-tight text-slate-900">Contribution Logged</p><p className="text-sm font-medium text-slate-500 leading-relaxed text-center">Your feedback has been recorded and will help us continue providing excellence.</p></div></CardContent><CardFooter className="p-8 pt-0"><Button onClick={onDone} className="w-full h-14 rounded-2xl text-lg font-black uppercase shadow-xl shadow-primary/20">Return</Button></CardFooter></ViewContainer>);

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
    const { data: signedConsents } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.clientId ? null : collection(firestore, `tenants/${tenantId}/clients/${appointmentData.clientId}/signedConsents`), [firestore, tenantId, appointmentData?.clientId]));

    const [currentStatus, setCurrentStatus] = useState<Appointment['checkInStatus']>('pending');
    const [lateTime, setLateTime] = useState(0);
    const [showLateOptions, setShowLateOptions] = useState(false);
    const [isReviewFlow, setIsReviewFlow] = useState(false);
    const [reviewSubmitted, setReviewSubmitted] = useState(false);
    const [showBirthdayCelebration, setShowBirthdayCelebration] = useState(false);
    const [birthdayName, setBirthdayName] = useState('');
    const [isIntakeFlow, setIsIntakeFlow] = useState(false);
    const [formAnswers, setFormAnswers] = useState<Record<string, Record<string, any>>>({});

    const appointment = useMemo(() => appointmentData ? { ...appointmentData, startTime: safeDate(appointmentData.startTime), endTime: safeDate(appointmentData.endTime) } : null, [appointmentData]);

    const requiredForms = useMemo(() => {
        if (!service || !consentForms || !signedConsents) return [];
        const requiredIds = service.requiredFormIds || [];
        return consentForms.filter(f => requiredIds.includes(f.id));
    }, [service, consentForms, signedConsents]);

    const isBirthdayToday = useMemo(() => {
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        const today = new Date();
        return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
    }, [client?.birthday]);

    useEffect(() => { if (appointment?.checkInStatus) { setCurrentStatus(appointment.checkInStatus); if (appointment.checkInStatus === 'running_late') setLateTime(appointment.lateTimeMinutes || 0); } }, [appointment]);

    const handleUpdateStatus = (newStatus: Appointment['checkInStatus'], lateMinutes?: number) => {
        if (!appointment || !firestore || !tenantId || !tenant) return;
        
        if (newStatus === 'arrived' && requiredForms.length > 0) {
            setIsIntakeFlow(true);
            return;
        }

        const tmhr = tenant.tmhr || 50;
        const premium = tenant.lateInconveniencePremium || 0;
        const grace = tenant.lateArrivalGracePeriod || 15;
        const autoCancelEnabled = tenant.autoCancelLateArrivals !== false;
        const updateData: Partial<Appointment> = { checkInStatus: newStatus };
        if (lateMinutes !== undefined) updateData.lateTimeMinutes = lateMinutes;
        const batch = writeBatch(firestore);
        
        let estArrival: string | undefined;
        if (lateMinutes) {
            estArrival = format(addMinutes(safeDate(appointment.startTime), lateMinutes), 'h:mm a');
        }

        if (newStatus === 'running_late' && lateMinutes && lateMinutes > grace) {
            const totalDur = (service?.duration || 60) + (service?.padBefore || 0) + (service?.padAfter || 0);
            let hasConflict = false;
            if (appointment.staffId && allAppointments) {
                const theoreticalEnd = addMinutes(safeDate(appointment.startTime), lateMinutes + totalDur);
                const nextApt = allAppointments.filter(a => a.staffId === appointment.staffId && a.id !== appointment.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > safeDate(appointment.startTime)).sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0];
                if (nextApt && theoreticalEnd > safeDate(nextApt.startTime)) hasConflict = true;
            }
            if (autoCancelEnabled || hasConflict) {
                const fee = Math.ceil((totalDur / 60) * tmhr + premium);
                (updateData as any).status = 'cancelled'; (updateData as any).cancellationReason = hasConflict ? 'clash' : 'late'; (updateData as any).cancellationFeeApplied = fee; (updateData as any).cancellationPaymentStatus = 'unpaid';
                if (appointment.clientId && fee > 0) {
                    batch.update(doc(firestore, `tenants/${tenantId}/clients`, appointment.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: appointment.id, appointmentDate: safeDate(appointment.startTime).toISOString(), feeAmount: fee, reason: `Auto-Cancel: ${hasConflict ? 'Schedule Conflict' : 'Late Arrival'}` }) });
                }
            }
        }
        batch.update(doc(firestore, 'appointmentCheckIns', token), updateData);
        if (appointment.staffId) {
            const statusLabels: Record<string, string> = { 
                on_my_way: 'is on their way', 
                arrived: 'has arrived', 
                running_late: `is running ${lateMinutes}m late (Est. arrival: ${estArrival})`, 
                auto_cancelled: 'appointment was auto-cancelled due to lateness' 
            };
            batch.set(doc(collection(firestore, `tenants/${tenantId}/notifications`)), { 
                userId: appointment.staffId, 
                type: 'client_movement', 
                message: `${client?.name || appointment.clientName} ${statusLabels[newStatus as keyof typeof statusLabels] || 'updated status'}.`, 
                link: '/planner', 
                createdAt: new Date().toISOString(), 
                read: false 
            });
        }
        batch.commit().then(() => {
            setCurrentStatus(newStatus);
            if (newStatus === 'arrived' && isBirthdayToday) {
                setShowBirthdayCelebration(true);
            }
        });
    };

    const handleCompleteIntake = async () => {
        if (!appointment || !firestore || !tenantId || !client) return;
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();

        Object.entries(formAnswers).forEach(([formId, answers]) => {
            const consentDocRef = doc(collection(firestore, `tenants/${tenantId}/clients/${client.id}/signedConsents`));
            const template = consentForms?.find(f => f.id === formId);
            batch.set(consentDocRef, {
                id: consentDocRef.id,
                formId,
                formTitle: template?.title || 'Signed Form',
                clientId: client.id,
                signedAt: now,
                formData: answers,
            });
        });

        batch.update(doc(firestore, 'appointmentCheckIns', token), { checkInStatus: 'arrived' });
        
        if (appointment.staffId) {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/notifications`)), { 
                userId: appointment.staffId, 
                type: 'compliance', 
                message: `${client.name} has completed digital intake and arrived.`, 
                link: '/planner', 
                createdAt: now, 
                read: false 
            });
        }

        await batch.commit();
        setIsIntakeFlow(false);
        setCurrentStatus('arrived');
        if (isBirthdayToday) setShowBirthdayCelebration(true);
    };

    const handleSettleFee = async () => {
        if (!appointment || !firestore || !tenantId || !client) return;
        const batch = writeBatch(firestore);
        const fee = Number(appointment.cancellationFeeApplied || 0);
        const feeRecord = client.unpaidFees?.find(f => f.appointmentId === appointment.id);
        
        batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: new Date().toISOString(), description: `Late Protocol Fee: ${client.name}`, clientOrVendor: client.name, clientId: appointment.clientId, type: 'income', context: 'Business', category: 'Cancellation Fee', amount: fee, paymentMethod: 'Card (Mobile)', hasReceipt: false, appointmentId: appointment.id });
        
        const clientRef = doc(firestore, `tenants/${tenantId}/clients`, appointment.clientId);
        batch.update(clientRef, { outstandingBalance: increment(-fee) });
        if (feeRecord) batch.update(clientRef, { unpaidFees: arrayRemove(feeRecord) });
        
        batch.update(doc(firestore, 'appointmentCheckIns', token), { cancellationPaymentStatus: 'paid' });
        
        await batch.commit();
        toast({ title: "Account Reconciled" }); 
        router.push(`/book/${tenantId}`);
    };

    const handleSubmitReview = async (rating: number, text: string) => {
        if (!appointment || !tenantId || !firestore) return;
        const reviewId = nanoid();
        await setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/reviews`, reviewId), { id: reviewId, tenantId, clientId: appointment.clientId, clientName: client?.name || 'Guest', clientAvatarUrl: client?.avatarUrl || '', staffId: appointment.staffId || '', serviceId: appointment.serviceId, serviceName: service?.name || 'Service', rating, text, isPublic: false, isFeatured: false, createdAt: new Date().toISOString() }, {});
        setReviewSubmitted(true);
    };
    
    if (appointmentLoading || clientLoading || serviceLoading || tenantLoading || staffLoading) return <div className="flex flex-col items-center gap-4"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Initializing Portal...</p></div>;
    
    if (reviewSubmitted) return <ReviewSubmittedView onDone={() => { setReviewSubmitted(false); setIsReviewFlow(false); }} />;
    if (isReviewFlow) return <ReviewFormView serviceName={service.name} staffName={assignedStaff?.name || 'your professional'} onSubmit={handleSubmitReview} onCancel={() => setIsReviewFlow(false)} />;
    if (isIntakeFlow) return <IntakeView requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} onComplete={handleCompleteIntake} />;
    
    if (showBirthdayCelebration) return <BirthdayCelebrationView clientName={client?.name || 'Guest'} onDone={() => setShowBirthdayCelebration(false)} />;

    if (appointment?.status === 'servicing') return <ServicingView serviceName={service.name} />;
    if (appointment?.status === 'ready_for_checkout') return <CheckoutView qrCodeUrl={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(`clarityflow://checkout/${appointment.id}`)}`} ticketId={appointment.id.slice(-6).toUpperCase()} />;
    if (appointment?.status === 'completed') return <ThankYouView tenantId={tenant.id} onLeaveReview={() => setIsReviewFlow(true)} />;
    if (appointment?.status === 'cancelled' || currentStatus === 'auto_cancelled') return <CancelledView tenantId={tenant.id} fee={appointment.cancellationFeeApplied} onSettle={handleSettleFee} />;

    if (!appointment || !client || !service || !tenant) return <CancelledView />;

    return (
        <ViewContainer>
            <ViewHeader title="Identity Check" subtitle="Verify your session" icon={Fingerprint} />
            <CardContent className="p-8 md:p-10 space-y-10">
                {Number(client.outstandingBalance || 0) > 0 && (
                    <Alert variant="destructive" className="bg-destructive/5 border-destructive border-4 rounded-[2rem] p-6 shadow-2xl shadow-destructive/10">
                        <Wallet className="h-6 w-6 text-destructive" />
                        <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Arrears Alert</AlertTitle>
                        <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase text-left">Account balance of <strong className="text-lg tracking-tighter text-destructive">${Number(client.outstandingBalance).toFixed(2)}</strong> detected. Settle with your professional today.</AlertDescription>
                    </Alert>
                )}
                <div className="p-6 md:p-8 rounded-[2.5rem] bg-muted/10 border-2 border-border/50 space-y-6 shadow-inner">
                     <div className="flex items-center gap-6">
                        <Avatar className="w-16 h-16 md:w-20 md:h-20 rounded-2xl border-4 border-background shadow-xl"><AvatarImage src={service.imageUrl} className="object-cover" /><AvatarFallback className="bg-primary/10 text-primary"><Activity className="w-8 h-8" /></AvatarFallback></Avatar>
                        <div className="min-w-0 flex-1 text-left"><p className="font-black text-lg md:text-2xl uppercase tracking-tighter text-slate-900 leading-none mb-2 truncate">{service.name}</p><p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-primary">{format(appointment.startTime, 'EEEE, MMMM d')} &middot; {format(appointment.startTime, 'h:mm a')}</p></div>
                    </div>
                    {assignedStaff && (
                        <div className="pt-6 border-t border-dashed border-border/50">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <Avatar className="h-10 w-10 border-2 border-background shadow-md rounded-xl"><AvatarImage src={assignedStaff.avatarUrl} className="object-cover" /><AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback></Avatar>
                                    <div className="text-left">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 leading-none mb-1">Your Professional</p>
                                        <p className="font-black text-sm uppercase tracking-tight text-slate-800 leading-none">{assignedStaff.name}</p>
                                    </div>
                                </div>
                                {isBirthdayToday && (
                                    <Badge className="bg-primary/10 text-primary border-none font-black text-[8px] uppercase h-6 px-3 rounded-lg shadow-sm">
                                        <Cake className="w-3 h-3 mr-1.5" /> BIRTHDAY MODE
                                    </Badge>
                                )}
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 pt-6 border-t border-dashed border-border/50"><div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5"/> {service.duration}m</div><div className="flex items-center gap-2 truncate max-w-[150px]"><MapPin className="w-3.5 h-3.5"/> {tenant.name}</div></div>
                </div>
                {showLateOptions ? (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
                         <h4 className="text-lg font-black uppercase tracking-tighter text-center text-slate-900">Estimated Delay?</h4>
                        <RadioGroup value={lateTime > 0 ? String(lateTime) : undefined} onValueChange={(val) => setLateTime(parseInt(val))} className="grid grid-cols-4 gap-3">{['5', '10', '15', '20'].map(m => (<div key={m}><RadioGroupItem value={m} id={`late-${m}`} className="peer sr-only" /><Label htmlFor={`late-${m}`} className="flex items-center justify-center h-14 rounded-2xl border-4 border-muted font-black text-lg cursor-pointer transition-all peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary hover:bg-muted/50">{m === '20' ? '20+' : m}</Label></div>))}</RadioGroup>
                        {lateTime > (tenant.lateArrivalGracePeriod || 15) && (<motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-6 rounded-[2rem] bg-destructive/10 border-4 border-destructive/20 text-destructive text-center space-y-3 shadow-xl shadow-destructive/5"><AlertTriangle className="w-8 h-8 mx-auto mb-1 animate-pulse"/><p className="font-black uppercase tracking-tight text-base leading-none">Protocol Warning</p><p className="text-[10px] font-bold uppercase leading-relaxed tracking-tight opacity-80 text-center">Arrivals past {tenant.lateArrivalGracePeriod || 15}m may require a protocol recovery fee.</p></motion.div>)}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><button className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs text-slate-400" onClick={() => {setShowLateOptions(false); setLateTime(0)}}>Back</button><Button onClick={() => handleUpdateStatus('running_late', lateTime)} disabled={lateTime === 0} className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-2xl shadow-primary/20">Update Arrival</Button></div>
                    </div>
                ) : currentStatus === 'pending' ? (
                    <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-4"><Button size="lg" onClick={() => setShowLateOptions(true)} variant="outline" className="h-20 rounded-3xl border-4 font-black uppercase tracking-widest text-xs flex flex-col gap-2"><Clock className="h-6 w-6 opacity-40" />Running Late</Button><Button size="lg" onClick={() => handleUpdateStatus('on_my_way')} className="h-20 rounded-3xl border-4 border-primary/20 bg-primary/5 text-primary font-black uppercase tracking-widest text-xs flex flex-col gap-2 shadow-inner"><Car className="h-6 w-6" />On My Way</Button></div>
                        <Button size="lg" variant="default" onClick={() => handleUpdateStatus('arrived')} className="h-20 rounded-[2rem] font-black uppercase tracking-[0.2em] text-lg shadow-3xl shadow-primary/30 active:scale-95 transition-all"><MapPin className="mr-3 h-6 w-6" />I Have Arrived</Button>
                    </div>
                ) : currentStatus === 'on_my_way' ? (
                    <div className="space-y-8 animate-in zoom-in-95 duration-500"><div className="p-8 bg-primary/5 border-4 border-primary/20 rounded-[2.5rem] text-center space-y-4 shadow-xl"><div className="w-20 h-20 bg-primary rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-primary/30 -rotate-6 animate-bounce"><Car className="w-10 h-10 text-white" /></div><div className="space-y-1"><h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">En Route</h3><p className="text-[10px] font-bold uppercase tracking-widest text-primary opacity-60">We've cleared your path.</p></div></div><Button size="lg" className="w-full h-20 rounded-[2rem] font-black uppercase tracking-[0.2em] text-lg shadow-3xl shadow-primary/30" onClick={() => handleUpdateStatus('arrived')}><MapPin className="mr-3 h-6 w-6" />Tap Upon Arrival</Button></div>
                ) : currentStatus === 'arrived' ? (
                    <div className="p-10 bg-green-500/10 border-4 border-green-500/20 rounded-[3rem] text-center space-y-6 shadow-xl animate-in zoom-in-95"><div className="w-24 h-24 bg-green-500 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/20 rotate-6"><CheckCircle2 className="w-14 h-14 text-white -rotate-6" /></div><div className="space-y-2"><h3 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Checked In</h3><p className="text-sm font-bold uppercase tracking-tight text-slate-500 opacity-80 leading-relaxed text-center">Relax, we've notified {(assignedStaff?.name || 'your pro').split(' ')[0]}. We'll be with you shortly.</p></div></div>
                ) : currentStatus === 'running_late' ? (
                    <div className="space-y-8 animate-in zoom-in-95"><div className="p-10 bg-amber-500/10 border-4 border-amber-500/20 rounded-[3rem] text-center space-y-6 shadow-xl"><div className="w-24 h-24 bg-amber-500 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-amber-500/20 -rotate-6"><Clock className="w-14 h-14 text-white rotate-6 animate-pulse" /></div><div className="space-y-2"><h3 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Noted: +{lateTime}m</h3><p className="text-sm font-bold uppercase tracking-tight text-slate-500 opacity-80 leading-relaxed text-center">Thanks for the heads up! We've adjusted your arrival window on our end.</p></div></div><Button size="lg" variant="outline" className="w-full h-20 rounded-[2rem] border-4 font-black uppercase tracking-[0.2em] text-lg hover:bg-green-50 hover:border-green-500/20 group" onClick={() => handleUpdateStatus('arrived')}><MapPin className="mr-3 h-6 w-6 text-primary group-hover:text-green-600" />Tap Upon Arrival</Button></div>
                ) : null}
            </CardContent>
        </ViewContainer>
    );
}
