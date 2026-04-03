'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  CheckCircle2, XCircle, Clock, Calendar, Repeat, Zap,
  Loader, ChevronLeft, Bell, ArrowRight, AlertTriangle,
  Users, User, CalendarDays, Info
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where, writeBatch, getDocs } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const formatTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${p}`;
};

const TYPE_META: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  day_off:       { label: 'Day Off Request',   icon: Calendar, color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200' },
  swap:          { label: 'Shift Swap',         icon: Repeat,   color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
  early_release: { label: 'Early Release',      icon: Zap,      color: 'text-amber-600',  bg: 'bg-amber-50 border-amber-200' },
};

const STATUS_BADGE: Record<string, string> = {
  pending:           'bg-amber-100 text-amber-700',
  pending_swap_consent: 'bg-purple-100 text-purple-700',
  swap_consent_given: 'bg-blue-100 text-blue-700',
  swap_consent_denied: 'bg-destructive/10 text-destructive',
  approved:          'bg-green-100 text-green-700',
  denied:            'bg-destructive/10 text-destructive',
};

const STATUS_LABEL: Record<string, string> = {
  pending:              'Pending',
  pending_swap_consent: 'Awaiting Swap Consent',
  swap_consent_given:   'Swap Agreed - Needs Approval',
  swap_consent_denied:  'Swap Declined',
  approved:             'Approved',
  denied:               'Denied',
};

export default function ScheduleRequestsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const { staff } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const router = useRouter();

  const [selected, setSelected] = useState<any | null>(null);
  const [managerNote, setManagerNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'all' | 'resolved'>('pending');

  // All requests
  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(collection(firestore, `tenants/${tenantId}/shiftRequests`));
  }, [firestore, tenantId]);

  // Shifts -- needed to look up shift details for swap display
  const shiftsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/shifts`);
  }, [firestore, tenantId]);

  const { data: allRequestsRaw } = useCollection<any>(requestsQuery);
  const { data: allShifts } = useCollection<any>(shiftsQuery);

  const allRequests = useMemo(() => {
    if (!allRequestsRaw) return [];
    return [...allRequestsRaw].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [allRequestsRaw]);

  const filtered = useMemo(() => {
    if (filter === 'pending') return allRequests.filter(r =>
      r.status === 'pending' || r.status === 'pending_swap_consent' || r.status === 'swap_consent_given'
    );
    if (filter === 'resolved') return allRequests.filter(r =>
      r.status === 'approved' || r.status === 'denied' || r.status === 'swap_consent_denied'
    );
    return allRequests;
  }, [allRequests, filter]);

  const pendingCount = useMemo(() =>
    allRequests.filter(r => ['pending', 'pending_swap_consent', 'swap_consent_given'].includes(r.status)).length,
    [allRequests]
  );

  const getStaff = (id: string) => (staff || []).find(s => s.id === id);
  const getShift = (id: string) => (allShifts || []).find(s => s.id === id);

  //  APPROVE (day off / early release / generic) 
  const handleApprove = async () => {
    if (!firestore || !tenantId || !selected) return;
    setIsProcessing(true);
    try {
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, selected.id), {
        status: 'approved', managerNote: managerNote || '', resolvedAt: now,
      });

      if (selected.type === 'day_off') {
        // Write confirmed day-off block
        const blockRef = doc(collection(firestore, `tenants/${tenantId}/shiftDayOffBlocks`));
        batch.set(blockRef, {
          id: blockRef.id, staffId: selected.staffId, date: selected.date,
          status: 'approved', requestId: selected.id, reason: selected.reason || '', approvedAt: now,
        });
        // Write blocked event to planner
        const eventRef = doc(collection(firestore, `tenants/${tenantId}/events`));
        const memberName = getStaff(selected.staffId)?.name || 'Staff';
        batch.set(eventRef, {
          id: eventRef.id,
          title: `${memberName} - Day Off`,
          type: 'blocked', allDay: true,
          startTime: `${selected.date}T00:00:00`,
          endTime: `${selected.date}T23:59:59`,
          staffIds: [selected.staffId],
          source: 'day_off_approved', requestId: selected.id, createdAt: now,
        });
        // Notify staff
        const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(n, { id: n.id, userId: selected.staffId, type: 'day_off_approved', read: false, createdAt: now, link: '/my-schedule', message: `Your day off on ${format(safeDate(selected.date), 'EEE, MMM d')} is confirmed.${managerNote ? ` Note: ${managerNote}` : ''}` });
      } else {
        const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(n, { id: n.id, userId: selected.staffId, type: 'request_approved', read: false, createdAt: now, link: '/my-schedule', message: `Your ${TYPE_META[selected.type]?.label || 'request'} for ${selected.date ? format(safeDate(selected.date), 'MMM d') : 'your schedule'} was approved.${managerNote ? ` Note: ${managerNote}` : ''}` });
      }

      await batch.commit();
      toast({ title: 'Approved', description: selected.type === 'day_off' ? 'Day blocked on planner. Staff notified.' : 'Staff notified.' });
      setSelected(null); setManagerNote('');
    } finally { setIsProcessing(false); }
  };

  //  APPROVE SWAP (both parties agreed) 
  const handleApproveSwap = async () => {
    if (!firestore || !tenantId || !selected) return;
    if (!selected.myShiftId || !selected.swapShiftId) {
      toast({ variant: 'destructive', title: 'Missing shift data', description: 'Cannot execute swap without both shift IDs.' });
      return;
    }
    setIsProcessing(true);
    try {
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      // Mark request approved
      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, selected.id), {
        status: 'approved', managerNote: managerNote || '', resolvedAt: now,
      });

      // Swap the staffId on both shifts
      batch.update(doc(firestore, `tenants/${tenantId}/shifts`, selected.myShiftId), {
        staffId: selected.swapWithStaffId,
      });
      batch.update(doc(firestore, `tenants/${tenantId}/shifts`, selected.swapShiftId), {
        staffId: selected.staffId,
      });

      // Notify both parties
      [
        { uid: selected.staffId,        msg: `Your shift swap on ${format(safeDate(selected.date), 'EEE, MMM d')} has been approved and executed. Check your updated schedule.` },
        { uid: selected.swapWithStaffId, msg: `Your shift on ${format(safeDate(selected.date), 'EEE, MMM d')} has been swapped. Check your updated schedule.` },
      ].filter(x => x.uid).forEach(x => {
        const n = doc(collection(firestore!, `tenants/${tenantId}/notifications`));
        batch.set(n, { id: n.id, userId: x.uid, type: 'swap_approved', message: x.msg, link: '/my-schedule', createdAt: now, read: false });
      });

      await batch.commit();
      toast({ title: 'Swap Executed', description: 'Both shifts reassigned. Both staff notified.' });
      setSelected(null); setManagerNote('');
    } finally { setIsProcessing(false); }
  };

  //  DENY 
  const handleDeny = async () => {
    if (!managerNote.trim()) {
      toast({ variant: 'destructive', title: 'Note required', description: 'Provide a reason for denial.' });
      return;
    }
    if (!firestore || !tenantId || !selected) return;
    setIsProcessing(true);
    try {
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();
      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, selected.id), {
        status: 'denied', managerNote, resolvedAt: now,
      });
      const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(n, { id: n.id, userId: selected.staffId, type: 'request_denied', read: false, createdAt: now, link: '/my-schedule', message: `Your ${TYPE_META[selected.type]?.label || 'request'} was not approved. Reason: ${managerNote}` });
      await batch.commit();
      toast({ title: 'Denied', variant: 'destructive' });
      setSelected(null); setManagerNote('');
    } finally { setIsProcessing(false); }
  };

  //  RENDER 
  const isSwapReadyForApproval = selected?.type === 'swap' && selected?.status === 'swap_consent_given';
  const isSwapPendingConsent = selected?.type === 'swap' && selected?.status === 'pending_swap_consent';
  const myShift = selected?.myShiftId ? getShift(selected.myShiftId) : null;
  const theirShift = selected?.swapShiftId ? getShift(selected.swapShiftId) : null;
  const requester = selected ? getStaff(selected.staffId) : null;
  const swapTarget = selected?.swapWithStaffId ? getStaff(selected.swapWithStaffId) : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <AppHeader title="Schedule Requests" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Requests</h1>
              {pendingCount > 0 && (
                <Badge variant="destructive" className="h-8 px-4 rounded-2xl font-black uppercase text-[10px] animate-pulse">
                  {pendingCount} Pending
                </Badge>
              )}
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Staff schedule & time-off requests</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/schedule')} className="h-12 px-5 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shrink-0">
            <ChevronLeft className="w-4 h-4 mr-2" /> Schedule
          </Button>
        </div>

        {/* Swap consent explainer */}
        {allRequests.some(r => r.status === 'pending_swap_consent') && (
          <div className="p-4 rounded-2xl bg-purple-50 border-2 border-purple-200 flex items-start gap-3">
            <Info className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <p className="text-[10px] font-bold text-purple-700 uppercase leading-relaxed">
              Shift swaps require consent from both staff members before a manager can approve. Staff marked "Awaiting Consent" are pending the other party's agreement via their Staff Portal.
            </p>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 p-1 bg-white rounded-2xl border-2 w-fit shadow-sm">
          {(['pending', 'all', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("h-9 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all",
                filter === f ? "bg-primary text-white shadow-md" : "text-muted-foreground hover:bg-muted/20"
              )}>
              {f === 'pending' ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Request list */}
        <div className="space-y-4">
          {filtered.length === 0 && (
            <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30">
              <Bell className="w-12 h-12 mx-auto mb-4" />
              <p className="text-xs font-black uppercase tracking-widest">No {filter === 'all' ? '' : filter} requests</p>
            </div>
          )}
          {filtered.map(req => {
            const meta = TYPE_META[req.type] || TYPE_META.day_off;
            const member = getStaff(req.staffId);
            const swapWith = req.swapWithStaffId ? getStaff(req.swapWithStaffId) : null;
            const isSwap = req.type === 'swap';
            return (
              <Card key={req.id} className={cn("border-2 rounded-[2rem] shadow-sm bg-white overflow-hidden",
                (req.status === 'pending' || req.status === 'swap_consent_given') && "border-amber-200",
                req.status === 'pending_swap_consent' && "border-purple-200",
              )}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <Avatar className="w-12 h-12 rounded-2xl border-2 shrink-0">
                      <AvatarImage src={member?.avatarUrl} className="object-cover" />
                      <AvatarFallback className="font-black bg-primary/10 text-primary">{member?.name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <p className="font-black uppercase text-sm text-slate-900">{member?.name || 'Unknown'}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <meta.icon className={cn("w-3.5 h-3.5", meta.color)} />
                            <p className={cn("text-[10px] font-black uppercase", meta.color)}>{meta.label}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge className={cn("font-black text-[9px] uppercase border-none h-6 px-3", STATUS_BADGE[req.status] || STATUS_BADGE.pending)}>
                            {STATUS_LABEL[req.status] || req.status}
                          </Badge>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(req.createdAt), 'MMM d, p')}</p>
                        </div>
                      </div>

                      {req.date && (
                        <p className="text-[10px] font-black uppercase text-slate-600">
                          <span className="opacity-50">Date: </span>
                          {format(safeDate(req.date), 'EEEE, MMMM d, yyyy')}
                        </p>
                      )}

                      {/* Swap detail */}
                      {isSwap && swapWith && (
                        <div className="flex items-center gap-2 p-3 rounded-xl bg-purple-50 border-2 border-purple-100">
                          <Avatar className="w-7 h-7 rounded-xl border shrink-0">
                            <AvatarImage src={member?.avatarUrl} className="object-cover" />
                            <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{member?.name?.[0]}</AvatarFallback>
                          </Avatar>
                          <p className="font-black uppercase text-[10px] text-purple-700 truncate">{member?.name}</p>
                          <ArrowRight className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <Avatar className="w-7 h-7 rounded-xl border shrink-0">
                            <AvatarImage src={swapWith?.avatarUrl} className="object-cover" />
                            <AvatarFallback className="text-[8px] font-black bg-purple-100 text-purple-600">{swapWith?.name?.[0]}</AvatarFallback>
                          </Avatar>
                          <p className="font-black uppercase text-[10px] text-purple-700 truncate">{swapWith?.name}</p>
                        </div>
                      )}

                      {/* Consent status for swaps */}
                      {isSwap && (
                        <div className={cn("flex items-start gap-2 p-3 rounded-xl border-2 text-[9px] font-bold uppercase",
                          req.status === 'swap_consent_given' ? "bg-green-50 border-green-200 text-green-700" :
                          req.status === 'swap_consent_denied' ? "bg-red-50 border-red-200 text-red-700" :
                          "bg-purple-50 border-purple-100 text-purple-700"
                        )}>
                          {req.status === 'swap_consent_given' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> :
                           req.status === 'swap_consent_denied' ? <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> :
                           <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                          {req.status === 'swap_consent_given'
                            ? `${swapWith?.name || 'Other staff'} agreed to the swap. Ready for manager approval.`
                            : req.status === 'swap_consent_denied'
                            ? `${swapWith?.name || 'Other staff'} declined this swap.`
                            : `Waiting for ${swapWith?.name || 'other staff'} to consent via Staff Portal.`}
                        </div>
                      )}

                      <p className="text-sm font-medium text-slate-600 leading-relaxed">{req.reason}</p>
                      {req.managerNote && (
                        <p className="text-[10px] font-bold text-primary/70 italic border-l-2 border-primary/20 pl-3">{req.managerNote}</p>
                      )}
                    </div>
                  </div>

                  {/* Action button -- responsive */}
                  {(req.status === 'pending' || req.status === 'swap_consent_given') && (
                    <div className="mt-4 pt-4 border-t border-dashed">
                      <Button
                        size="sm"
                        onClick={() => { setSelected(req); setManagerNote(''); }}
                        className={cn("w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg",
                          req.status === 'swap_consent_given' ? "shadow-purple-500/20 bg-purple-600 hover:bg-purple-700" : "shadow-primary/20"
                        )}
                      >
                        {req.status === 'swap_consent_given' ? (
                          <><Repeat className="w-3.5 h-3.5 mr-2" />Review & Execute Swap</>
                        ) : (
                          <>Review & Respond</>
                        )}
                      </Button>
                    </div>
                  )}
                  {req.status === 'swap_consent_denied' && (
                    <div className="mt-4 pt-4 border-t border-dashed">
                      <Button variant="outline" size="sm" onClick={() => { setSelected(req); setManagerNote(''); }}
                        className="w-full h-11 rounded-xl font-black uppercase text-[10px] border-2">
                        Close Request
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>

      {/*  Review Dialog  */}
      <Dialog open={!!selected} onOpenChange={v => { if (!v) { setSelected(null); setManagerNote(''); } }}>
        <DialogContent className="sm:max-w-lg rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">
              {isSwapReadyForApproval ? 'Execute Shift Swap' :
               selected?.type === 'day_off' ? 'Day Off Request' :
               selected?.type === 'early_release' ? 'Early Release Request' :
               'Request Review'}
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              {requester?.name}{selected?.date ? ` -- ${format(safeDate(selected.date), 'EEEE, MMM d')}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">

            {/* Swap shift details */}
            {selected?.type === 'swap' && (
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Shift Exchange Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className={cn("p-4 rounded-2xl border-2 space-y-2",
                    isSwapReadyForApproval ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200"
                  )}>
                    <div className="flex items-center gap-2">
                      <Avatar className="w-7 h-7 rounded-xl border shrink-0">
                        <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{requester?.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <p className="font-black uppercase text-[9px] truncate">{requester?.name}</p>
                    </div>
                    {myShift ? (
                      <>
                        <p className="font-black text-[11px] text-primary">{formatTime(myShift.startTime)} -- {formatTime(myShift.endTime)}</p>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{myShift.date}</p>
                      </>
                    ) : <p className="text-[9px] text-muted-foreground opacity-60 font-bold uppercase">Shift not found</p>}
                  </div>
                  <div className={cn("p-4 rounded-2xl border-2 space-y-2",
                    isSwapReadyForApproval ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200"
                  )}>
                    <div className="flex items-center gap-2">
                      <Avatar className="w-7 h-7 rounded-xl border shrink-0">
                        <AvatarFallback className="text-[8px] font-black bg-purple-100 text-purple-600">{swapTarget?.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <p className="font-black uppercase text-[9px] truncate">{swapTarget?.name}</p>
                    </div>
                    {theirShift ? (
                      <>
                        <p className="font-black text-[11px] text-purple-600">{formatTime(theirShift.startTime)} -- {formatTime(theirShift.endTime)}</p>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{theirShift.date}</p>
                      </>
                    ) : <p className="text-[9px] text-muted-foreground opacity-60 font-bold uppercase">Shift not found</p>}
                  </div>
                </div>

                {/* Consent status banner */}
                <div className={cn("flex items-center gap-3 p-4 rounded-2xl border-2",
                  isSwapReadyForApproval ? "bg-green-50 border-green-200" :
                  isSwapPendingConsent ? "bg-purple-50 border-purple-200" :
                  "bg-red-50 border-red-200"
                )}>
                  {isSwapReadyForApproval
                    ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                    : isSwapPendingConsent
                    ? <Clock className="w-5 h-5 text-purple-600 shrink-0" />
                    : <XCircle className="w-5 h-5 text-destructive shrink-0" />}
                  <p className={cn("text-[10px] font-black uppercase leading-relaxed",
                    isSwapReadyForApproval ? "text-green-700" :
                    isSwapPendingConsent ? "text-purple-700" :
                    "text-destructive"
                  )}>
                    {isSwapReadyForApproval
                      ? `Both parties have agreed. You can now approve and execute the swap.`
                      : isSwapPendingConsent
                      ? `Waiting for ${swapTarget?.name || 'other staff'} to consent via Staff Portal.`
                      : `${swapTarget?.name || 'Other staff'} declined this swap.`}
                  </p>
                </div>
              </div>
            )}

            {/* Day off / early release details */}
            {selected?.type !== 'swap' && (
              <div className="p-4 rounded-2xl bg-muted/20 border-2 border-dashed">
                <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Staff Reason</p>
                <p className="text-sm font-medium text-slate-700 leading-relaxed">{selected?.reason}</p>
              </div>
            )}

            {/* Manager note */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Manager Note {selected?.type !== 'swap' ? '(required for denial)' : '(optional)'}
              </Label>
              <Textarea
                value={managerNote}
                onChange={e => setManagerNote(e.target.value)}
                placeholder="Add a note for the staff member..."
                className="rounded-2xl border-2 min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            {/* Swap -- both agreed */}
            {isSwapReadyForApproval && (
              <>
                <Button onClick={handleApproveSwap} disabled={isProcessing}
                  className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-purple-500/20 bg-purple-600 hover:bg-purple-700">
                  {isProcessing ? <Loader className="animate-spin" /> : <><Repeat className="w-4 h-4 mr-2" />Execute Swap & Notify Both</>}
                </Button>
                <Button variant="destructive" onClick={handleDeny} disabled={isProcessing || !managerNote.trim()}
                  className="w-full h-12 rounded-2xl font-black uppercase">
                  <XCircle className="w-4 h-4 mr-2" /> Deny Swap
                </Button>
              </>
            )}

            {/* Swap -- pending consent, manager can only deny or wait */}
            {isSwapPendingConsent && (
              <>
                <div className="p-3 rounded-2xl bg-purple-50 border-2 border-purple-200 text-center">
                  <p className="text-[9px] font-black uppercase text-purple-700">Waiting for {swapTarget?.name} to respond in Staff Portal</p>
                </div>
                <Button variant="destructive" onClick={handleDeny} disabled={isProcessing || !managerNote.trim()}
                  className="w-full h-12 rounded-2xl font-black uppercase">
                  Cancel Swap Request
                </Button>
              </>
            )}

            {/* Swap consent denied -- just close */}
            {selected?.status === 'swap_consent_denied' && (
              <Button variant="outline" onClick={handleDeny} disabled={isProcessing}
                className="w-full h-12 rounded-2xl font-black uppercase border-2">
                Close & Archive
              </Button>
            )}

            {/* Day off / early release / generic pending */}
            {selected?.type !== 'swap' && selected?.status === 'pending' && (
              <>
                <Button onClick={handleApprove} disabled={isProcessing}
                  className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
                  {isProcessing ? <Loader className="animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-2" />Approve</>}
                </Button>
                <Button variant="destructive" onClick={handleDeny} disabled={isProcessing || !managerNote.trim()}
                  className="w-full h-12 rounded-2xl font-black uppercase">
                  <XCircle className="w-4 h-4 mr-2" /> Deny
                </Button>
              </>
            )}

            <Button variant="ghost" onClick={() => { setSelected(null); setManagerNote(''); }}
              className="font-bold uppercase text-[10px] tracking-widest">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}