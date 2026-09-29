'use client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { StaffBookSheet } from '@/components/pos/desk/StaffBookSheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type AppointmentCheckoutState, type Redemption, type TillSession, type Membership, type Package } from '@/lib/data';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { DeskAvailabilityPanel } from '@/components/pos/DeskAvailabilityPanel';
import { GuestsTodayPanel } from '@/components/pos/GuestsTodayPanel';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField, limit } from 'firebase/firestore';
import { offerProblem, offerLine, offerAmount, walletStatus } from '@/lib/offers';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCancellationConfirm } from '@/hooks/useCancellationConfirm';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark, Smartphone, Cake, Printer, Trash2, Lock, Calendar, BookOpen, Copy, Link2, Armchair } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn, safeNumber } from '@/lib/utils';
import { buildEntry } from '@/lib/stock-ledger';
// parseScan / codeVariants are what make a scanned ticket resolve at all: they
// keep a mixed-case check-in token intact, pull the token out of a scanned
// check-in URL, and hand back every spelling of a short code worth trying,
// because Firestore equality is case-sensitive.
import { parseScan, codeVariants } from '@/lib/scan-codes';
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

// ── NEW IMPORTS — four feature additions ──────────────────────────────────────
import { QuickBookForm } from '@/components/pos/QuickBookForm';
import { WaitlistManager } from '@/components/pos/WaitlistManager';
import { useWaitlist } from '@/hooks/useWaitlist';
import { QRScanner } from '@/components/pos/QRScanner';
import { DeskCheckIn } from '@/components/pos/desk/DeskCheckIn';
import { DeskPOS } from '@/components/pos/desk/DeskPOS';
import { usePosEngine, printTicketInNewWindow, sanitizeForFirestore, safeDate, computeServiceCost, KpiCard, RecoveryOverrideDialog, IdentityMatchDialog, VoidAuthForm } from '@/components/pos/usePosEngine';

function POSPage() {
  // Everything the POS knows and can do lives in the engine (shared by every POS layout).
  const __engine = usePosEngine();
  const {
    isMobile, inventory, services, appointmentsFromInventory, clients, walkIns, staff, transactions,
    memberships, packages, resources, discounts, tillSessions, isInventoryLoading, firestore, currentUser,
    selectedTenant, role, tenantId, toast, selectedAppointmentIds, setSelectedAppointmentIds, selectedClientId, setSelectedClientId,
    retailItems, setRetailItems, tipAmount, setTipAmount, tipAllocations, setTipAllocations, paymentTab, setPaymentTab,
    amountTendered, setAmountTendered, isAddClientOpen, setIsAddClientOpen, isDetailsOpen, setIsDetailsOpen, isCancelDialogOpen, setIsCancelDialogOpen,
    isOverrideOpen, setIsOverrideOpen, isCartSheetOpen, setIsCartSheetOpen, isTechnicianReviewOpen, setIsTechnicianReviewOpen, isCartCollapsed, setIsCartCollapsed,
    isTillManagementOpen, setIsTillManagementOpen, selectedAppointment, setSelectedAppointment, liveSelectedAppointment, appointmentToReview, setAppointmentToReview, isSubmitting,
    setIsSubmitting, assignmentMode, setAssignmentMode, pendingCheckInItem, setPendingCheckInItem, ticketToPrint, setTicketToPrint, isPrintDialogOpen,
    setIsPrintDialogOpen, appliedDiscountCodes, setAppliedDiscountCodes, appliedAdjustments, setAppliedAdjustments, redeemedOffer, setRedeemedOffer, waivedAppointmentFees,
    setWaivedAppointmentFees, isRecoveryOverrideOpen, setIsRecoveryOverrideOpen, pendingIdentityMatch, setPendingIdentityMatch, voidTransactionId, setVoidTransactionId, isVoidDialogOpen,
    setIsVoidDialogOpen, isQuickBookOpen, setIsQuickBookOpen, activeFloorTab, setActiveFloorTab, isScanLookupOpen, setIsScanLookupOpen, isCameraScanOpen,
    setIsCameraScanOpen, scanQuery, setScanQuery, scanResult, setScanResult, scanNotFound, setScanNotFound, isScanResolving,
    setIsScanResolving, scanMode, setScanMode, scanInputRef, pendingRefund, setPendingRefund, storeCreditApplied, setStoreCreditApplied,
    newWalkInAlert, setNewWalkInAlert, prevWalkInCountRef, waitlistRaw, waitlistEntries, waitlist, isOwnerOrAdminUser, activeTill,
    readyForCheckoutAppointments, kpiData, selectedClient, subtotalCalc, offerClientId, offerServiceIds, walletOffers, setWalletOffers,
    autoAppliedOfferRef, discountValue, membershipDiscountValue, taxCalc, totalCalc, payerOptions, handleSelectAppointment, handleAddToCart,
    earlyStart, setEarlyStart, handleStartService, handleSendToFrontDesk, handleAssignStaff, autoAssignedIds, handleAssignNext, handleUpdateStatus,
    handleCheckout, handleCancelAction, onCancellationConfirm, handleCancellationConfirm, handleConfirmRefund, handleResolveCheckInConfirmation, handleRevertToService, handleRevertToReady,
    resolveScanCode, scanTimerRef, handleScanInput, handleScanConfirm, handleOpenTill, handleCloseTill, handleVoidTransaction, resolveRetailScan,
    checkoutHubProps, getPreviousFormula, getVisitCount, waitingNowCount, cartItemCount, walkInGroupSizes,
  } = __engine;
  const [classicOpen, setClassicOpen] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<any>(null);
  // "Resume" in POS → Needs attention → Callbacks reopens the booking with what was saved.
  useEffect(() => {
    const on = (ev: any) => { setResumeDraft(ev?.detail || null); setIsQuickBookOpen(true); };
    window.addEventListener('cf:resume-callback', on as any);
    return () => window.removeEventListener('cf:resume-callback', on as any);
  }, [setIsQuickBookOpen]);
  if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>;

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-background text-left">
      <AppHeader title="Studio POS" />
      <DeskPOS e={__engine} tools={{
        // The classic POS's remaining panels, wired exactly as before, now in Desk's "More" drawer.
        team: (
          <TeamStatus staff={staff} onStatusChange={(id: any, act: any) => {}} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} services={services} onReorder={(newOrder: any) => { if (!firestore || !tenantId) return; const batch = writeBatch(firestore); newOrder.forEach((s: any, idx: number) => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: idx }, { merge: true }); }); batch.commit(); }} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} resources={resources || []} onForceIdle={(staffId: string) => { if (!firestore || !tenantId) return; setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'staff', staffId), { status: 'idle' }, { merge: true }); toast({ title: "Staff Reset" }); }} />
        ),
        waitlist: (
                <WaitlistManager
                  {...waitlist}
                  services={services || []}
                  staff={staff || []}
                  appointments={appointmentsFromInventory || []}
                />
        ),
        spaces: tenantId ? (<>
                <DeskAvailabilityPanel
                  tenantId={tenantId}
                  staffId={currentUser?.uid || null}
                  staffName={(staff || []).find((m: any) => m.id === currentUser?.uid)?.name || null}
                  onAddToTicket={(line) => {
                    // The chair-day becomes an ordinary cart line, so it flows
                    // through the till, the receipt and the daily close like
                    // anything else sold here. A separate little payment form
                    // would be how rental money stops reconciling.
                    setRetailItems(prev => prev.some((i: any) => i.reservationId === line.reservationId)
                      ? prev
                      : [...prev, {
                          id: line.reservationId,
                          reservationId: line.reservationId,
                          name: line.label,
                          price: line.amountCents / 100,
                          quantity: 1,
                          type: 'rental',
                        }]);
                    setActiveFloorTab('floor');
                    toast({ title: 'Added to the ticket', description: `${line.label} — take payment at checkout.` });
                  }}
                />
                <GuestsTodayPanel tenantId={tenantId} />
        </>) : null,
      }} />

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
      <AlertDialog open={!!earlyStart} onOpenChange={(o) => { if (!o) setEarlyStart(null); }}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Start early?</AlertDialogTitle>
            <AlertDialogDescription>
              {earlyStart ? `${earlyStart.who}’s appointment is at ${earlyStart.at} — ${earlyStart.mins >= 60 ? `${Math.floor(earlyStart.mins / 60)} hr ${earlyStart.mins % 60 ? `${earlyStart.mins % 60} min ` : ''}` : `${earlyStart.mins} min `}from now. Start the service now anyway?` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const id = earlyStart?.id; setEarlyStart(null); if (id) handleStartService(id, true); }}>Start now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AppointmentDetailsSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={liveSelectedAppointment} client={clients?.find(c => c.id === liveSelectedAppointment?.clientId) || null} service={services?.find(s => s.id === liveSelectedAppointment?.serviceId) || null} tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []} onStartService={handleStartService} onFinishService={(apt: any) => { setAppointmentToReview(apt); setIsTechnicianReviewOpen(true); }} onEdit={() => {}} onDelete={(id: string) => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))} onCancel={handleCancelAction} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}} onOverride={() => setIsOverrideOpen(true)} onWaiveFee={() => {}} />

      {/* Cancel / no-show — the desk's own screen (DeskCancel, inside DeskPOS). */}

      <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={staff || []} onConfirm={async (sid: string, res: string) => { updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id), { status: 'confirmed', checkInStatus: 'pending', checkInStatusTimestamp: new Date().toISOString(), overrideReason: res, overriddenBy: sid }); setIsOverrideOpen(false); setIsDetailsOpen(false); }} />
      {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: (clients || []).find(c => c.id === appointmentToReview.clientId), service: (services || []).find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={handleSendToFrontDesk} />}
      <TillManagement open={isTillManagementOpen} onOpenChange={setIsTillManagementOpen} activeTill={activeTill} staff={staff || []} onOpenTill={handleOpenTill} onCloseTill={handleCloseTill} requireTillWitness={selectedTenant?.requireTillWitness !== false} />
      {/* Check-in — the six-step front-desk check-in (replaces the old confirmation dialog). */}
      <DeskCheckIn e={__engine} accent={(selectedTenant as any)?.bookingPageSettings?.cfPageConfig?.accentColor || null} />

      <IdentityMatchDialog open={!!pendingIdentityMatch} onOpenChange={() => setPendingIdentityMatch(null)} walkIn={pendingIdentityMatch} matchedClient={pendingIdentityMatch?.matchedClient}
        onLinkSession={async (matchedClient: any) => { if (!firestore || !tenantId || !pendingIdentityMatch) return; if (pendingIdentityMatch.type !== 'walk-in') { toast({ title: 'Cannot link', description: 'Identity matching only applies to walk-in guests.' }); setPendingIdentityMatch(null); return; } updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name }); toast({ title: "Session Linked", description: `Today's visit linked to ${matchedClient.name}.` }); setPendingIdentityMatch(null); }}
        onMerge={async (matchedClient: any) => { if (!firestore || !tenantId || !pendingIdentityMatch) return; const walkInPhone = pendingIdentityMatch.customerPhone || pendingIdentityMatch.phone || ''; const walkInEmail = pendingIdentityMatch.customerEmail || pendingIdentityMatch.email || ''; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name }); const clientUpdates: any = {}; if (walkInPhone && walkInPhone !== matchedClient.phone) clientUpdates.phone = walkInPhone; if (walkInEmail && walkInEmail !== matchedClient.email) clientUpdates.email = walkInEmail; if (Object.keys(clientUpdates).length > 0) updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, matchedClient.id), clientUpdates); toast({ title: "Profile Merged", description: `${matchedClient.name}'s profile updated and session linked.` }); setPendingIdentityMatch(null); }}
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
                <div><p className="text-[11px] font-black uppercase tracking-tight text-slate-900">{tx.description}</p><p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">{format(safeDate(tx.date), 'h:mm a')} · {tx.paymentMethod}</p></div>
                <p className={cn("font-black text-lg", voidTransactionId === tx.id ? "text-destructive" : "text-slate-900")}>${safeNumber(tx.amount).toFixed(2)}</p>
              </button>
            ))}
            {voidTransactionId && <VoidAuthForm onConfirm={(pin, reason) => handleVoidTransaction(voidTransactionId, pin, reason)} onCancel={() => setVoidTransactionId(null)} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── QUICK BOOK SHEET — now uses upgraded QuickBookForm ───────────────── */}
      {/* Booking at the desk — the shared booking engine (C1). The classic form stays reachable until it's retired. */}
      <StaffBookSheet open={isQuickBookOpen} onClose={() => { setIsQuickBookOpen(false); setResumeDraft(null); }}
        tenantId={tenantId || ''} tenant={selectedTenant} clients={clients || []} services={services || []} staff={staff || []}
        role={role} uid={currentUser?.uid || null} resume={resumeDraft}
        onClassic={() => { setIsQuickBookOpen(false); setClassicOpen(true); }} />
      <Sheet open={classicOpen} onOpenChange={setClassicOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 overflow-hidden">
          <SheetHeader className="p-6 border-b bg-muted/5 flex-shrink-0">
            <SheetTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" /> Quick Book — Call-In</SheetTitle>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 mt-1">Book an appointment directly from the POS for walk-in or call-in guests.</p>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* FIX: previously omitted currentStaffId, packages, memberships, and
                discounts — all four already exist in this component's own scope
                (useInventory() already destructures memberships/packages/discounts,
                and currentUser is right there from useFirebase()), so every
                package/membership nudge and auto-listed-discount feature built into
                QuickBookForm was silently inert: the data simply never arrived. */}
            <QuickBookForm
              clients={clients || []}
              services={services || []}
              staff={staff || []}
              tenantId={tenantId || ''}
              tenant={selectedTenant}
              firestore={firestore}
              appointments={appointmentsFromInventory || []}
              currentStaffId={currentUser?.uid}
              packages={packages || []}
              memberships={memberships || []}
              discounts={discounts || []}
              onSuccess={() => { setClassicOpen(false); toast({ title: "Appointment Booked" }); }}
              onCancel={() => setClassicOpen(false)}
            />
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

      {/* ── CAMERA QR SCANNER ─────────────────────────────────────────────── */}
      {isCameraScanOpen && (
        <QRScanner
          onClose={() => setIsCameraScanOpen(false)}
          onScan={(raw) => {
            setIsCameraScanOpen(false);
            const code = raw.trim().toUpperCase();

            if (scanMode === 'retail') {
              resolveRetailScan(code);
              return;
            }

            // checkin / checkout modes both go through the appointment lookup dialog
            setScanQuery(code);
            resolveScanCode(code);
            setIsScanLookupOpen(true);
          }}
        />
      )}

      {/* ── SCAN / CHECK-IN LOOKUP ───────────────────────────────────────────
          Shows after camera scan resolves (checkin/checkout modes only), or
          can be opened directly for USB barcode scanners (keyboard emulation)
          or manual code entry. */}
      <Dialog open={isScanLookupOpen} onOpenChange={(o) => { if (!o) { setScanQuery(''); setScanResult(null); setScanNotFound(false); } setIsScanLookupOpen(o); }}>
        <DialogContent className="sm:max-w-sm rounded-[2rem] border-4 shadow-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
              <QrCode className="w-5 h-5 text-emerald-600" /> Scan or Enter Code
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              Code from any printed ticket — appointment or walk-in. Barcode scanner supported.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            {/*
              This box used to uppercase every keystroke and carried an `uppercase`
              class on top. A check-in token is a mixed-case 16-character string, so
              that silently corrupted the very thing being looked up and every
              walk-in ticket came back "not found". The value is now passed through
              exactly as scanned or typed; the lookup handles case itself.
              maxLength is generous because a scanned QR hands over a full URL.
            */}
            <Input
              aria-label="Scan or type a code"
              ref={scanInputRef}
              value={scanQuery}
              onChange={e => handleScanInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') resolveScanCode(scanQuery); }}
              placeholder="e.g. 7QX2K9LM"
              className={cn(
                'h-14 text-center font-black font-mono rounded-2xl border-4',
                scanQuery.length > 14 ? 'text-sm tracking-normal' : 'text-2xl tracking-[0.3em]',
                scanResult ? 'border-emerald-400 bg-emerald-50' : scanNotFound ? 'border-red-300 bg-red-50' : 'border-slate-200',
              )}
              maxLength={160}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />

            {isScanResolving && (
              <div className="flex items-center justify-center gap-2 py-2 text-slate-400">
                <Loader className="w-4 h-4 animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-widest">Checking full records…</p>
              </div>
            )}

            {scanResult && (() => {
              const isRow = scanResult.__walkIn === true;
              const c = clients?.find((cl: any) => cl.id === scanResult.clientId);
              // A walk-in row keeps its services in `serviceIds`; an appointment in
              // `serviceId`. Reading only one of the two showed a blank line for
              // every walk-in ticket.
              const ids: string[] = Array.isArray(scanResult.serviceIds) ? scanResult.serviceIds : (scanResult.serviceId ? [scanResult.serviceId] : []);
              const svcNames = ids.map((id: string) => services?.find((s: any) => s.id === id)?.name).filter(Boolean) as string[];
              const rowStatus = String(scanResult.status || '').toLowerCase();
              const inChair = isRow && (rowStatus === 'servicing' || rowStatus === 'in_service');
              const isArrived = !isRow && scanResult.checkInStatus && !['pending','confirmed'].includes(scanResult.checkInStatus);
              const when = isRow ? (scanResult.checkInTime || scanResult.startTime) : scanResult.startTime;
              return (
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">
                    {isRow ? 'Walk-in ticket found' : 'Match found'}
                  </p>
                  <p className="text-sm font-black text-slate-900 break-words">{c?.name || scanResult.clientName || scanResult.customerName || 'Unknown guest'}</p>
                  <p className="text-xs text-slate-500 break-words">{svcNames.join(' + ') || 'Service'}</p>
                  <p className="text-[10px] text-slate-400">{when ? format(safeDate(when), 'EEE MMM d · h:mm a') : ''}</p>
                  {inChair && <Badge className="bg-purple-100 text-purple-700 border-none text-[9px]">In service — opens full record</Badge>}
                  {!inChair && isRow && <Badge className="bg-emerald-100 text-emerald-700 border-none text-[9px]">In the walk-in queue — opens check-in</Badge>}
                  {isArrived && <Badge className="bg-blue-100 text-blue-700 border-none text-[9px]">Already checked in — opens full record</Badge>}
                  {!isRow && !isArrived && <Badge className="bg-emerald-100 text-emerald-700 border-none text-[9px]">Not yet arrived — opens check-in</Badge>}
                </div>
              );
            })()}
            {scanNotFound && !isScanResolving && (
              <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black uppercase text-red-700">No ticket found</p>
                  <p className="text-[10px] text-red-500">Appointments and the walk-in queue were both searched. Check the code, or find the guest by name in the queue.</p>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setIsScanLookupOpen(false)} className="flex-1 h-12 rounded-xl font-black uppercase text-[10px]">Cancel</Button>
              <Button
                onClick={handleScanConfirm}
                disabled={!scanResult}
                className="flex-[2] h-12 rounded-xl font-black uppercase text-[10px] shadow-lg shadow-emerald-500/20 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {scanResult ? (scanResult.__walkIn ? 'Open Walk-in' : 'Open Appointment') : 'Scan or type code above'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="max-w-sm rounded-[2rem] border-2 shadow-3xl p-0 overflow-hidden text-center">
          <DialogHeader className="p-6 bg-muted/5 border-b"><DialogTitle className="text-xl font-bold uppercase tracking-tight text-center text-slate-900 leading-none">Ticket Issued</DialogTitle></DialogHeader>
          <div className="flex justify-center p-8 bg-white text-center">{ticketToPrint && <PrintTicket data={ticketToPrint} />}</div>
          <DialogFooter className="p-6 border-t bg-muted/5">
            <Button
              className="w-full h-12 rounded-xl text-lg font-bold uppercase tracking-widest shadow-xl shadow-primary/20"
              onClick={() => {
                const el = document.getElementById('ticket-area-content');
                const html = el?.innerHTML || '';
                if (html) {
                  printTicketInNewWindow(
                    `<div id="ticket-area-content" style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;">${html}</div>`,
                    selectedTenant?.name || 'Studio',
                  );
                } else {
                  window.print();
                }
                setIsPrintDialogOpen(false);
              }}
            >
              Authorize Print
            </Button>
          </DialogFooter>
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
