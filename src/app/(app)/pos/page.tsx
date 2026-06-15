'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type AppointmentCheckoutState, type Redemption, type TillSession, type Membership, type Package } from '@/lib/data';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter
} from '@/components/ui/card';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark, Smartphone, Cake, Printer, Trash2, Lock, Calendar, BookOpen, Copy, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn, safeNumber } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { resolveDepositPolicy, resolveDepositOutcome, hoursUntilStart, rolloverExpiryISO, isCreditExpired, computeDepositCents } from '@/lib/deposit-policy';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TillManagement } from '@/components/pos/TillManagement';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckInConfirmationDialog } from '@/components/pos/CheckInConfirmationDialog';
import { PrintTicket } from '@/components/planner/PrintTicket';
import { motion, AnimatePresence } from 'framer-motion';

const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj._methodName !== undefined || (obj.constructor && obj.constructor.name === 'FieldValue')) return obj;
  if (typeof obj.isEqual === 'function' && typeof obj._methodName !== undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val?.toDate === 'function') return val.toDate();
  return new Date(val);
};

const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card className="border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-4 pb-2">
      <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
      <div className={cn("p-1.5 md:p-2 rounded-xl", iconBgColor)}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-3.5 h-3.5 md:w-4 md:h-4' })}
      </div>
    </CardHeader>
    <CardContent className="p-3 md:p-4 pt-0 text-left">
      <div className="text-xl md:text-3xl font-black tracking-tighter text-slate-900">{value}</div>
      <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-60 truncate">{description}</p>
    </CardContent>
  </Card>
);

const RecoveryOverrideDialog = ({ open, onOpenChange, staff, onConfirm }: any) => {
    const [pin, setPin] = useState('');
    const [reason, setReason] = useState('');
    const { toast } = useToast();
    const pinInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (open) { setTimeout(() => pinInputRef.current?.focus(), 150); }
        else { setPin(''); setReason(''); }
    }, [open]);

    const handleConfirm = () => {
        const authorizedStaff = (staff || []).find((s: any) => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
        if (!authorizedStaff) { toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager PIN not recognized.' }); return; }
        if (!reason.trim()) { toast({ variant: 'destructive', title: 'Reason Required' }); return; }
        onConfirm(authorizedStaff, reason);
        setPin(''); setReason('');
    };

    const handleOpenChange = (val: boolean) => { if (!val) { setPin(''); setReason(''); } onOpenChange(val); };
    if (!open) return null;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', pointerEvents: 'all' }}>
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 0 }} onClick={() => handleOpenChange(false)} />
            <div style={{ position: 'relative', zIndex: 1, backgroundColor: 'white', borderRadius: '2rem', border: '4px solid #e2e8f0', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', width: '100%', maxWidth: '440px', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
                <div style={{ padding: '1.5rem 1.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <ShieldCheck style={{ width: '1.5rem', height: '1.5rem', color: 'var(--primary, #6366f1)' }} />
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.05em', color: '#0f172a', margin: 0 }}>Recovery Override</h2>
                    </div>
                    <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: '1rem' }}>Manager PIN required to authorize this adjustment.</p>
                </div>
                <div style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', width: '12rem' }}>
                        <label style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#94a3b8' }}>Manager PIN</label>
                        <input ref={pinInputRef} type="number" inputMode="numeric" pattern="[0-9]*" placeholder="0000" maxLength={4} value={pin} onChange={e => setPin(e.target.value.slice(0, 4).replace(/\D/g, ''))}
                            style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 900, height: '5rem', letterSpacing: '0.4em', backgroundColor: '#f8fafc', border: '4px solid #e2e8f0', borderRadius: '1.5rem', outline: 'none', padding: '0 1rem' }} />
                    </div>
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Override Reason</label>
                        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Detail the justification..." rows={3}
                            style={{ width: '100%', borderRadius: '1rem', border: '2px solid #e2e8f0', padding: '0.75rem', fontSize: '0.875rem', fontFamily: 'inherit', resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                </div>
                <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()}
                        style={{ width: '100%', height: '4rem', borderRadius: '1rem', border: 'none', backgroundColor: pin.length < 4 || !reason.trim() ? '#cbd5e1' : '#6366f1', color: 'white', fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: pin.length < 4 || !reason.trim() ? 'not-allowed' : 'pointer' }}>
                        Authorize Override
                    </button>
                    <button onClick={() => handleOpenChange(false)}
                        style={{ width: '100%', height: '2.5rem', borderRadius: '1rem', border: 'none', backgroundColor: 'transparent', color: '#94a3b8', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

const IdentityMatchDialog = ({ open, onOpenChange, walkIn, matchedClient, onLinkSession, onMerge, onKeepSeparate }: any) => {
    const walkInPhone = walkIn?.customerPhone || walkIn?.phone || '';
    const walkInEmail = walkIn?.customerEmail || walkIn?.email || '';
    const hasNewContact = (walkInPhone && walkInPhone !== matchedClient?.phone) || (walkInEmail && walkInEmail !== matchedClient?.email);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg rounded-[3rem] border-4 shadow-3xl bg-background">
                <DialogHeader className="p-6 pb-0 text-left">
                    <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-900">
                        <Fingerprint className="w-6 h-6 text-primary" />Identity Match Found
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
                        This walk-in shares contact info with an existing client record.
                    </DialogDescription>
                </DialogHeader>
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 space-y-2">
                            <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Existing Record</p>
                            <p className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight">{matchedClient?.name}</p>
                            {matchedClient?.phone && <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{matchedClient.phone}</p>}
                            {matchedClient?.email && <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{matchedClient.email}</p>}
                            {matchedClient?.lifetimeValue > 0 && <p className="text-[8px] font-black text-primary uppercase">LTV: ${matchedClient.lifetimeValue.toFixed(0)}</p>}
                        </div>
                        <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-200 space-y-2">
                            <p className="text-[8px] font-black uppercase tracking-widest text-amber-600">Walk-in Guest</p>
                            <p className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight">{walkIn?.customerName}</p>
                            {walkInPhone && <p className={`text-[9px] font-bold uppercase truncate ${walkInPhone !== matchedClient?.phone ? 'text-amber-600' : 'text-slate-500'}`}>{walkInPhone}</p>}
                            {walkInEmail && <p className={`text-[9px] font-bold uppercase truncate ${walkInEmail !== matchedClient?.email ? 'text-amber-600' : 'text-slate-500'}`}>{walkInEmail}</p>}
                            {hasNewContact && <p className="text-[8px] font-black text-amber-600 uppercase">New contact info detected</p>}
                        </div>
                    </div>
                </div>
                <div className="px-6 pb-6 space-y-3">
                    <button onClick={() => onLinkSession(matchedClient)} className="w-full p-4 rounded-2xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-all text-left group">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <p className="text-[11px] font-black uppercase tracking-widest text-primary">Link This Session Only</p>
                                <p className="text-[9px] font-bold text-slate-500 uppercase">Connect today's visit to existing profile. No other changes.</p>
                            </div>
                            <ArrowRight className="w-4 h-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity shrink-0 ml-3" />
                        </div>
                    </button>
                    <button onClick={() => onMerge(matchedClient)} className="w-full p-4 rounded-2xl border-2 border-green-500/20 bg-green-50/50 hover:bg-green-50 hover:border-green-500/40 transition-all text-left group">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <p className="text-[11px] font-black uppercase tracking-widest text-green-700">Merge & Update Profile</p>
                                <p className="text-[9px] font-bold text-slate-500 uppercase">{hasNewContact ? 'Link session and update profile with new contact info.' : 'Link session and confirm this is the same person.'}</p>
                            </div>
                            <ShieldCheck className="w-4 h-4 text-green-600 opacity-40 group-hover:opacity-100 transition-opacity shrink-0 ml-3" />
                        </div>
                    </button>
                    <button onClick={() => onKeepSeparate()} className="w-full p-3 rounded-2xl border-2 border-transparent hover:border-muted hover:bg-muted/20 transition-all text-left group">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Keep as New Guest</p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase">Different person with similar contact info. No changes.</p>
                            </div>
                            <XCircle className="w-4 h-4 text-muted-foreground opacity-40 group-hover:opacity-60 transition-opacity shrink-0 ml-3" />
                        </div>
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

// ─── VoidAuthForm ──────────────────────────────────────────────────────────────
export function VoidAuthForm({ onConfirm, onCancel }: { onConfirm: (pin: string, reason: string) => void; onCancel: () => void }) {
    const [pin, setPin] = React.useState('');
    const [reason, setReason] = React.useState('');
    return (
        <div className="mt-4 p-4 rounded-2xl border-2 border-destructive/20 bg-destructive/5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-destructive">Manager Authorization Required</p>
            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Manager PIN</Label>
                    <Input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="••••" className="h-10 rounded-xl text-center font-black text-lg tracking-widest border-2" />
                </div>
                <div className="space-y-1.5">
                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
                    <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe void reason" className="h-10 rounded-xl border-2" />
                </div>
            </div>
            <div className="flex gap-2">
                <Button onClick={() => onConfirm(pin, reason)} disabled={pin.length < 4 || !reason.trim()} variant="destructive" className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest">Authorize Void</Button>
                <Button onClick={onCancel} variant="ghost" className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest">Cancel</Button>
            </div>
        </div>
    );
}

// ─── QuickBookForm ─────────────────────────────────────────────────────────────
export function QuickBookForm({ clients, services, staff, tenantId, tenant, firestore, onSuccess, onCancel }: any) {
    const { toast } = useToast();
    const [clientSearch, setClientSearch] = React.useState('');
    const [selectedClient, setSelectedClient] = React.useState<any>(null);
    const [newClientName, setNewClientName] = React.useState('');
    const [newClientPhone, setNewClientPhone] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [selectedService, setSelectedService] = React.useState<string>('');
    const [selectedStaff, setSelectedStaff] = React.useState<string>('any');
    const [aptDate, setAptDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));
    const [aptTime, setAptTime] = React.useState(format(addMinutes(new Date(), 15), 'HH:mm'));
    const [sendLink, setSendLink] = React.useState(true);
    const [requestFiles, setRequestFiles] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [generatedLink, setGeneratedLink] = React.useState<string | null>(null);
    const [copied, setCopied] = React.useState(false);
    const [sendStatus, setSendStatus] = React.useState<any>(null);

    const filteredClients = React.useMemo(() => {
        if (!clientSearch.trim()) return clients.slice(0, 8);
        const s = clientSearch.toLowerCase();
        return clients.filter((c: any) => c.name?.toLowerCase().includes(s) || c.phone?.includes(s) || c.email?.toLowerCase().includes(s)).slice(0, 8);
    }, [clients, clientSearch]);

    const selectedSvc = services.find((s: any) => s.id === selectedService);
    const staffMember = staff.find((s: any) => s.id === selectedStaff);

    const svcPrice = selectedSvc ? getServicePrice(selectedSvc, staffMember) : 0;
    const depositCents = selectedSvc ? computeDepositCents({ service: selectedSvc, price: svcPrice, depositsLive: tenant?.depositsLive === true }) : 0;
    const requiredFormIds: string[] = selectedSvc?.requiredFormIds || [];
    const alreadyHasCard = !!selectedClient?.cardOnFile?.token || !!selectedClient?.cardOnFile?.paymentMethodId;

    const copyLink = async () => {
        if (!generatedLink) return;
        try { await navigator.clipboard.writeText(generatedLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }
        catch { toast({ variant: 'destructive', title: 'Copy failed', description: 'Select and copy the link manually.' }); }
    };

    const handleBook = async () => {
        if (!selectedService || !tenantId || !firestore) return;
        if (!selectedClient && !newClientName.trim()) { toast({ variant: 'destructive', title: 'Client Required' }); return; }
        if (sendLink && !email.trim()) { toast({ variant: 'destructive', title: 'Email required', description: 'An email is needed to send the secure completion link.' }); return; }
        setIsSubmitting(true);
        const { nanoid: _nanoid } = await import('nanoid');
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        try {
            let clientId = selectedClient?.id;
            const clientName = selectedClient?.name || newClientName.trim();
            if (!clientId) {
                clientId = _nanoid();
                batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), sanitizeForFirestore({
                    id: clientId, name: clientName, phone: newClientPhone, email: email.trim(),
                    lifetimeValue: 0, lastAppointment: now, status: 'active', reminderSent: false,
                }));
            } else if (email.trim() && !selectedClient?.email) {
                batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), { email: email.trim() }, { merge: true });
            }

            const aptId = _nanoid();
            const checkInToken = _nanoid();
            const startTime = new Date(`${aptDate}T${aptTime}:00`);
            const endTime = addMinutes(startTime, selectedSvc?.duration || 60);
            const resolvedStaffId = selectedStaff === 'any' ? (staff.find((s: any) => s.active)?.id || null) : selectedStaff;
            const aptDoc = sanitizeForFirestore({
                id: aptId, tenantId, clientId, clientName,
                serviceId: selectedService,
                staffId: resolvedStaffId,
                checkInToken,
                status: 'confirmed', source: 'pos_quick_book',
                startTime: startTime.toISOString(), endTime: endTime.toISOString(),
                createdAt: now, reminderSent: false,
                ...(sendLink ? { completionStatus: 'pending', depositAmountCents: depositCents, depositStatus: depositCents > 0 ? 'pending' : 'none' } : {}),
            });
            batch.set(doc(firestore, `tenants/${tenantId}/appointments`, aptId), aptDoc);
            batch.set(doc(firestore, 'appointmentCheckIns', checkInToken), sanitizeForFirestore({ ...aptDoc, tenantId }));

            let link: string | null = null;
            if (sendLink) {
                const token = _nanoid();
                const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
                batch.set(doc(firestore, `tenants/${tenantId}/bookingCompletions`, token), sanitizeForFirestore({
                    token, tenantId, appointmentId: aptId, clientId,
                    clientName, clientEmail: email.trim().toLowerCase(),
                    serviceId: selectedService, serviceName: selectedSvc?.name || '',
                    depositAmountCents: depositCents,
                    requiredConsentFormIds: requiredFormIds,
                    fileRequirements: requestFiles ? [{ id: 'inspo', type: 'file_upload', label: 'Inspiration photos', required: true, prompt: 'Share your inspiration photos', minCount: 1, maxCount: 5, acceptedTypes: ['image/*'] }] : [],
                    status: 'pending', createdAt: now, expiresAt,
                }));
                const origin = typeof window !== 'undefined' ? window.location.origin : '';
                link = `${origin}/complete/${tenantId}/${token}`;
            }

            await batch.commit();

            if (link) {
                setGeneratedLink(link);
                const clientPhone = selectedClient?.phone || newClientPhone;
                try {
                    const sr = await fetch('/api/notifications/send-completion-link', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ link, clientName, clientEmail: email.trim(), clientPhone, studioName: tenant?.name }),
                    });
                    setSendStatus(await sr.json().catch(() => null));
                } catch { setSendStatus(null); }
                toast({ title: 'Appointment booked', description: 'Secure link generated.' });
            } else {
                onSuccess();
            }
        } catch (e) { toast({ variant: 'destructive', title: 'Booking Failed' }); }
        finally { setIsSubmitting(false); }
    };

    if (generatedLink) {
        return (
            <div className="space-y-6">
                <div className="text-center space-y-3 pt-2">
                    <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-8 h-8 text-green-500" />
                    </div>
                    <p className="text-lg font-black uppercase tracking-tight text-slate-900">Appointment booked</p>
                    <p className="text-xs text-muted-foreground font-medium max-w-xs mx-auto">
                        Send this secure link to the client. They'll {depositCents > 0 ? `pay the $${(depositCents / 100).toFixed(2)} deposit, ` : ''}save their card{requiredFormIds.length > 0 ? `, and sign ${requiredFormIds.length} form${requiredFormIds.length > 1 ? 's' : ''}` : ''}.
                    </p>
                </div>
                <div className="rounded-2xl border-2 p-4 bg-muted/5 space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><Link2 className="w-3 h-3" /> Completion link</Label>
                    <div className="flex items-center gap-2">
                        <Input readOnly value={generatedLink} onFocus={(e) => e.currentTarget.select()} className="h-11 rounded-xl border-2 text-[11px] font-mono bg-white" />
                        <Button onClick={copyLink} className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest shrink-0">
                            {copied ? <><CheckCircle2 className="w-4 h-4 mr-1" /> Copied</> : <><Copy className="w-4 h-4 mr-1" /> Copy</>}
                        </Button>
                    </div>
                    {sendStatus && (sendStatus.smsSent || sendStatus.emailSent)
                        ? <p className="text-[10px] text-green-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Sent {sendStatus.smsSent ? 'by text' : ''}{sendStatus.smsSent && sendStatus.emailSent ? ' & ' : ''}{sendStatus.emailSent ? 'by email' : ''} · valid 7 days</p>
                        : <p className="text-[10px] text-muted-foreground font-medium">{sendStatus && !sendStatus.smsConfigured && !sendStatus.emailConfigured ? "Auto-send isn't set up yet — copy the link to send it. " : ''}Valid for 7 days.</p>}
                </div>
                <Button onClick={onSuccess} variant="outline" className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Done</Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Client</Label>
                {selectedClient ? (
                    <div className="flex items-center justify-between p-3 rounded-2xl border-2 border-primary/20 bg-primary/5">
                        <div><p className="font-black text-sm text-slate-900">{selectedClient.name}</p><p className="text-[10px] text-muted-foreground">{selectedClient.phone}</p></div>
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedClient(null); setEmail(''); }} className="text-[10px] font-black uppercase">Change</Button>
                    </div>
                ) : (
                    <>
                        <Input placeholder="Search by name or phone..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} className="h-12 rounded-xl border-2" />
                        {filteredClients.length > 0 && (
                            <div className="rounded-xl border-2 divide-y overflow-hidden">
                                {filteredClients.map((c: any) => (
                                    <button key={c.id} onClick={() => { setSelectedClient(c); setClientSearch(''); setEmail(c.email || ''); }} className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors text-left">
                                        <p className="font-bold text-sm text-slate-900">{c.name}</p>
                                        <p className="text-[10px] text-muted-foreground">{c.phone}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                        {clientSearch && filteredClients.length === 0 && (
                            <div className="space-y-3 p-4 rounded-xl border-2 border-dashed">
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">New Client</p>
                                <Input placeholder="Full name" value={newClientName} onChange={e => setNewClientName(e.target.value)} className="h-10 rounded-xl border-2" />
                                <Input placeholder="Phone number" value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} className="h-10 rounded-xl border-2" />
                            </div>
                        )}
                    </>
                )}
                <Input type="email" placeholder="Email (for receipt & secure link)" value={email} onChange={e => setEmail(e.target.value)} className="h-11 rounded-xl border-2" />
            </div>

            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Service</Label>
                <select value={selectedService} onChange={e => setSelectedService(e.target.value)} className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white">
                    <option value="">Select service…</option>
                    {services.filter((s: any) => s.type === 'service').map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.duration}m)</option>
                    ))}
                </select>
            </div>

            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Provider</Label>
                <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white">
                    <option value="any">First Available</option>
                    {staff.filter((s: any) => s.active).map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</Label>
                    <input type="date" value={aptDate} onChange={e => setAptDate(e.target.value)} min={format(new Date(), 'yyyy-MM-dd')} className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white" />
                </div>
                <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Time</Label>
                    <input type="time" value={aptTime} onChange={e => setAptTime(e.target.value)} className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white" />
                </div>
            </div>

            <button type="button" onClick={() => setSendLink(v => !v)} className={cn("w-full rounded-2xl border-2 p-4 text-left transition-all", sendLink ? "border-primary bg-primary/5" : "border-border bg-white")}>
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-primary" /> Send completion link</p>
                        <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                            {selectedSvc
                                ? <>Client secures a card on file{depositCents > 0 ? `, pays a $${(depositCents / 100).toFixed(2)} deposit` : ''}{requiredFormIds.length > 0 ? `, and signs ${requiredFormIds.length} form${requiredFormIds.length > 1 ? 's' : ''}` : ''}.</>
                                : <>Pick a service to see what the client will complete.</>}
                            {alreadyHasCard && <span className="block mt-1 text-green-600 font-bold">This client already has a card on file.</span>}
                        </p>
                    </div>
                    <div className={cn("w-11 h-6 rounded-full shrink-0 transition-colors relative", sendLink ? "bg-primary" : "bg-slate-200")}>
                        <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", sendLink ? "left-[22px]" : "left-0.5")} />
                    </div>
                </div>
            </button>

            {sendLink && (
              <button type="button" onClick={() => setRequestFiles(v => !v)} className={cn("w-full rounded-2xl border-2 p-4 text-left transition-all", requestFiles ? "border-primary bg-primary/5" : "border-border bg-white")}>
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-primary" /> Request inspiration photos</p>
                        <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">Client uploads reference photos in the same link (up to 5).</p>
                    </div>
                    <div className={cn("w-11 h-6 rounded-full shrink-0 transition-colors relative", requestFiles ? "bg-primary" : "bg-slate-200")}>
                        <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", requestFiles ? "left-[22px]" : "left-0.5")} />
                    </div>
                </div>
              </button>
            )}

            <div className="flex gap-3 pt-2">
                <Button onClick={onCancel} variant="outline" className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                <Button onClick={handleBook} disabled={isSubmitting || !selectedService || (!selectedClient && !newClientName.trim())} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
                    {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : sendLink ? 'Book & Get Link →' : 'Book Appointment →'}
                </Button>
            </div>
        </div>
    );
}

function POSPage() {
    const isMobile = useIsMobile();
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, memberships, packages, resources, discounts, tillSessions, isLoading: isInventoryLoading } = useInventory();
    const { firestore, user: currentUser } = useFirebase();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();

    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<any[]>([]);
    const [tipAmount, setTipAmount] = useState(0);
    const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
    const [isOverrideOpen, setIsOverrideOpen] = useState(false);
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
    const [isCartCollapsed, setIsCartCollapsed] = useState(false);
    const [isTillManagementOpen, setIsTillManagementOpen] = useState(false);
    const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
    const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
    const [pendingCheckInItem, setPendingCheckInItem] = useState<any | null>(null);
    const [ticketToPrint, setTicketToPrint] = useState<any | null>(null);
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    const [redeemedOffer, setRedeemedOffer] = useState<{ type: 'membership' | 'package'; id: string; itemId?: string } | null>(null);
    const [waivedAppointmentFees, setWaivedAppointmentFees] = useState<Map<string, { authorizerId: string; reason: string }>>(new Map());
    const [isRecoveryOverrideOpen, setIsRecoveryOverrideOpen] = useState(false);
    const [pendingIdentityMatch, setPendingIdentityMatch] = useState<any | null>(null);
    const [voidTransactionId, setVoidTransactionId] = useState<string | null>(null);
    const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
    const [isQuickBookOpen, setIsQuickBookOpen] = useState(false);
    const [pendingRefund, setPendingRefund] = useState<any | null>(null);

    const [newWalkInAlert, setNewWalkInAlert] = useState<string | null>(null);
    const prevWalkInCountRef = useRef<number>(0);

    useEffect(() => {
        const waitingCount = (walkIns || []).filter(w => w.status === 'waiting').length;
        if (prevWalkInCountRef.current > 0 && waitingCount > prevWalkInCountRef.current) {
            const newest = [...(walkIns || [])]
                .filter(w => w.status === 'waiting')
                .sort((a, b) => safeDate(b.checkInTime).getTime() - safeDate(a.checkInTime).getTime())[0];
            if (newest) {
                setNewWalkInAlert(`${newest.customerName || 'New guest'} joined the queue`);
                try {
                    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain); gain.connect(ctx.destination);
                    osc.frequency.value = 880;
                    gain.gain.setValueAtTime(0.1, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
                } catch { }
                setTimeout(() => setNewWalkInAlert(null), 5000);
            }
        }
        prevWalkInCountRef.current = waitingCount;
    }, [walkIns]);

    const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
    const activeTill = useMemo(() => tillSessions?.find(s => s.status === 'open') || null, [tillSessions]);

    const readyForCheckoutAppointments = useMemo(() => {
        if (!appointmentsFromInventory || !clients || !services || !staff) return [];
        return appointmentsFromInventory
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { id: apt.id, appointment: apt, client, service, addOnServices, staff: staffMember };
            }).filter((a): a is any => !!(a.client && a.service));
    }, [appointmentsFromInventory, clients, services, staff]);

    const kpiData = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());
        const walkInsToday = (walkIns || []).filter(w => {
            const checkInDate = safeDate(w.checkInTime);
            return checkInDate >= todayStart && checkInDate <= todayEnd;
        });
        const walkInWithServiceStart = walkInsToday.filter(w => w.serviceStartTime);
        const waitTimes = walkInWithServiceStart.map(w => differenceInMinutes(safeDate(w.serviceStartTime), safeDate(w.checkInTime)));
        const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;
        const dailyTransactions = (transactions || []).filter(t => { const d = safeDate(t.date); return d >= todayStart && d <= todayEnd && t.type === 'income'; });
        const totalDailyGrossRevenue = dailyTransactions.reduce((acc, t) => acc + safeNumber(t.amount), 0);
        const newGuestCount = walkInsToday.filter(w => !w.clientId || w.isNewGuest).length;
        const returningCount = walkInsToday.length - newGuestCount;
        const servicedCount = walkInsToday.filter(w => ['servicing','completed'].includes(w.status)).length;
        const conversionRate = walkInsToday.length > 0 ? (servicedCount / walkInsToday.length) * 100 : 0;
        const revenuePerGuest = servicedCount > 0 ? totalDailyGrossRevenue / servicedCount : 0;
        return { avgWaitTime, totalWalkIns: walkInsToday.length, totalDailyGrossRevenue, newGuestCount, returningCount, conversionRate, revenuePerGuest };
    }, [walkIns, transactions]);

    const selectedClient = useMemo(() => clients.find((c: Client) => c.id === selectedClientId), [selectedClientId, clients]);

    const subtotalCalc = useMemo(() => {
        const servicesSub = readyForCheckoutAppointments
            .filter(a => selectedAppointmentIds.has(a.id))
            .reduce((acc, data) => {
                const isServiceRedeemed = redeemedOffer?.itemId === data.service.id;
                const mainStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[data.service.id] || data.appointment.staffId;
                const mainStaff = staff.find(s => s.id === mainStaffId);
                const mainPrice = isServiceRedeemed ? 0 : getServicePrice(data.service, mainStaff);
                const addonsPrice = (data.addOnServices || []).reduce((sum: number, s: any) => {
                    const isAddonRedeemed = redeemedOffer?.itemId === s.id;
                    const addonStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[s.id] || data.appointment.staffId;
                    const addonStaff = staff.find(st => st.id === addonStaffId);
                    return sum + (isAddonRedeemed ? 0 : getServicePrice(s, addonStaff));
                }, 0);
                const adjustments = data.appointment.checkoutState?.adjustments;
                let adjTotal = 0;
                if (adjustments) {
                    const isWaived = waivedAppointmentFees.has(data.appointment.id);
                    if (!isWaived) adjTotal = safeNumber(adjustments.rescheduleFee) + safeNumber(adjustments.timeOverage) + safeNumber(adjustments.materialOverage);
                } else {
                    const isWaived = waivedAppointmentFees.has(data.appointment.id);
                    adjTotal = isWaived ? 0 : safeNumber(data.appointment.checkoutState?.additionalCharge);
                }
                const refreshmentsSub = (data.appointment.checkoutState?.refreshments || []).reduce((sum: number, r: any) => sum + (safeNumber(r.price) * safeNumber(r.quantity || 1)), 0);
                return acc + mainPrice + addonsPrice + adjTotal + refreshmentsSub;
            }, 0);
        const retailSub = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const adjustmentSub = Array.from(appliedAdjustments).reduce((acc, id) => {
            const fee = clients.flatMap(c => c.unpaidFees || []).find(f => f.feeId === id);
            return acc + safeNumber(fee?.feeAmount);
        }, 0);
        return safeNumber(servicesSub + retailSub + adjustmentSub);
    }, [readyForCheckoutAppointments, selectedAppointmentIds, retailItems, appliedAdjustments, clients, waivedAppointmentFees, staff, redeemedOffer]);

    const discountValue = useMemo(() => {
        return safeNumber(appliedDiscountCodes.reduce((acc, code) => {
            const d = (discounts || []).find((dis: any) => dis.code.toUpperCase() === code.toUpperCase());
            if (!d) return acc;
            return acc + (d.type === 'percentage' ? subtotalCalc * (d.value / 100) : d.value);
        }, 0));
    }, [appliedDiscountCodes, discounts, subtotalCalc]);

    const membershipDiscountValue = useMemo(() => {
        if (!selectedClient || !memberships || !packages) return 0;
        const mId = selectedClient.activeMembershipId || selectedClient?.subscription?.membershipId;
        if (selectedClient?.subscription?.status && selectedClient.subscription.status !== 'active') return 0;
        let bestDiscountPct = 0;
        let eligibleProductIds: string[] = [];
        if (mId) {
            const membership = memberships.find(m => m.id === mId);
            if (membership?.retailDiscount) { bestDiscountPct = membership.retailDiscount; eligibleProductIds = membership.applicableProductIds || []; }
        }
        if (bestDiscountPct === 0) return 0;
        return retailItems.reduce((acc, item) => {
            const isEligible = eligibleProductIds.length === 0 || eligibleProductIds.includes(item.id);
            return isEligible ? acc + (item.price * item.quantity * (bestDiscountPct / 100)) : acc;
        }, 0);
    }, [selectedClient, memberships, packages, retailItems]);

    const taxCalc = subtotalCalc * 0.07;
    const totalCalc = subtotalCalc + taxCalc + tipAmount - discountValue - membershipDiscountValue;

    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).forEach(data => { if (data.client?.id) clientIds.add(data.client.id); });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [readyForCheckoutAppointments, selectedAppointmentIds, clients]);

    const handleSelectAppointment = useCallback((id: string) => {
        const nextIds = new Set(selectedAppointmentIds);
        if (nextIds.has(id)) { nextIds.delete(id); if (nextIds.size === 0) setSelectedClientId(null); }
        else { nextIds.add(id); const aptData = readyForCheckoutAppointments.find(a => a.id === id); if (aptData?.client?.id) setSelectedClientId(aptData.client.id); }
        setSelectedAppointmentIds(nextIds);
    }, [readyForCheckoutAppointments, selectedAppointmentIds]);

    const handleAddToCart = useCallback((item: any) => {
        setRetailItems(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            let price = 0; let type: 'product' | 'service' | 'membership' | 'package' = 'product';
            if ('msrp' in item) { price = safeNumber(item.msrp || item.costPerUnit); type = 'product'; }
            else if ('duration' in item) { price = safeNumber(item.price); type = 'service'; }
            else if ('interval' in item) { price = safeNumber(item.price); type = 'membership'; }
            else if ('sessions' in item) { price = safeNumber(item.price); type = 'package'; }
            return [...prev, { id: item.id, name: item.name, quantity: 1, price, type, imageUrl: item.imageUrl, stock: item.totalStock }];
        });
    }, []);

    const handleStartService = (appointmentId: string) => {
        if (!firestore || !tenantId || !appointmentsFromInventory) return;
        const appointment = (appointmentsFromInventory || []).find(a => a.id === appointmentId) || (appointmentsFromInventory || []).find(a => a.id === `apt-walkin-${appointmentId}`);
        if (!appointment) return;
        const nowISO = new Date().toISOString();
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { status: 'servicing', actualStartTime: nowISO });
        if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId });
        if (appointment.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
        if (appointment.isWalkIn) batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', appointment.id.replace('apt-walkin-', '')), { status: 'servicing', serviceStartTime: nowISO });
        batch.commit().then(() => toast({ title: "Service Started" }));
    };

    const handleAssignStaff = useCallback((walkIn: WalkIn, staffId: string) => {
        if (!firestore || !tenantId || !services) return;
        const personServices = (walkIn.serviceIds || []).map(id => (services || []).find(s => s.id === id)).filter(Boolean) as Service[];
        const estimatedDuration = personServices.reduce((acc, s) => acc + (s.duration || 0) + (s.padBefore || 0) + (s.padAfter || 0), 0);
        const now = new Date();
        const walkInEndsAt = addMinutes(now, estimatedDuration);
        const upcomingConflict = (appointmentsFromInventory || []).find(a =>
            a.staffId === staffId &&
            (a.status === 'confirmed' || a.status === 'deposit_pending') &&
            safeDate(a.startTime) > now &&
            safeDate(a.startTime) < walkInEndsAt
        );
        if (upcomingConflict) {
            const conflictTime = format(safeDate(upcomingConflict.startTime), 'h:mm a');
            const conflictClient = clients?.find(c => c.id === upcomingConflict.clientId);
            toast({ variant: 'destructive', title: 'Scheduling Conflict', description: `This provider has ${conflictClient?.name || 'a client'} booked at ${conflictTime} — ${estimatedDuration}m service may overlap.` });
        }
        const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id);
        updateDocumentNonBlocking(walkInRef, { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: now.toISOString() });
        const appointmentId = `apt-walkin-${walkIn.id}`;
        setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { id: appointmentId, tenantId, clientId: walkIn.clientId || walkIn.id, clientName: walkIn.customerName, serviceId: walkIn.serviceIds[0], staffId, status: 'confirmed', source: 'walk-in', isWalkIn: true, startTime: now.toISOString(), endTime: addMinutes(now, estimatedDuration).toISOString() }, {});
        toast({ title: "Staff Assigned" + (upcomingConflict ? " ⚠ Conflict detected" : "") });
    }, [firestore, tenantId, services, appointmentsFromInventory, clients, toast]);

    const handleAssignNext = useCallback(() => {
        if (!firestore || !tenantId || !walkIns || !staff || !services) return;
        const waitingQueue = [...walkIns].filter(w => w.status === 'waiting').sort((a, b) => (a.queueOrder || safeDate(a.checkInTime).getTime()) - (b.queueOrder || safeDate(b.checkInTime).getTime()));
        if (waitingQueue.length === 0) return;
        const nextGuest = waitingQueue[0];
        const idleStaff = staff.filter((s: any) => s.active && !s.onBreak && (s.status === 'idle' || s.status === 'available' || !s.status) && s.acceptingWalkIns !== false);
        if (idleStaff.length === 0) return;
        const walkInDuration = nextGuest.serviceIds.reduce((acc: number, sid: string) => {
            const svc = services.find((ser: Service) => ser.id === sid);
            return acc + (svc?.duration || 0) + (svc?.padBefore || 0) + (svc?.padAfter || 0);
        }, 0);
        const walkInEndsAt = addMinutes(new Date(), walkInDuration);
        const qualified = idleStaff.filter((s: any) => {
            const hasSkills = nextGuest.serviceIds.every((sid: string) => {
                const svc = services.find((ser: Service) => ser.id === sid);
                return !svc?.requiredSkills?.length || svc.requiredSkills.every((skill: string) => (s.skillSet || []).includes(skill));
            });
            if (!hasSkills) return false;
            const hasConflict = (appointmentsFromInventory || []).some(a => a.staffId === s.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > new Date() && safeDate(a.startTime) < walkInEndsAt);
            return !hasConflict;
        });
        if (qualified.length === 0) return;
        const selected = [...qualified].sort((a: any, b: any) => {
            if (assignmentMode === 'ordered_list') return (a.turnOrder || 999) - (b.turnOrder || 999);
            const aTime = a.lastWalkInCompletedAt ? new Date(a.lastWalkInCompletedAt).getTime() : a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0;
            const bTime = b.lastWalkInCompletedAt ? new Date(b.lastWalkInCompletedAt).getTime() : b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0;
            return aTime - bTime;
        })[0];
        handleAssignStaff(nextGuest, selected.id);
    }, [firestore, tenantId, walkIns, staff, services, assignmentMode, appointmentsFromInventory, handleAssignStaff]);

    const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
        if (!firestore || !tenantId || !selectedTenant) return;
        const isAssignedWalkIn = id.startsWith('apt-walkin-');
        const effectiveIsWalkIn = isWalkIn && !isAssignedWalkIn;
        const collectionName = effectiveIsWalkIn ? 'walkIns' : 'appointments';
        const docRef = doc(firestore, 'tenants', tenantId, collectionName, id);
        const tmhrValue = selectedTenant.tmhr || 50;
        const premium = selectedTenant.lateInconveniencePremium || 0;

        if (status === 'running_late' && lateMinutes && !effectiveIsWalkIn) {
            const apt = appointmentsFromInventory?.find(a => a.id === id);
            if (apt) {
                const grace = selectedTenant.lateArrivalGracePeriod || 15;
                const autoCancel = selectedTenant.autoCancelLateArrivals === true;
                const primarySvc = services?.find(s => s.id === apt.serviceId);
                const addOns = (apt.addOnIds || []).map(aid => services?.find(s => s.id === aid)).filter(Boolean) as Service[];
                const totalDur = (primarySvc?.duration || 0) + addOns.reduce((sum, a) => sum + a.duration, 0);
                const totalPadding = (primarySvc?.padBefore || 0) + (primarySvc?.padAfter || 0);
                const fullSessionBlock = totalDur + totalPadding;
                const staffId = apt.staffId;
                let clash = null;
                if (staffId) {
                    const theoreticalStart = addMinutes(safeDate(apt.startTime), lateMinutes);
                    const theoreticalEnd = addMinutes(theoreticalStart, fullSessionBlock);
                    const nextApt = (appointmentsFromInventory || []).filter(a => a.staffId === staffId && a.id !== apt.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > safeDate(apt.startTime)).sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
                    if (nextApt) {
                        const nextService = services?.find(s => s.id === nextApt.serviceId);
                        const nextStartWithPad = subMinutes(safeDate(nextApt.startTime), nextService?.padBefore || 0);
                        if (theoreticalEnd > nextStartWithPad) clash = { nextApt, clashTime: format(nextStartWithPad, 'h:mm a') };
                    }
                }
                if ((lateMinutes > grace && autoCancel) || clash) {
                    const cancelReason = clash ? 'clash' : 'late';
                    const fee = Number(((fullSessionBlock / 60) * tmhrValue + (primarySvc?.cost || 0) + addOns.reduce((sum, a) => sum + (a.cost || 0), 0)).toFixed(2));
                    const batch = writeBatch(firestore);
                    batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: lateMinutes, cancellationReason: cancelReason, cancellationFeeApplied: fee }));
                    if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', tenantId }));
                    if (fee > 0 && apt.clientId) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Auto-Cancel: ${clash ? 'Clash' : 'Late'} (+${lateMinutes}m)` })) });
                    batch.commit().then(() => toast({ title: clash ? "Clash: Auto-Cancelled" : "Late: Auto-Cancelled" }));
                    return;
                } else if (lateMinutes > grace) {
                    const fee = Number(((lateMinutes / 60) * tmhrValue + premium).toFixed(2));
                    const batch = writeBatch(firestore);
                    batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes }));
                    if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes, tenantId }));
                    if (apt.clientId && fee > 0) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Late Penalty: +${lateMinutes}m` })) });
                    batch.commit().then(() => toast({ title: "Status Updated: Fee Applied" }));
                    return;
                }
            }
        }
        const updates: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
        const batch = writeBatch(firestore);
        batch.set(docRef, sanitizeForFirestore(updates), { merge: true });
        const apt = !effectiveIsWalkIn ? appointmentsFromInventory?.find(a => a.id === id) : null;
        if (apt?.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ ...updates, tenantId }), { merge: true });
        batch.commit().then(() => toast({ title: "Status Updated" }));
    };

    const handleCheckout = async (paymentData: { paymentMethod: string, amountTendered: number, recoveryAmount?: number, recoveryReason?: string, skipLedger?: boolean, stripePaymentIntentId?: string }) => {
        const effectiveClientId = selectedClientId
            ?? readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.appointment?.clientId
            ?? null;
        if (!effectiveClientId || !firestore || !tenantId) return;
        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const now = new Date().toISOString();
        const clientObj = (clients || []).find(c => c.id === effectiveClientId);

        let depositCredit: { ref: any; amountCents?: number; amountDollars?: number; createdAt?: any } | null = null;
        try {
            const creditsCol = collection(firestore, `tenants/${tenantId}/depositCredits`);
            let creditSnap = await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientId', '==', effectiveClientId)));
            if (creditSnap.empty && clientObj?.email) {
                creditSnap = await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientEmail', '==', String(clientObj.email).toLowerCase().trim())));
            }
            if (!creditSnap.empty) {
                const found = creditSnap.docs
                    .map(d => ({ ref: d.ref, ...(d.data() as any) }))
                    .filter((c: any) => !isCreditExpired(c.expiresAt));
                found.sort((a, b) => safeDate(b.createdAt).getTime() - safeDate(a.createdAt).getTime());
                depositCredit = found[0] || null;
            }
        } catch (e) { console.warn('[deposit-credit lookup]', e); }
        const depositCreditDollars = depositCredit ? safeNumber((depositCredit as any).amountDollars ?? ((depositCredit as any).amountCents || 0) / 100) : 0;

        const recoveryAmount = safeNumber(paymentData.recoveryAmount);
        const recoveryReason = paymentData.recoveryReason || 'Service Recovery Adjustment';
        let totalLtvIncrease = 0; let totalCashIncrease = 0; let cashTipsTotal = 0;
        const cashTipsByStaffUpdate: Record<string, number> = {};

        for (const aptData of readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id))) {
            const { appointment: apt, service, addOnServices } = aptData;
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
            const checkoutState = apt.checkoutState || {};
            const overrides = checkoutState.serviceStaffOverrides || {};
            const isWaived = waivedAppointmentFees.has(apt.id);
            const mainStaffId = overrides[service.id] || apt.staffId;
            const isMainRedeemed = redeemedOffer?.itemId === service.id;
            const mainStaffMember = staff.find(s => s.id === mainStaffId);
            const mainPartRevenue = isMainRedeemed ? 0 : getServicePrice(service, mainStaffMember);
            totalLtvIncrease += mainPartRevenue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += mainPartRevenue;
            // Skip ledger writes when card was already charged by the API (avoids double-posting)
            if (!paymentData.skipLedger) {
              batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: isMainRedeemed ? `Redemption: ${service.name}` : `Service: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: mainPartRevenue, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: true, tenantId }));
            }

            if (!paymentData.skipLedger) {
              if (!isWaived && checkoutState.adjustments) {
                const { rescheduleFee, timeOverage, materialOverage } = checkoutState.adjustments;
                if (safeNumber(rescheduleFee) > 0) { const amt = safeNumber(rescheduleFee); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Reschedule Recovery: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Protocol Recovery', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId })); }
                if (safeNumber(timeOverage) > 0) { const amt = safeNumber(timeOverage); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Time Floor Overage: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Strategic Adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId })); }
                if (safeNumber(materialOverage) > 0) { const amt = safeNumber(materialOverage); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Material Protocol Overage: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Strategic Adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId })); }
              } else if (!isWaived && safeNumber(checkoutState.additionalCharge) > 0) {
                const amt = safeNumber(checkoutState.additionalCharge); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt;
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Strategic Adjustment Fee`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Adjustment Fee', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId }));
              }
              addOnServices.forEach((addon: any) => {
                const addonStaffId = overrides[addon.id] || apt.staffId;
                const isAddonRedeemed = redeemedOffer?.itemId === addon.id;
                const addonStaff = staff.find((s: any) => s.id === addonStaffId);
                const addonPrice = isAddonRedeemed ? 0 : getServicePrice(addon, addonStaff);
                totalLtvIncrease += addonPrice; if (paymentData.paymentMethod === 'cash') totalCashIncrease += addonPrice;
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: isAddonRedeemed ? `Redemption: ${addon.name}` : `Add-on: ${addon.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Service Revenue', amount: addonPrice, paymentMethod: paymentData.paymentMethod, staffId: addonStaffId, appointmentId: apt.id, hasReceipt: true, tenantId }));
              });
              (checkoutState.refreshments || []).forEach((amenity: any) => {
                const qty = safeNumber(amenity.quantity || 1);
                const amenityPrice = safeNumber(amenity.price) * qty;
                if (amenityPrice > 0) { totalLtvIncrease += amenityPrice; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amenityPrice; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Concierge: ${amenity.name} (x${qty})`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Hospitality Revenue', amount: amenityPrice, paymentMethod: paymentData.paymentMethod, appointmentId: apt.id, hasReceipt: false, tenantId })); }
              });
            } else {
              // skipLedger=true: still accumulate totals for LTV even though we skip writing transactions
              if (!isWaived && checkoutState.adjustments) {
                const { rescheduleFee, timeOverage, materialOverage } = checkoutState.adjustments;
                totalLtvIncrease += safeNumber(rescheduleFee) + safeNumber(timeOverage) + safeNumber(materialOverage);
              } else if (!isWaived) {
                totalLtvIncrease += safeNumber(checkoutState.additionalCharge);
              }
              addOnServices.forEach((addon: any) => {
                const isAddonRedeemed = redeemedOffer?.itemId === addon.id;
                const addonStaff = staff.find((s: any) => s.id === (overrides[addon.id] || apt.staffId));
                totalLtvIncrease += isAddonRedeemed ? 0 : getServicePrice(addon, addonStaff);
              });
            }

            batch.update(appointmentRef, sanitizeForFirestore({ status: 'completed', revenue: mainPartRevenue + addOnServices.reduce((s: number, a: any) => s + getServicePrice(a, staff.find(st => st.id === (overrides[a.id] || apt.staffId))), 0), actualEndTime: now }));
            if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ status: 'completed' }));

            const involvedIds = new Set<string>();
            if (apt.staffId) involvedIds.add(apt.staffId);
            if (overrides) Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            involvedIds.forEach(sid => {
                if (sid) batch.update(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'available', lastWalkInCompletedAt: now });
            });
        }

        retailItems.forEach(item => {
            const productValue = item.price * item.quantity;
            if (!paymentData.skipLedger) {
              batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Retail: ${item.quantity}x ${item.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Retail', amount: productValue, paymentMethod: paymentData.paymentMethod, hasReceipt: true, tenantId }));
            }
            batch.update(doc(firestore, 'tenants', tenantId, 'inventory', item.id), { totalStock: increment(-item.quantity) });
            batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), sanitizeForFirestore({ id: nanoid(), productId: item.id, date: now, change: -item.quantity, unit: 'units', reason: `Retail Sale: ${item.name} for ${clientObj?.name || 'Guest'}` }));
            totalLtvIncrease += productValue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += productValue;
        });

        if (clientObj && appliedAdjustments.size > 0) {
            const currentUnpaid = clientObj.unpaidFees || [];
            const settledTotal = Array.from(appliedAdjustments).reduce((sum, id) => { const fee = currentUnpaid.find(f => f.feeId === id); return sum + safeNumber(fee?.feeAmount); }, 0);
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), { unpaidFees: currentUnpaid.filter(f => !appliedAdjustments.has(f.feeId)), outstandingBalance: increment(-settledTotal) });
            if (paymentData.paymentMethod === 'cash') totalCashIncrease += settledTotal;
            appliedAdjustments.forEach(id => { const fee = currentUnpaid.find(f => f.feeId === id); if (fee) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Debt Settlement: ${fee.reason}`, clientOrVendor: clientObj.name, clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: fee.feeAmount, paymentMethod: paymentData.paymentMethod, hasReceipt: false, tenantId })); });
            totalLtvIncrease += settledTotal;
        }

        if (clientObj) {
            const finalLtvDelta = Math.max(0, totalLtvIncrease - discountValue - membershipDiscountValue - recoveryAmount);
            const updates: any = { lifetimeValue: increment(finalLtvDelta), lastAppointment: now };
            if (redeemedOffer) {
                const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${effectiveClientId}/redemptions`));
                const offeringName = redeemedOffer.type === 'membership' ? memberships?.find(m => m.id === redeemedOffer.id)?.name : packages?.find(p => p.id === redeemedOffer.id)?.name;
                batch.set(redemptionRef, sanitizeForFirestore({ id: redemptionRef.id, clientId: effectiveClientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, serviceName: services?.find(s => s.id === redeemedOffer.itemId)?.name || 'Service', date: now, staffId: currentUser?.uid, tenantId }));
                if (redeemedOffer.type === 'package') updates.activePackages = (clientObj.activePackages || []).map(p => p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p).filter(p => p.sessionsRemaining > 0);
                else { updates[`subscription.perkUsage.${redeemedOffer.itemId}`] = increment(1); updates['subscription.perkLastUsed'] = now; }
            }
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), updates);
        }

        Object.entries(tipAllocations).forEach(([staffId, amount]) => {
            const finalAmount = safeNumber(amount);
            if (finalAmount > 0) {
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: 'Gratuity', clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Tips', amount: finalAmount, paymentMethod: paymentData.paymentMethod, staffId, hasReceipt: true, tenantId }));
                if (paymentData.paymentMethod === 'cash') { cashTipsTotal += finalAmount; cashTipsByStaffUpdate[`cashTipsByStaff.${staffId}`] = increment(finalAmount); }
            }
        });

        if (!paymentData.skipLedger) {
          if (discountValue > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Promotion Applied`, clientOrVendor: 'Internal', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Discounts', amount: discountValue, paymentMethod: 'Internal', hasReceipt: false, tenantId }));
          if (recoveryAmount > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Service Recovery: ${recoveryReason}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Discounts', amount: recoveryAmount, notes: recoveryReason, paymentMethod: 'Internal', hasReceipt: false, tenantId }));
        }

        let cashDepositOffset = 0;
        if (depositCredit && depositCreditDollars > 0) {
            const firstAptId = readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.appointment?.id || null;
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: 'Deposit applied (prepaid online)', clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Deposit Applied', amount: depositCreditDollars, paymentMethod: 'Deposit', hasReceipt: false, tenantId }));
            batch.update((depositCredit as any).ref, sanitizeForFirestore({ status: 'consumed', consumedAt: now, appointmentId: firstAptId }));
            cashDepositOffset = Math.min(depositCreditDollars, totalCashIncrease);
        }

        if (paymentTab === 'cash' && activeTill) {
            const finalCashInput = totalCashIncrease + cashTipsTotal - cashDepositOffset;
            batch.update(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), sanitizeForFirestore({ expectedCash: increment(finalCashInput), totalCashSales: increment(totalCashIncrease - cashDepositOffset), totalCashTips: increment(cashTipsTotal), ...cashTipsByStaffUpdate }));
        }

        try {
            await batch.commit();
            toast({ title: "Checkout Successful" });
            setRetailItems([]); setSelectedAppointmentIds(new Set()); setTipAmount(0); setIsCartSheetOpen(false); setRedeemedOffer(null); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set());
        } catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Checkout Failed' }); }
        finally { setIsSubmitting(false); }
    };

    const settleDepositForCancellation = useCallback(async (appointment: any, trigger: 'client_cancel' | 'no_show' | 'studio_cancel') => {
        if (!firestore || !tenantId || !appointment) return;
        const clientId = appointment.clientId || null;
        const clientObj = (clients || []).find(c => c.id === clientId);
        let credit: any = null;
        try {
            const creditsCol = collection(firestore, `tenants/${tenantId}/depositCredits`);
            let snap: any = clientId ? await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientId', '==', clientId))) : { empty: true, docs: [] };
            if (snap.empty && clientObj?.email) snap = await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientEmail', '==', String(clientObj.email).toLowerCase().trim())));
            if (!snap.empty) {
                const found = snap.docs.map((d: any) => ({ ref: d.ref, ...(d.data() as any) })).filter((c: any) => !isCreditExpired(c.expiresAt));
                found.sort((a: any, b: any) => safeDate(b.createdAt).getTime() - safeDate(a.createdAt).getTime());
                credit = found[0] || null;
            }
        } catch (e) { console.warn('[deposit cancel lookup]', e); }
        if (!credit) return;
        const policy = resolveDepositPolicy(selectedTenant);
        const hrs = hoursUntilStart(appointment.startTime);
        const resolved = resolveDepositOutcome({ trigger, hoursUntilStart: hrs, policy });
        const amount = safeNumber(credit.amountDollars ?? (credit.amountCents || 0) / 100);
        if (resolved.outcome === 'refund') { setPendingRefund({ creditId: credit.id, amount, clientName: clientObj?.name || credit.clientName || 'Client', reason: resolved.reason, appointmentId: appointment.id }); return; }
        const nowISO = new Date().toISOString();
        const batch = writeBatch(firestore);
        if (resolved.outcome === 'rollover') {
            batch.set(credit.ref, sanitizeForFirestore({ status: 'available', rolledOver: true, rolledOverAt: nowISO, rolledOverFromAppointmentId: appointment.id, expiresAt: rolloverExpiryISO(policy), lastDecisionReason: resolved.reason }), { merge: true });
        } else {
            batch.set(credit.ref, sanitizeForFirestore({ status: 'forfeited', forfeitedAt: nowISO, forfeitedFromAppointmentId: appointment.id, lastDecisionReason: resolved.reason }), { merge: true });
        }
        const auditRef = doc(collection(firestore, `tenants/${tenantId}/depositDecisions`));
        batch.set(auditRef, sanitizeForFirestore({ id: auditRef.id, tenantId, creditId: credit.id, appointmentId: appointment.id, clientId, clientName: clientObj?.name || credit.clientName || 'Client', trigger, outcome: resolved.outcome, reason: resolved.reason, amountDollars: amount, hoursUntilStart: hrs, decidedAt: nowISO }));
        try { await batch.commit(); toast({ title: resolved.outcome === 'rollover' ? 'Deposit rolled over' : 'Deposit forfeited', description: `$${amount.toFixed(2)} · ${resolved.reason}` }); }
        catch (e) { console.error('[deposit settle]', e); }
    }, [firestore, tenantId, clients, selectedTenant, toast]);

    const handleConfirmRefund = useCallback(async () => {
        if (!pendingRefund || !tenantId) return;
        try {
            const res = await fetch('/api/stripe/deposit-refund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, creditId: pendingRefund.creditId }) });
            const out = await res.json().catch(() => null);
            if (!res.ok || !out?.ok) { toast({ variant: 'destructive', title: 'Refund failed', description: out?.error || 'Could not refund the deposit.' }); }
            else { toast({ title: 'Deposit refunded', description: `$${safeNumber(pendingRefund.amount).toFixed(2)} returned to ${pendingRefund.clientName}.` }); }
        } catch (e: any) { toast({ variant: 'destructive', title: 'Refund failed', description: e.message }); }
        finally { setPendingRefund(null); }
    }, [pendingRefund, tenantId, toast]);

    const handleCancelAction = (id: string, isWalkIn: boolean) => {
        const isAssignedWalkIn = id.startsWith('apt-walkin-');
        const effectiveIsWalkIn = isWalkIn && !isAssignedWalkIn;
        const item = effectiveIsWalkIn ? walkIns?.find(w => w.id === id) : appointmentsFromInventory?.find(a => a.id === id);
        if (item) { setSelectedAppointment({ ...item, isWalkIn: effectiveIsWalkIn } as any); setIsCancelDialogOpen(true); }
    };

    const handleResolveCheckInConfirmation = async (data: any) => {
        if (!pendingCheckInItem || !firestore || !tenantId) return;
        const isWalkIn = !!pendingCheckInItem.serviceIds;
        const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', pendingCheckInItem.id) : doc(firestore, 'tenants', tenantId, 'appointments', pendingCheckInItem.id);
        const batch = writeBatch(firestore);
        const updates: any = { serviceId: data.serviceId, addOnIds: data.addOnIds, checkInStatus: 'arrived', notes: data.notes };
        if (data.accommodations?.length) updates.sensoryNeeds = data.accommodations.join(', ');
        batch.update(docRef, sanitizeForFirestore(updates));
        if (!isWalkIn && pendingCheckInItem.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', pendingCheckInItem.checkInToken), sanitizeForFirestore({ ...updates, tenantId }));
        if (pendingCheckInItem.clientId) batch.update(doc(firestore, `tenants/${tenantId}/clients`, pendingCheckInItem.clientId), sanitizeForFirestore({ email: data.email, phone: data.phone, ...(data.accommodations?.length ? { sensoryNeeds: data.accommodations.join(', ') } : {}) }));
        try { await batch.commit(); toast({ title: "Check-in Certified" }); setPendingCheckInItem(null); }
        catch (e) { console.error(e); toast({ variant: 'destructive', title: "Confirmation Failed" }); }
    };

    const handleRevertToService = (appointmentId: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, appointmentId), { status: 'servicing' }); toast({ title: "Status Reverted" }); };
    const handleRevertToReady = (appointmentId: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, appointmentId), { status: 'ready_for_checkout' }); toast({ title: "Status Reverted" }); };
    const handleOpenTill = (data: any) => { if (!firestore || !tenantId) return; const sessionRef = doc(collection(firestore, 'tenants', tenantId, 'tillSessions')); const newSession: any = { ...data, id: sessionRef.id, openedAt: new Date().toISOString(), status: 'open', expectedCash: data.openingFloat, totalCashSales: 0, totalCashTips: 0, totalCashRefunds: 0, cashTipsByStaff: {} }; setDocumentNonBlocking(sessionRef, sanitizeForFirestore(newSession), {}); toast({ title: "Till Session Initialized" }); };
    const handleCloseTill = (data: any) => { if (!firestore || !tenantId || !activeTill) return; updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'tillSessions', activeTill.id), sanitizeForFirestore({ ...data, status: 'closed', closedAt: new Date().toISOString() })); toast({ title: "Till Session Finalized" }); };

    const handleVoidTransaction = async (txId: string, authorizerPin: string, reason: string) => {
        if (!firestore || !tenantId) return;
        const authSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/staff`), where('pin', '==', authorizerPin)));
        const authorizer = authSnap.docs[0];
        if (!authorizer || !['admin','owner'].includes(authorizer.data().role)) { toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager PIN required to void transactions.' }); return; }
        const txRef = doc(firestore, `tenants/${tenantId}/transactions`, txId);
        const batch = writeBatch(firestore);
        batch.update(txRef, sanitizeForFirestore({ voided: true, voidedAt: new Date().toISOString(), voidedBy: authorizer.id, voidReason: reason }));
        const reversalRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
        const originalTx = transactions?.find(t => t.id === txId);
        if (originalTx) {
            batch.set(reversalRef, sanitizeForFirestore({ id: reversalRef.id, date: new Date().toISOString(), description: `VOID: ${originalTx.description}`, clientOrVendor: originalTx.clientOrVendor, clientId: originalTx.clientId, type: originalTx.type === 'income' ? 'expense' : 'income', context: 'Business', category: 'Void', amount: originalTx.amount, paymentMethod: originalTx.paymentMethod, voidOf: txId, notes: reason, hasReceipt: false, tenantId }));
        }
        await batch.commit();
        toast({ title: 'Transaction Voided', description: `Reversal recorded. Authorized by ${authorizer.data().name}.` });
        setIsVoidDialogOpen(false);
        setVoidTransactionId(null);
    };

    const checkoutHubProps = {
        cart: retailItems, onCartChange: setRetailItems, appointmentsData: readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)), onSelectAppointment: handleSelectAppointment,
        clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1, payerOptions: payerOptions || [], selectedClientId, setSelectedClientId,
        onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => {},
        subtotal: subtotalCalc, tax: taxCalc, total: totalCalc, tipAmount, setTipAmount, onCheckout: handleCheckout,
        appliedDiscountCodes, setAppliedDiscountCodes, discount: discountValue, membershipDiscount: membershipDiscountValue,
        isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
        appliedAdjustments, onApplyAdjustmentToggle: (id: string, apply: boolean) => { const next = new Set(appliedAdjustments); if (apply) next.add(id); else next.delete(id); setAppliedAdjustments(next); },
        redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [],
        allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
        waivedAppointmentFees, onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string) => { setWaivedAppointmentFees(prev => { const next = new Map(prev); if (waive && authorizerId && reason) next.set(id, { authorizerId, reason }); else next.delete(id); return next; }); },
        tipAllocations, setTipAllocations, activeTill, staff, role,
        onRequestOverride: () => { setIsCartSheetOpen(false); setTimeout(() => setIsRecoveryOverrideOpen(true), 300); },
        tenantId, // ← CRITICAL: enables card-on-file charging and embedded card form
    };

    if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>;

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-background text-left">
            <AppHeader title="Studio POS" />
            <div className={cn("flex-1 grid transition-all duration-500 ease-in-out overflow-hidden", isCartCollapsed ? "lg:grid-cols-[1fr,80px]" : "lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px]")}>
                <main className="flex-1 flex flex-col overflow-auto p-4 md:p-10 gap-10 pb-32 lg:pb-10 text-left">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-2">
                        <div className="grid gap-4 md:gap-6 grid-cols-2 lg:grid-cols-4 flex-1 w-full text-left">
                            <KpiCard title="Avg Wait" value={`${kpiData.avgWaitTime.toFixed(0)}m`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100" description="Check-in to chair." />
                            <KpiCard title="Today's Guests" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500" />} iconBgColor="bg-purple-100" description={`${kpiData.newGuestCount} new · ${kpiData.returningCount} returning`} />
                            <KpiCard title="Daily Gross" value={`$${safeNumber(kpiData.totalDailyGrossRevenue).toFixed(2)}`} icon={<DollarSign className="text-amber-500" />} iconBgColor="bg-amber-100" description={`$${kpiData.revenuePerGuest.toFixed(0)}/guest`} />
                            <KpiCard title="Conversion" value={`${kpiData.conversionRate.toFixed(0)}%`} icon={<Sparkles className="text-green-500" />} iconBgColor="bg-green-100" description="Walk-in → serviced" />
                        </div>
                        {isOwnerOrAdminUser && (<Button variant={activeTill ? "outline" : "default"} onClick={() => setIsTillManagementOpen(true)} className={cn("h-14 md:h-20 px-8 rounded-3xl font-black uppercase text-xs shadow-xl border-4 flex flex-col items-center justify-center gap-1", activeTill ? "border-green-500/20 bg-green-500/5 text-green-700" : "shadow-primary/20")}><Landmark className="w-5 h-5 mb-1" /> {activeTill ? `Till: $${safeNumber(activeTill.expectedCash).toFixed(2)}` : "Open Studio Till"}</Button>)}
                    </div>
                    <div className="grid gap-10 grid-cols-1">
                        <div className="flex items-center gap-3 flex-wrap">
                            <Button onClick={() => setIsQuickBookOpen(true)} variant="outline" className="h-10 px-4 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest hover:bg-primary/10 gap-2">
                                <Calendar className="w-4 h-4" /> Quick Book
                            </Button>
                            <Button onClick={() => setIsVoidDialogOpen(true)} variant="outline" className="h-10 px-4 rounded-xl border-2 border-red-200 bg-red-50 text-red-600 font-black uppercase text-[10px] tracking-widest hover:bg-red-100 gap-2" disabled={!transactions?.some(t => isToday(safeDate(t.date)) && !t.voided)}>
                                <XCircle className="w-4 h-4" /> Void Tx
                            </Button>
                        </div>

                        <TeamStatus staff={staff} onStatusChange={(id: any, act: any) => {}} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} services={services} onReorder={(newOrder: any) => { if (!firestore || !tenantId) return; const batch = writeBatch(firestore); newOrder.forEach((s: any, idx: number) => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: idx }, { merge: true }); }); batch.commit(); }} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} resources={resources || []} onForceIdle={(staffId: string) => { if (!firestore || !tenantId) return; setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'staff', staffId), { status: 'idle' }, { merge: true }); toast({ title: "Staff Reset" }); }} />

                        <WalkInQueue walkIns={walkIns} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} onCancel={handleCancelAction} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={() => {}} assignmentMode={assignmentMode} onPrintTicket={(id: string) => { const item = (walkIns || []).find(w => w.id === id) || (appointmentsFromInventory || []).find(a => a.id === id); if (item) { const client = clients?.find(c => c.id === item.clientId); const service = services?.find(s => s.id === (item.serviceId || item.serviceIds?.[0])); if (client && service) { setTicketToPrint({ business: { name: selectedTenant?.name || 'Studio', phone: selectedTenant?.twilioPhoneNumber || '' }, client, service, appointment: item }); setIsPrintDialogOpen(true); } } }} onSkip={(id: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', id), { status: 'skipped' }); }} onReturnToQueue={(id: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', id), { status: 'waiting' }); }} groupSizes={useMemo(() => { const sizes = new Map<string, number>(); (walkIns || []).forEach((w: any) => { if (w.groupId && w.groupSize) sizes.set(w.groupId, w.groupSize); else if (w.groupId) sizes.set(w.groupId, (sizes.get(w.groupId) || 0) + 1); }); return sizes; }, [walkIns])} onToggleWaitForStaff={() => {}} onFinishService={(apt: any) => { setAppointmentToReview(apt); setIsTechnicianReviewOpen(true); }} onUpdateStatus={handleUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={(item: any) => { if (item.isPotentialAlias && item.matchedClient) { setPendingIdentityMatch(item); } else if (item.type === 'walk-in') { setPendingCheckInItem(item); } else { setSelectedAppointment(item); setIsDetailsOpen(true); } }} />

                        <div className="space-y-4 text-left">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Retail & Additions</h3>
                            <RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => {}} />
                        </div>
                    </div>
                </main>

                <aside className={cn("hidden lg:flex border-l-4 border-muted/30 bg-white flex-col h-full transition-all duration-500 relative overflow-hidden", isCartCollapsed ? "w-20" : "w-full")}>
                    {!isCartCollapsed ? (
                        <div className="flex flex-col h-full w-full">
                            <div className="absolute top-6 left-[-24px] z-50">
                                <Button variant="outline" size="icon" onClick={() => setIsCartCollapsed(true)} className="h-12 w-12 rounded-2xl border-4 border-white bg-white shadow-xl hover:bg-muted text-slate-400 group transition-all"><ChevronRight className="h-6 w-6 group-hover:translate-x-0.5 transition-transform" /></Button>
                            </div>
                            <div className="absolute inset-0 flex flex-col">
                                <ScrollArea className="flex-1">
                                    <div className="p-6 pb-40">
                                        <CheckoutHub {...checkoutHubProps} />
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center py-8 gap-8 h-full">
                            <button onClick={() => setIsCartCollapsed(false)} className="h-12 w-12 rounded-2xl bg-primary/5 text-primary hover:bg-primary/10 shadow-sm flex items-center justify-center"><ChevronLeft className="h-6 w-6" /></button>
                            <div className="flex flex-col items-center gap-1 [writing-mode:vertical-lr] rotate-180">
                                <span className="font-black uppercase tracking-[0.3em] text-sm text-slate-900 opacity-40">Current Sale</span>
                                <span className="font-black text-primary text-xl mt-6 tracking-tighter">${totalCalc.toFixed(2)}</span>
                            </div>
                            <div className="mt-auto pb-8">
                                <Badge className="rounded-full h-8 w-8 flex items-center justify-center p-0 font-black bg-primary text-white border-none shadow-lg animate-in zoom-in duration-300">{retailItems.length + selectedAppointmentIds.size}</Badge>
                            </div>
                        </div>
                    )}
                </aside>
            </div>

            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-xl lg:hidden z-40">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild>
                            <Button className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30">View Cart (${totalCalc.toFixed(2)})</Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="h-[95dvh] p-0 flex flex-col border-none rounded-t-[3rem] bg-background">
                            <SheetHeader className="p-8 pb-4 border-b bg-muted/5 flex-shrink-0">
                                <SheetTitle className="text-2xl font-black uppercase tracking-tighter">Current Sale</SheetTitle>
                            </SheetHeader>
                            <div className="flex-1 overflow-y-auto">
                                <div className="p-6 pb-24">
                                    <CheckoutHub {...checkoutHubProps} />
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            )}

            <AnimatePresence>
                {newWalkInAlert && (
                    <motion.div initial={{ opacity: 0, y: 60, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground px-6 py-4 rounded-2xl shadow-2xl shadow-primary/30 flex items-center gap-3 border border-primary/20 whitespace-nowrap">
                        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        <p className="font-black uppercase tracking-widest text-xs">{newWalkInAlert}</p>
                    </motion.div>
                )}
            </AnimatePresence>

            <RecoveryOverrideDialog open={isRecoveryOverrideOpen} onOpenChange={setIsRecoveryOverrideOpen} staff={staff || []} onConfirm={(authorizer: any, reason: string) => { setIsRecoveryOverrideOpen(false); toast({ title: "Override Authorized", description: `Approved by ${authorizer.name}. Proceed with adjustment.` }); }} />
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={() => {}} />
            <AppointmentDetailsSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment} client={clients?.find(c => c.id === selectedAppointment?.clientId) || null} service={services?.find(s => s.id === selectedAppointment?.serviceId) || null} tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []} onStartService={handleStartService} onFinishService={(apt: any) => { setAppointmentToReview(apt); setIsTechnicianReviewOpen(true); }} onEdit={() => {}} onDelete={(id: string) => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))} onCancel={handleCancelAction} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}} onOverride={() => setIsOverrideOpen(true)} onWaiveFee={() => {}} />
            {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={async (data: any) => {
                if (!selectedAppointment || !firestore || !tenantId) return;
                const batch = writeBatch(firestore);
                const isAssignedWalkIn = selectedAppointment.id.startsWith('apt-walkin-');
                const effectiveIsWalkIn = (selectedAppointment as any).isWalkIn || (isAssignedWalkIn && !selectedAppointment.clientId);
                const collectionPath = effectiveIsWalkIn ? 'walkIns' : 'appointments';
                const updates = { status: 'cancelled' as const, cancellationReason: data.reason, cancellationFeeApplied: data.feeAmount };
                batch.set(doc(firestore, `tenants/${tenantId}/${collectionPath}`, selectedAppointment.id), sanitizeForFirestore(updates), { merge: true });
                await batch.commit();
                if (data.feeAmount > 0 && selectedAppointment.clientId) {
                    if (data.paymentMethod === 'card_on_file') {
                        try {
                            const res = await fetch('/api/stripe/charge-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId: selectedAppointment.clientId, amountCents: Math.round(data.feeAmount * 100), description: 'Cancellation fee', category: 'Cancellation Fee', appointmentId: selectedAppointment.id, reason: data.reason }) });
                            const out = await res.json().catch(() => null);
                            if (out?.ok) { toast({ title: 'Fee charged', description: `$${safeNumber(data.feeAmount).toFixed(2)} charged to card on file.` }); }
                            else { toast({ variant: 'destructive', title: 'Card charge flagged', description: `${out?.reason || 'Could not charge card'} — added to client balance for follow-up.` }); }
                        } catch (e: any) { toast({ variant: 'destructive', title: 'Card charge flagged', description: `${e.message} — added to client balance.` }); }
                    } else if (data.paymentMethod === 'add_to_balance') {
                        updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, selectedAppointment.clientId), { outstandingBalance: increment(data.feeAmount) });
                    }
                }
                await settleDepositForCancellation(selectedAppointment, data.reason === 'no-show' ? 'no_show' : 'client_cancel');
                setIsCancelDialogOpen(false);
                setIsDetailsOpen(false);
            }} />}
            <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={staff || []} onConfirm={async (sid: string, res: string) => { updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id), { status: 'confirmed', checkInStatus: 'pending', overrideReason: res, overriddenBy: sid }); setIsOverrideOpen(false); setIsDetailsOpen(false); }} />
            {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: (clients || []).find(c => c.id === appointmentToReview.clientId), service: (services || []).find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={async (id: string, state: any) => {
                if (!firestore || !tenantId) return;
                const apt = (appointmentsFromInventory || []).find(a => a.id === id);
                const batch = writeBatch(firestore);
                batch.update(doc(firestore, `tenants/${tenantId}/appointments`, id), sanitizeForFirestore({ status: 'ready_for_checkout', checkoutState: state, actualEndTime: new Date().toISOString() }));
                if (apt?.staffId) { batch.update(doc(firestore, 'tenants', tenantId, 'staff', apt.staffId), { status: 'available', lastWalkInCompletedAt: new Date().toISOString() }); }
                await batch.commit();
                setIsTechnicianReviewOpen(false);
            }} />}
            <TillManagement open={isTillManagementOpen} onOpenChange={setIsTillManagementOpen} activeTill={activeTill} staff={staff || []} onOpenTill={handleOpenTill} onCloseTill={handleCloseTill} requireTillWitness={selectedTenant?.requireTillWitness !== false} />
            <CheckInConfirmationDialog open={!!pendingCheckInItem} onOpenChange={() => setPendingCheckInItem(null)} item={pendingCheckInItem} services={services || []} tenant={selectedTenant} onConfirm={handleResolveCheckInConfirmation} />

            <IdentityMatchDialog open={!!pendingIdentityMatch} onOpenChange={() => setPendingIdentityMatch(null)} walkIn={pendingIdentityMatch} matchedClient={pendingIdentityMatch?.matchedClient}
                onLinkSession={async (matchedClient: any) => {
                    if (!firestore || !tenantId || !pendingIdentityMatch) return;
                    if (pendingIdentityMatch.type !== 'walk-in') { toast({ title: 'Cannot link', description: 'Identity matching only applies to walk-in guests.' }); setPendingIdentityMatch(null); return; }
                    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name });
                    toast({ title: "Session Linked", description: `Today's visit linked to ${matchedClient.name}.` });
                    setPendingIdentityMatch(null);
                }}
                onMerge={async (matchedClient: any) => {
                    if (!firestore || !tenantId || !pendingIdentityMatch) return;
                    const walkInPhone = pendingIdentityMatch.customerPhone || pendingIdentityMatch.phone || '';
                    const walkInEmail = pendingIdentityMatch.customerEmail || pendingIdentityMatch.email || '';
                    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name });
                    const clientUpdates: any = {};
                    if (walkInPhone && walkInPhone !== matchedClient.phone) clientUpdates.phone = walkInPhone;
                    if (walkInEmail && walkInEmail !== matchedClient.email) clientUpdates.email = walkInEmail;
                    if (Object.keys(clientUpdates).length > 0) updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, matchedClient.id), clientUpdates);
                    toast({ title: "Profile Merged", description: `${matchedClient.name}'s profile updated and session linked.` });
                    setPendingIdentityMatch(null);
                }}
                onKeepSeparate={() => { toast({ title: "Kept Separate", description: "Walk-in will be treated as a new guest." }); setPendingIdentityMatch(null); }}
            />

            <Dialog open={isVoidDialogOpen} onOpenChange={setIsVoidDialogOpen}>
                <DialogContent className="sm:max-w-lg rounded-[2rem] border-4 shadow-2xl">
                    <DialogHeader className="p-6 pb-0">
                        <DialogTitle className="text-xl font-black uppercase tracking-tighter text-destructive flex items-center gap-2"><XCircle className="w-5 h-5" /> Void Transaction</DialogTitle>
                        <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Select today's transaction to void. Manager authorization required.</DialogDescription>
                    </DialogHeader>
                    <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                        {(transactions || []).filter(t => isToday(safeDate(t.date)) && !t.voided && t.type === 'income').sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime()).map(tx => (
                            <button key={tx.id} onClick={() => setVoidTransactionId(voidTransactionId === tx.id ? null : tx.id)} className={cn("w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left", voidTransactionId === tx.id ? "border-destructive bg-destructive/5" : "border-border hover:border-destructive/30")}>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-tight text-slate-900">{tx.description}</p>
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">{format(safeDate(tx.date), 'h:mm a')} · {tx.paymentMethod}</p>
                                </div>
                                <p className={cn("font-black text-lg", voidTransactionId === tx.id ? "text-destructive" : "text-slate-900")}>${safeNumber(tx.amount).toFixed(2)}</p>
                            </button>
                        ))}
                        {voidTransactionId && <VoidAuthForm onConfirm={(pin, reason) => handleVoidTransaction(voidTransactionId, pin, reason)} onCancel={() => setVoidTransactionId(null)} />}
                    </div>
                </DialogContent>
            </Dialog>

            <Sheet open={isQuickBookOpen} onOpenChange={setIsQuickBookOpen}>
                <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 overflow-hidden">
                    <SheetHeader className="p-6 border-b bg-muted/5 flex-shrink-0">
                        <SheetTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" /> Quick Book — Call-In</SheetTitle>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 mt-1">Book an appointment directly from the POS for walk-in or call-in guests.</p>
                    </SheetHeader>
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        <QuickBookForm clients={clients || []} services={services || []} staff={staff || []} tenantId={tenantId || ''} tenant={selectedTenant} firestore={firestore} onSuccess={() => { setIsQuickBookOpen(false); toast({ title: "Appointment Booked" }); }} onCancel={() => setIsQuickBookOpen(false)} />
                    </div>
                </SheetContent>
            </Sheet>

            <Dialog open={!!pendingRefund} onOpenChange={(o) => { if (!o) setPendingRefund(null); }}>
                <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
                    <DialogHeader className="p-6 pb-0">
                        <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> Refund Deposit?</DialogTitle>
                        <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{pendingRefund?.reason}</DialogDescription>
                    </DialogHeader>
                    <div className="p-6 space-y-5">
                        <p className="text-sm font-medium text-slate-600 leading-relaxed">Return <strong className="text-slate-900">${safeNumber(pendingRefund?.amount).toFixed(2)}</strong> to {pendingRefund?.clientName}? This sends the money back through Stripe and can't be undone. Skip to keep it as a credit toward their next visit instead.</p>
                        <div className="flex gap-3">
                            <Button onClick={() => setPendingRefund(null)} variant="outline" className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Skip · keep as credit</Button>
                            <Button onClick={handleConfirmRefund} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Refund ${safeNumber(pendingRefund?.amount).toFixed(2)}</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
                <DialogContent className="max-w-sm rounded-[2rem] border-2 shadow-3xl p-0 overflow-hidden text-center">
                    <DialogHeader className="p-6 bg-muted/5 border-b"><DialogTitle className="text-xl font-bold uppercase tracking-tight text-center text-slate-900 leading-none">Ticket Issued</DialogTitle></DialogHeader>
                    <div className="flex justify-center p-8 bg-white text-center">{ticketToPrint && <PrintTicket data={ticketToPrint} />}</div>
                    <DialogFooter className="p-6 border-t bg-muted/5"><Button className="w-full h-12 rounded-xl text-lg font-bold uppercase tracking-widest shadow-xl shadow-primary/20" onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>Authorize Print</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function POSPageWrapper() {
    return (
        <Suspense fallback={<div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>}>
            <POSPage />
        </Suspense>
    );
}