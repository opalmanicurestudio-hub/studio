'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Check, X, Loader, PackageOpen, ShieldAlert, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { type StaffReplenishmentRequest, type OverflowEvent, type Staff } from '@/lib/data';
import {
  approveReplenishmentRequestTx,
  denyReplenishmentRequestTx,
  resolveOverflowEventTx,
} from '@/lib/replenishment-firestore';

/**
 * Manager-facing approval queue for staff replenishment requests.
 * Path: components/inventory/ReplenishmentApprovalQueue.tsx
 *
 * Every request needs a manager tap to approve — no auto-approve tier.
 * Requests from a staff member with unresolved overflow flags show those
 * flags inline and block the Approve button until resolved.
 */

const RequestRow = ({
  request,
  unresolvedOverflows,
  currentManager,
  onApprove,
  onDeny,
  onResolveOverflow,
  isProcessing,
}: {
  request: StaffReplenishmentRequest;
  unresolvedOverflows: OverflowEvent[];
  currentManager: Staff;
  onApprove: (request: StaffReplenishmentRequest) => void;
  onDeny: (request: StaffReplenishmentRequest, reason: string) => void;
  onResolveOverflow: (event: OverflowEvent, note: string) => void;
  isProcessing: boolean;
}) => {
  const [isDenyOpen, setIsDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [resolvingEvent, setResolvingEvent] = useState<OverflowEvent | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');

  const hasBlockingFlags = unresolvedOverflows.length > 0;

  return (
    <div className={cn(
      "p-5 md:p-6 rounded-[2rem] border-2 bg-white transition-all space-y-4",
      hasBlockingFlags ? "border-destructive/30 bg-destructive/[0.02]" : "border-border/50"
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 text-left min-w-0">
          <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{request.itemName}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
            Requested by {request.staffName} · {format(parseISO(request.requestedAt), 'MMM d, h:mm a')}
          </p>
        </div>
        <Badge variant="outline" className="h-6 px-3 font-black text-[9px] uppercase tracking-widest border-2 shrink-0 bg-amber-50 border-amber-100 text-amber-700">
          <Clock className="w-2.5 h-2.5 mr-1.5" /> Pending
        </Badge>
      </div>

      <div className="flex items-center justify-between p-4 rounded-2xl bg-muted/20 border-2 border-transparent">
        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">Quantity Requested</p>
        <p className="text-xl font-black font-mono tracking-tighter text-primary">{request.quantityRequested}</p>
      </div>

      {hasBlockingFlags && (
        <div className="p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/20 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="w-4 h-4" />
            <p className="text-[10px] font-black uppercase tracking-widest">
              {unresolvedOverflows.length} unresolved overflow flag{unresolvedOverflows.length > 1 ? 's' : ''} — resolve before approving
            </p>
          </div>
          <div className="space-y-2">
            {unresolvedOverflows.map(event => (
              <div key={event.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white border-2 border-destructive/10">
                <p className="text-[10px] font-bold text-slate-700">
                  {event.quantityOverflowed} unit(s) pulled from main stock on {format(parseISO(event.timestamp), 'MMM d')}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 rounded-lg font-black uppercase text-[8px] tracking-widest border-2 shrink-0"
                  onClick={() => { setResolvingEvent(event); setResolutionNote(''); }}
                >
                  Resolve
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className="flex-1 h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest text-destructive hover:bg-destructive/5 hover:border-destructive/30"
          onClick={() => setIsDenyOpen(true)}
          disabled={isProcessing}
        >
          <X className="mr-2 h-3.5 w-3.5" /> Deny
        </Button>
        <Button
          className="flex-[2] h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20"
          onClick={() => onApprove(request)}
          disabled={isProcessing || hasBlockingFlags}
        >
          {isProcessing ? <Loader className="h-4 w-4 animate-spin" /> : <><Check className="mr-2 h-3.5 w-3.5" /> Approve</>}
        </Button>
      </div>

      <Dialog open={isDenyOpen} onOpenChange={setIsDenyOpen}>
        <DialogContent className="sm:max-w-md rounded-[2.5rem] border-4">
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter">Deny Request</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
              {request.staffName}'s request for {request.itemName}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for denial..."
            value={denyReason}
            onChange={e => setDenyReason(e.target.value)}
            className="rounded-2xl border-2 bg-muted/5 min-h-[80px]"
          />
          <DialogFooter className="flex flex-col gap-3">
            <Button
              className="w-full h-12 rounded-2xl font-black uppercase tracking-widest bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { onDeny(request, denyReason); setIsDenyOpen(false); setDenyReason(''); }}
              disabled={!denyReason.trim()}
            >
              Confirm Denial
            </Button>
            <Button variant="ghost" className="w-full h-10 font-bold uppercase text-[10px] tracking-widest" onClick={() => setIsDenyOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolvingEvent} onOpenChange={(open) => !open && setResolvingEvent(null)}>
        <DialogContent className="sm:max-w-md rounded-[2.5rem] border-4">
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter">Resolve Overflow Flag</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
              {resolvingEvent && `${resolvingEvent.quantityOverflowed} unit(s) pulled from main stock`}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="e.g. legit high demand, damaged product, investigate further..."
            value={resolutionNote}
            onChange={e => setResolutionNote(e.target.value)}
            className="rounded-2xl border-2 bg-muted/5 min-h-[80px]"
          />
          <DialogFooter className="flex flex-col gap-3">
            <Button
              className="w-full h-12 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20"
              onClick={() => { if (resolvingEvent) { onResolveOverflow(resolvingEvent, resolutionNote); setResolvingEvent(null); } }}
              disabled={!resolutionNote.trim()}
            >
              Mark Resolved
            </Button>
            <Button variant="ghost" className="w-full h-10 font-bold uppercase text-[10px] tracking-widest" onClick={() => setResolvingEvent(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const ReplenishmentApprovalQueue = () => {
  const { staffReplenishmentRequests, overflowEvents, staff, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const [processingId, setProcessingId] = useState<string | null>(null);

  // TODO: replace with your real current-user/session lookup for the acting manager.
  // Placeholder assumes the first admin/owner in staff — swap for your actual auth context.
  const currentManager = useMemo(() => staff.find(s => s.role === 'admin' || s.role === 'owner'), [staff]);

  const pendingRequests = useMemo(
    () => staffReplenishmentRequests.filter(r => r.status === 'pending').sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
    [staffReplenishmentRequests]
  );

  const handleApprove = async (request: StaffReplenishmentRequest) => {
    if (!firestore || !tenantId || !currentManager) return;
    setProcessingId(request.id);
    const unresolved = overflowEvents.filter(e => e.staffId === request.staffId && !e.resolved);
    const result = await approveReplenishmentRequestTx(firestore, tenantId, request.id, currentManager, unresolved);
    setProcessingId(null);
    if (result.success) {
      toast({ title: "Replenishment Approved", description: `${request.itemName} sent to ${request.staffName}'s station.` });
    } else {
      toast({ variant: 'destructive', title: "Approval Failed", description: result.error });
    }
  };

  const handleDeny = async (request: StaffReplenishmentRequest, reason: string) => {
    if (!firestore || !tenantId || !currentManager) return;
    setProcessingId(request.id);
    const result = await denyReplenishmentRequestTx(firestore, tenantId, request, currentManager, reason);
    setProcessingId(null);
    if (result.success) {
      toast({ title: "Request Denied" });
    } else {
      toast({ variant: 'destructive', title: "Failed to Deny", description: result.error });
    }
  };

  const handleResolveOverflow = async (event: OverflowEvent, note: string) => {
    if (!firestore || !tenantId || !currentManager) return;
    const result = await resolveOverflowEventTx(firestore, tenantId, event, currentManager, note);
    if (result.success) {
      toast({ title: "Overflow Flag Resolved" });
    } else {
      toast({ variant: 'destructive', title: "Failed to Resolve", description: result.error });
    }
  };

  return (
    <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-6 md:p-8 text-left">
        <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
          <PackageOpen className="w-5 h-5 text-primary" />
          Replenishment Queue
        </CardTitle>
        <p className="text-xs font-bold uppercase tracking-widest opacity-60">
          {pendingRequests.length} pending request{pendingRequests.length !== 1 ? 's' : ''}
        </p>
      </CardHeader>
      <CardContent className="p-6 md:p-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16 gap-4">
            <Loader className="animate-spin h-8 w-8 text-primary" />
          </div>
        ) : pendingRequests.length === 0 ? (
          <div className="text-center py-16 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
            <Check className="w-12 h-12" />
            <p className="font-black uppercase tracking-widest text-sm">Queue Clear</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingRequests.map(request => (
              <RequestRow
                key={request.id}
                request={request}
                unresolvedOverflows={overflowEvents.filter(e => e.staffId === request.staffId && !e.resolved)}
                currentManager={currentManager as Staff}
                onApprove={handleApprove}
                onDeny={handleDeny}
                onResolveOverflow={handleResolveOverflow}
                isProcessing={processingId === request.id}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
