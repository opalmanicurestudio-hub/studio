'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  CheckCircle2, XCircle, Clock, Calendar, Repeat, Coffee, Zap,
  Loader, AlertTriangle, ChevronLeft, Filter, Bell
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, query, orderBy, where } from 'firebase/firestore';
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

const REQUEST_TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  day_off: { label: 'Day Off Request', icon: Calendar, color: 'text-blue-600' },
  swap: { label: 'Shift Swap', icon: Repeat, color: 'text-purple-600' },
  early_release: { label: 'Early Release', icon: Zap, color: 'text-amber-600' },
  availability_update: { label: 'Availability Update', icon: Clock, color: 'text-teal-600' },
};

export default function ScheduleRequestsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const { staff } = useInventory();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const router = useRouter();

  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [managerNote, setManagerNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('pending');

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(collection(firestore, `tenants/${tenantId}/shiftRequests`));
  }, [firestore, tenantId]);

  const { data: allRequestsRaw } = useCollection<any>(requestsQuery);
  const allRequests = useMemo(() =>
    [...(allRequestsRaw || [])].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    ), [allRequestsRaw]);

  const filteredRequests = useMemo(() => {
    if (!allRequests) return [];
    if (filter === 'pending') return allRequests.filter(r => r.status === 'pending');
    if (filter === 'resolved') return allRequests.filter(r => r.status !== 'pending');
    return allRequests;
  }, [allRequests, filter]);

  const pendingCount = useMemo(() => (allRequests || []).filter(r => r.status === 'pending').length, [allRequests]);

  const handleApprove = async () => {
    if (!firestore || !tenantId || !selectedRequest) return;
    setIsProcessing(true);
    try {
      const batch = writeBatch(firestore);
      const now = new Date().toISOString();

      // Mark request approved
      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, selectedRequest.id), {
        status: 'approved', managerNote: managerNote || '', resolvedAt: now,
      });

      // AUTO-EXECUTE: Shift swap -- reassign both shifts to each other
      if (selectedRequest.type === 'swap' && selectedRequest.swapShiftId && selectedRequest.myShiftId) {
        // Swap staffId on both shift documents
        batch.update(doc(firestore, `tenants/${tenantId}/shifts`, selectedRequest.myShiftId), {
          staffId: selectedRequest.swapWithStaffId,
        });
        batch.update(doc(firestore, `tenants/${tenantId}/shifts`, selectedRequest.swapShiftId), {
          staffId: selectedRequest.staffId,
        });
        // Notify both staff members
        [
          { uid: selectedRequest.staffId, msg: `Your shift swap on ${selectedRequest.date ? format(safeDate(selectedRequest.date), 'MMM d') : 'the requested date'} was approved. Shifts have been automatically reassigned.` },
          { uid: selectedRequest.swapWithStaffId, msg: `Your shift on ${selectedRequest.date ? format(safeDate(selectedRequest.date), 'MMM d') : 'the requested date'} has been swapped with another staff member. Check your schedule.` },
        ].filter(n => n.uid).forEach(n => {
          const notifRef = doc(collection(firestore!, `tenants/${tenantId}/notifications`));
          batch.set(notifRef, { id: notifRef.id, userId: n.uid, type: 'swap_approved', message: n.msg, link: '/my-schedule', createdAt: now, read: false });
        });
      }

      // AUTO-EXECUTE: Day off -- write a blocked event to the planner
      if (selectedRequest.type === 'day_off') {
        // Create a blocked event on the planner for this staff member
        if (selectedRequest.date) {
          const eventRef = doc(collection(firestore, `tenants/${tenantId}/events`));
          const dayStart = new Date(selectedRequest.date + 'T00:00:00');
          const dayEnd = new Date(selectedRequest.date + 'T23:59:59');
          batch.set(eventRef, {
            id: eventRef.id,
            title: `Day Off -- ${(staff || []).find(s => s.id === selectedRequest.staffId)?.name || 'Staff'}`,
            type: 'blocked',
            staffIds: [selectedRequest.staffId],
            startTime: dayStart.toISOString(),
            endTime: dayEnd.toISOString(),
            allDay: true,
            source: 'day_off_request',
            requestId: selectedRequest.id,
            tenantId,
            createdAt: now,
          });
        }
        // Notify staff
        const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(notifRef, {
          id: notifRef.id, userId: selectedRequest.staffId, type: 'day_off_approved',
          message: `Your day off on ${selectedRequest.date ? format(safeDate(selectedRequest.date), 'EEE, MMM d') : 'the requested date'} has been approved and blocked on the schedule.${managerNote ? ` Note: ${managerNote}` : ''}`,
          link: '/my-schedule', createdAt: now, read: false,
        });
      } else if (selectedRequest.type !== 'swap') {
        // Generic approval notification
        const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(notifRef, {
          id: notifRef.id, userId: selectedRequest.staffId, type: 'request_approved',
          message: `Your ${REQUEST_TYPE_META[selectedRequest.type]?.label || 'request'} for ${selectedRequest.date ? format(safeDate(selectedRequest.date), 'MMM d') : 'your schedule'} was approved.${managerNote ? ` Note: ${managerNote}` : ''}`,
          link: '/my-schedule', createdAt: now, read: false,
        });
      }

      await batch.commit();
      const desc = selectedRequest.type === 'swap'
        ? 'Shifts automatically reassigned. Both staff notified.'
        : selectedRequest.type === 'day_off'
        ? 'Day off confirmed. Staff notified.'
        : 'Staff member has been notified.';
      toast({ title: 'Request Approved', description: desc });
      setSelectedRequest(null);
      setManagerNote('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeny = async () => {
    if (!firestore || !tenantId || !selectedRequest) return;
    if (!managerNote.trim()) {
      toast({ variant: 'destructive', title: 'Note Required', description: 'Provide a reason for denial.' });
      return;
    }
    setIsProcessing(true);
    try {
      await updateDocumentNonBlocking(
        doc(firestore, `tenants/${tenantId}/shiftRequests`, selectedRequest.id),
        { status: 'denied', managerNote, resolvedAt: new Date().toISOString() }
      );
      await addDocumentNonBlocking(
        collection(firestore, `tenants/${tenantId}/notifications`),
        {
          id: nanoid(), userId: selectedRequest.staffId, type: 'request_denied',
          message: `Your ${REQUEST_TYPE_META[selectedRequest.type]?.label || 'request'} was not approved. Reason: ${managerNote}`,
          link: '/schedule', createdAt: new Date().toISOString(), read: false,
        }
      );
      toast({ title: 'Request Denied', variant: 'destructive', description: 'Staff member has been notified.' });
      setSelectedRequest(null);
      setManagerNote('');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <AppHeader title="Schedule Requests" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-4xl mx-auto space-y-8">

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Requests</h1>
              {pendingCount > 0 && (
                <Badge variant="destructive" className="h-8 px-4 rounded-2xl font-black uppercase text-[10px] animate-pulse">{pendingCount} Pending</Badge>
              )}
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Staff schedule & time-off requests</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/schedule')} className="h-12 px-5 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">
            <ChevronLeft className="w-4 h-4 mr-2" /> Back to Schedule
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 p-1 bg-white rounded-2xl border-2 w-fit shadow-sm">
          {(['pending', 'all', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={cn("h-9 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all", filter === f ? "bg-primary text-white shadow-md" : "text-muted-foreground hover:bg-muted/20")}>
              {f === 'pending' ? `Pending ${pendingCount > 0 ? `(${pendingCount})` : ''}` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Request list */}
        <div className="space-y-4">
          {filteredRequests.length === 0 && (
            <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30">
              <Bell className="w-12 h-12 mx-auto mb-4" />
              <p className="text-xs font-black uppercase tracking-widest">No {filter === 'all' ? '' : filter} requests</p>
            </div>
          )}
          {filteredRequests.map(req => {
            const member = (staff || []).find(s => s.id === req.staffId);
            const meta = REQUEST_TYPE_META[req.type] || { label: req.type, icon: Clock, color: 'text-primary' };
            return (
              <Card key={req.id} className={cn("border-2 rounded-[2rem] shadow-sm bg-white overflow-hidden", req.status === 'pending' && "border-amber-200")}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <Avatar className="w-12 h-12 rounded-2xl border-2 shrink-0">
                      <AvatarImage src={member?.avatarUrl} className="object-cover" />
                      <AvatarFallback className="font-black bg-primary/10 text-primary">{member?.name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <p className="font-black uppercase text-sm text-slate-900">{member?.name || 'Unknown Staff'}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <meta.icon className={cn("w-3.5 h-3.5", meta.color)} />
                            <p className={cn("text-[10px] font-black uppercase", meta.color)}>{meta.label}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={cn("font-black text-[9px] uppercase border-none h-6 px-3",
                            req.status === 'pending' ? "bg-amber-100 text-amber-700" :
                            req.status === 'approved' ? "bg-green-100 text-green-700" :
                            "bg-destructive/10 text-destructive"
                          )}>
                            {req.status}
                          </Badge>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(req.createdAt), 'MMM d, p')}</p>
                        </div>
                      </div>

                      {req.date && (
                        <p className="text-[10px] font-black uppercase text-slate-600">
                          <span className="text-muted-foreground opacity-60">Date: </span>
                          {format(safeDate(req.date), 'EEEE, MMMM d, yyyy')}
                        </p>
                      )}
                      <p className="text-sm font-medium text-slate-600 leading-relaxed">{req.reason}</p>
                      {req.managerNote && (
                        <p className="text-[10px] font-bold text-primary/70 italic border-l-2 border-primary/20 pl-3">{req.managerNote}</p>
                      )}
                    </div>
                  </div>

                  {req.status === 'pending' && (
                    <div className="flex gap-3 mt-4 pt-4 border-t border-dashed">
                      <Button size="sm" onClick={() => { setSelectedRequest(req); setManagerNote(''); }} className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-lg shadow-primary/20">
                        Review & Respond
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>

      {/* Review Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={v => { if (!v) { setSelectedRequest(null); setManagerNote(''); } }}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Respond to Request</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              {selectedRequest ? REQUEST_TYPE_META[selectedRequest.type]?.label : ''} from {(staff || []).find(s => s.id === selectedRequest?.staffId)?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            {selectedRequest?.date && (
              <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Requested Date</p>
                <p className="font-black text-base uppercase mt-1">{format(safeDate(selectedRequest.date), 'EEEE, MMMM d, yyyy')}</p>
              </div>
            )}
            <div className="p-4 rounded-2xl bg-muted/20 border-2 border-dashed">
              <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 mb-1">Staff Reason</p>
              <p className="text-sm font-medium text-slate-700 leading-relaxed">{selectedRequest?.reason}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Manager Response Note (required for denial)</Label>
              <Textarea value={managerNote} onChange={e => setManagerNote(e.target.value)} placeholder="Add a note for the staff member..." className="rounded-2xl border-2 min-h-[80px]" />
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <Button onClick={handleApprove} disabled={isProcessing} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
              <CheckCircle2 className="w-4 h-4 mr-2" /> Approve Request
            </Button>
            <Button variant="destructive" onClick={handleDeny} disabled={isProcessing || !managerNote.trim()} className="w-full h-12 rounded-2xl font-black uppercase">
              <XCircle className="w-4 h-4 mr-2" /> Deny Request
            </Button>
            <Button variant="ghost" onClick={() => { setSelectedRequest(null); setManagerNote(''); }} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}