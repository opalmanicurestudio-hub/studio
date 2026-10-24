'use client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { printAppointmentTicket } from '@/lib/appointment-ticket';
import { StaffBookSheet } from '@/components/pos/desk/StaffBookSheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import React, { useState, useEffect, Suspense } from 'react';
import { DeskAvailabilityPanel } from '@/components/pos/DeskAvailabilityPanel';
import { GuestsTodayPanel } from '@/components/pos/GuestsTodayPanel';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { doc, writeBatch } from 'firebase/firestore';
import { isToday, format } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { Loader } from 'lucide-react';
import { safeNumber } from '@/lib/utils';
// parseScan / codeVariants are what make a scanned ticket resolve at all: they
// keep a mixed-case check-in token intact, pull the token out of a scanned
// check-in URL, and hand back every spelling of a short code worth trying,
// because Firestore equality is case-sensitive.
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { TillManagement } from '@/components/pos/TillManagement';
import { PrintTicket } from '@/components/planner/PrintTicket';
import { motion, AnimatePresence } from 'framer-motion';

// ── NEW IMPORTS — four feature additions ──────────────────────────────────────
import { WaitlistManager } from '@/components/pos/WaitlistManager';
import { QRScanner } from '@/components/pos/QRScanner';
import { ScanGate } from '@/components/retail/ScanGate';
import { DeskCheckIn } from '@/components/pos/desk/DeskCheckIn';
import { DeskPOS } from '@/components/pos/desk/DeskPOS';
import { StripeTerminalProvider } from '@/components/pos/StripeTerminalProvider';
import { Drawer, Icon } from '@/components/pos/desk/kit';
import { usePosEngine, safeDate, RecoveryOverrideDialog, IdentityMatchDialog, VoidAuthForm } from '@/components/pos/usePosEngine';

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
    resolveScanCode, scanTimerRef, handleScanInput, handleScanConfirm, handleOpenTill, handleCloseTill, handleVoidTransaction,
    checkoutHubProps, getPreviousFormula, getVisitCount, waitingNowCount, cartItemCount, walkInGroupSizes,
  } = __engine;
  const [resumeDraft, setResumeDraft] = useState<any>(null);
  // "Resume" in POS → Needs attention → Callbacks reopens the booking with what was saved.
  useEffect(() => {
    const on = (ev: any) => { setResumeDraft(ev?.detail || null); setIsQuickBookOpen(true); };
    window.addEventListener('cf:resume-callback', on as any);
    return () => window.removeEventListener('cf:resume-callback', on as any);
  }, [setIsQuickBookOpen]);
  if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm text-muted-foreground animate-pulse">Opening the front desk…</p></div>;

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-background text-left">
      <AppHeader title="Studio POS" />
      {(() => { const desk = <DeskPOS e={__engine} tools={{
        // The classic POS's remaining panels, wired exactly as before, now in Desk's "More" drawer.
        team: (
          <TeamStatus staff={staff} onStatusChange={(id: any, act: any) => {}} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} services={services} onReorder={(newOrder: any) => { if (!firestore || !tenantId) return; const batch = writeBatch(firestore); newOrder.forEach((s: any, idx: number) => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: idx }, { merge: true }); }); batch.commit(); }} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} resources={resources || []} onForceIdle={(staffId: string) => { if (!firestore || !tenantId) return; setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'staff', staffId), { status: 'idle' }, { merge: true }); toast({ title: 'Marked free' }); }} />
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
      }} />;
        // The card reader connects while the desk is open (only for a business with a payments account).
        return tenantId && (selectedTenant as any)?.stripeAccountId ? <StripeTerminalProvider tenantId={tenantId}>{desk}</StripeTerminalProvider> : desk; })()}

      <AnimatePresence>
        {newWalkInAlert && (
          <motion.div role="status" aria-live="polite" initial={{ opacity: 0, y: 40, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="desk fixed left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full py-3 pl-4 pr-5"
            style={{ bottom: 'calc(env(safe-area-inset-bottom,0px) + 96px)', background: 'var(--ink, #16171a)', color: 'var(--paper, #fff)', boxShadow: '0 18px 40px -16px rgba(0,0,0,.45)' }}>
            <span className="d-ping relative h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: '#7fd1a5', color: '#7fd1a5' }} />
            <Icon name="walk" size={18} />
            <p className="truncate text-[14px] font-semibold">{newWalkInAlert}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <RecoveryOverrideDialog tenantId={tenantId} open={isRecoveryOverrideOpen} onOpenChange={setIsRecoveryOverrideOpen} staff={staff || []} onConfirm={(authorizer: any, reason: string) => { if (authorizer?.approvalToken) (__engine as any).recoveryApprovalRef.current = authorizer.approvalToken; setIsRecoveryOverrideOpen(false); toast({ title: `${authorizer.name} approved it`, description: "Go ahead with the adjustment." }); }} />
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


      <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={staff || []} onConfirm={async (sid: string, res: string) => { updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id), { status: 'confirmed', checkInStatus: 'pending', checkInStatusTimestamp: new Date().toISOString(), overrideReason: res, overriddenBy: sid }); setIsOverrideOpen(false); setIsDetailsOpen(false); }} />
      {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: (clients || []).find(c => c.id === appointmentToReview.clientId), service: (services || []).find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={handleSendToFrontDesk} />}
      <TillManagement open={isTillManagementOpen} onOpenChange={setIsTillManagementOpen} activeTill={activeTill} staff={staff || []} onOpenTill={handleOpenTill} onCloseTill={handleCloseTill} requireTillWitness={selectedTenant?.requireTillWitness !== false} />
      <DeskCheckIn e={__engine} accent={(selectedTenant as any)?.bookingPageSettings?.cfPageConfig?.accentColor || null} />

      <IdentityMatchDialog open={!!pendingIdentityMatch} onOpenChange={() => setPendingIdentityMatch(null)} walkIn={pendingIdentityMatch} matchedClient={pendingIdentityMatch?.matchedClient}
        onLinkSession={async (matchedClient: any) => { if (!firestore || !tenantId || !pendingIdentityMatch) return; if (pendingIdentityMatch.type !== 'walk-in') { toast({ title: 'Cannot link', description: 'Identity matching only applies to walk-in guests.' }); setPendingIdentityMatch(null); return; } updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name }); toast({ title: 'Linked', description: `Today’s visit is now on ${matchedClient.name}’s profile.` }); setPendingIdentityMatch(null); }}
        onMerge={async (matchedClient: any) => { if (!firestore || !tenantId || !pendingIdentityMatch) return; const walkInPhone = pendingIdentityMatch.customerPhone || pendingIdentityMatch.phone || ''; const walkInEmail = pendingIdentityMatch.customerEmail || pendingIdentityMatch.email || ''; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name }); const clientUpdates: any = {}; if (walkInPhone && walkInPhone !== matchedClient.phone) clientUpdates.phone = walkInPhone; if (walkInEmail && walkInEmail !== matchedClient.email) clientUpdates.email = walkInEmail; if (Object.keys(clientUpdates).length > 0) updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, matchedClient.id), clientUpdates); toast({ title: 'Profile updated', description: `${matchedClient.name}’s details are updated and today’s visit is linked.` }); setPendingIdentityMatch(null); }}
        onKeepSeparate={() => { toast({ title: 'Kept separate', description: 'They’ll be treated as a new guest.' }); setPendingIdentityMatch(null); }}
      />

      <Drawer open={isVoidDialogOpen} onClose={() => { setIsVoidDialogOpen(false); setVoidTransactionId(null); }} title="Void a sale">
        <div className="space-y-3">
          <p className="text-[14px]" style={{ color: 'var(--muted)' }}>Choose one of today’s sales. A manager approves with their PIN, and the reason is recorded.</p>
          {(() => { const list = (transactions || []).filter((t: any) => isToday(safeDate(t.date)) && !t.voided && t.type === 'income').sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());
            if (!list.length) return <p className="py-6 text-center text-[14px]" style={{ color: 'var(--muted)' }}>No sales today to void.</p>;
            return list.map((tx: any) => { const on = voidTransactionId === tx.id;
              return <div key={tx.id} className="space-y-2">
                <button type="button" aria-pressed={on} onClick={() => setVoidTransactionId(on ? null : tx.id)} className="d-row flex w-full items-center justify-between gap-3 rounded-2xl p-3.5 text-left"
                  style={{ border: `1px solid ${on ? 'var(--warn)' : 'var(--line)'}`, background: on ? 'color-mix(in srgb, var(--warn) 7%, var(--card))' : 'var(--card)' }}>
                  <span className="min-w-0"><span className="block truncate text-[14.5px] font-semibold">{tx.description}</span><span className="block text-[12.5px]" style={{ color: 'var(--muted)' }}>{format(safeDate(tx.date), 'h:mm a')} · {String(tx.paymentMethod || 'sale').replace(/^./, (c: string) => c.toUpperCase())}</span></span>
                  <span className="shrink-0 text-[17px] tabular-nums">${safeNumber(tx.amount).toFixed(2)}</span></button>
                {on && <VoidAuthForm onConfirm={(pin, reason) => handleVoidTransaction(tx.id, pin, reason)} onCancel={() => setVoidTransactionId(null)} />}
              </div>; }); })()}
        </div>
      </Drawer>

      <StaffBookSheet open={isQuickBookOpen} onClose={() => { setIsQuickBookOpen(false); setResumeDraft(null); }}
        tenantId={tenantId || ''} tenant={selectedTenant} clients={clients || []} services={services || []} staff={staff || []}
        appointments={appointmentsFromInventory || []} role={role} uid={currentUser?.uid || null} resume={resumeDraft} />
      <Drawer open={!!pendingRefund} onClose={() => setPendingRefund(null)} title="Refund the deposit?">
        <div className="space-y-4">
          {pendingRefund?.reason && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{pendingRefund.reason}</p>}
          <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--soft)' }}><p className="text-[12px]" style={{ color: 'var(--muted)' }}>Back to {pendingRefund?.clientName || 'the client'}</p><p className="text-[38px] font-light tabular-nums tracking-tight">${safeNumber(pendingRefund?.amount).toFixed(2)}</p></div>
          <p className="text-[14px]">This sends the money back to their card and can’t be undone. Or keep it as a credit toward their next visit.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPendingRefund(null)} className="h-12 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Keep as credit</button>
            <button type="button" onClick={handleConfirmRefund} className="h-12 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Refund ${safeNumber(pendingRefund?.amount).toFixed(2)}</button>
          </div>
        </div>
      </Drawer>

      <Drawer open={isCameraScanOpen && (scanMode === 'retail' || scanMode === 'checkout')} onClose={() => setIsCameraScanOpen(false)} title="Scan">
        {isCameraScanOpen && (scanMode === 'retail' || scanMode === 'checkout') && (
          <ScanGate cameraFirst label="Point at a barcode or QR code" onScan={(raw) => { setIsCameraScanOpen(false);
            // The desk routes it (a product or ticket to the sale, a kit's or bundle's label to the kit scanner); with no
            // desk on screen, it's a product or a ticket.
            const ev = new CustomEvent('cf:desk-scan', { detail: { code: raw }, cancelable: true });
            if (window.dispatchEvent(ev)) (__engine as any).handlePosScan(raw); }} />
        )}
      </Drawer>
      {isCameraScanOpen && scanMode !== 'retail' && scanMode !== 'checkout' && (
        <QRScanner
          onClose={() => setIsCameraScanOpen(false)}
          onScan={(raw) => {
            setIsCameraScanOpen(false);
            const code = raw.trim().toUpperCase();
            // a ticket: the appointment lookup
            setScanQuery(code);
            resolveScanCode(code);
            setIsScanLookupOpen(true);
          }}
        />
      )}

      <Drawer open={isScanLookupOpen} onClose={() => { setScanQuery(''); setScanResult(null); setScanNotFound(false); setIsScanLookupOpen(false); }} title="Find a ticket">
        <div className="space-y-4">
          <p className="text-[14px]" style={{ color: 'var(--muted)' }}>Scan or type the code on any printed ticket, booked or walk-in.</p>
          <input aria-label="Scan or type a code" ref={scanInputRef} value={scanQuery} onChange={(e) => handleScanInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') resolveScanCode(scanQuery); }} placeholder="e.g. 7QX2K9LM"
            className={`h-14 w-full rounded-2xl px-4 text-center font-mono outline-none ${scanQuery.length > 14 ? 'text-[14px]' : 'text-[22px] tracking-[0.25em]'}`}
            style={{ background: 'var(--paper)', color: 'var(--ink)', border: `1px solid ${scanResult ? 'var(--ok)' : scanNotFound ? 'var(--warn)' : 'var(--line)'}` }}
            maxLength={160} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
          {isScanResolving && <div className="d-shimmer h-1.5 rounded-full" aria-label="Looking it up" />}
          {scanResult && (() => {
            const isRow = scanResult.__walkIn === true;
            const c = clients?.find((cl: any) => cl.id === scanResult.clientId);
            const ids: string[] = Array.isArray(scanResult.serviceIds) ? scanResult.serviceIds : (scanResult.serviceId ? [scanResult.serviceId] : []);
            const svcNames = ids.map((id: string) => services?.find((x: any) => x.id === id)?.name).filter(Boolean) as string[];
            const rowStatus = String(scanResult.status || '').toLowerCase();
            const inChair = isRow && (rowStatus === 'servicing' || rowStatus === 'in_service');
            const isArrived = !isRow && scanResult.checkInStatus && !['pending', 'confirmed'].includes(scanResult.checkInStatus);
            const when = isRow ? (scanResult.checkInTime || scanResult.startTime) : scanResult.startTime;
            const what = inChair ? 'In service · opens their ticket' : isRow ? 'Waiting · opens check-in' : isArrived ? 'Already here · opens their ticket' : 'Not here yet · opens check-in';
            return <div className="d-rise space-y-1 rounded-2xl p-4" style={{ border: '1px solid color-mix(in srgb, var(--ok) 40%, transparent)', background: 'color-mix(in srgb, var(--ok) 7%, var(--card))' }}>
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--ok)' }}><Icon name="check" size={15} />{isRow ? 'Walk-in ticket' : 'Booking'} found</p>
              <p className="text-[17px] font-semibold">{c?.name || scanResult.clientName || scanResult.customerName || 'Guest'}</p>
              <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>{svcNames.join(' + ') || 'Service'}{when ? ` · ${format(safeDate(when), 'EEE, MMM d, h:mm a')}` : ''}</p>
              <p className="text-[13px] font-medium">{what}</p></div>; })()}
          {scanNotFound && !isScanResolving && <p className="flex items-start gap-2 rounded-2xl p-4 text-[13.5px]" style={{ background: 'color-mix(in srgb, var(--warn) 9%, transparent)' }}><Icon name="alert" size={16} className="mt-0.5" style={{ color: 'var(--warn)' }} />No ticket has that code. Bookings and the walk-in line were both checked. Try the code again, or search for them by name on the desk.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setIsScanLookupOpen(false)} className="h-12 rounded-full px-5 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Cancel</button>
            <button type="button" onClick={handleScanConfirm} disabled={!scanResult} className="h-12 flex-1 rounded-full text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{scanResult ? (scanResult.__walkIn ? 'Open the walk-in' : 'Open the booking') : 'Scan or type a code'}</button>
          </div>
        </div>
      </Drawer>

      <Drawer open={isPrintDialogOpen} onClose={() => setIsPrintDialogOpen(false)} title="Their ticket">
        <div className="space-y-4">
          <div className="cf-paper flex justify-center rounded-2xl bg-white p-6" style={{ border: '1px solid var(--line)' }}>{ticketToPrint && <PrintTicket data={ticketToPrint} />}</div>
          <button type="button" className="flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            onClick={() => {
              const t: any = ticketToPrint || {}; const apt: any = t.appointment || t;
              const okPrint = apt?.id ? printAppointmentTicket({ ...apt }, { studioName: selectedTenant?.name || 'Studio', clientName: apt.clientName || t.client?.name || (clients || []).find((c: any) => c.id === apt.clientId)?.name, serviceName: t.service?.name || apt.serviceName || (services || []).find((x: any) => x.id === apt.serviceId)?.name, staffName: t.staff?.name || t.provider?.name || apt.staffName || (staff || []).find((x: any) => x.id === apt.staffId)?.name,
                accent: (selectedTenant as any)?.bookingPageSettings?.cfPageConfig?.accentColor || (selectedTenant as any)?.brandColor, logoUrl: (selectedTenant as any)?.logoUrl || (selectedTenant as any)?.bookingPageSettings?.cfPageConfig?.logoUrl, kind: apt.isWalkIn ? 'walkin' : 'appointment', origin: window.location.origin }) : false;
              if (!okPrint) window.print();
              setIsPrintDialogOpen(false);
            }}><Icon name="printer" size={18} />Print the ticket</button>
        </div>
      </Drawer>
    </div>
  );
}

export default function POSPageWrapper() {
  return (
    <Suspense fallback={<div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm text-muted-foreground animate-pulse">Opening the front desk…</p></div>}>
      <POSPage />
    </Suspense>
  );
}
