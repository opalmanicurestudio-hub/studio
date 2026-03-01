'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type PricingTier, InventoryItem, AppointmentCheckoutState, getServicePrice, type Discount, type Membership, type Package } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes, isSameDay } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, QrCode, Keyboard, Loader, TicketIcon, Play, CheckCircle, Plus, Activity, KeyRound, Landmark } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { Separator } from '@/components/ui/separator';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';

const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <div className={cn("p-2 rounded-lg", iconBgColor)}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);

function POSPageContent() {
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages, pricingTiers } = useInventory();
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobile();

    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<any[]>([]);
    const [tipAmount, setTipAmount] = useState(0);
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [manualTicketId, setManualTicketId] = useState('');
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [viewingAppointment, setViewingAppointment] = useState<Appointment | null>(null);
    const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
    const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package' | 'retail_discount', id: string} | null>(null);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    
    const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
    const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
    const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
    const [appointmentToCancel, setAppointmentToCancel] = useState<Appointment | null>(null);

    const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);
    const [authPin, setAuthPin] = useState('');
    const [pendingStatusAction, setPendingStatusAction] = useState<{ staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' } | null>(null);

    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
    const [orderedStaff, setOrderedStaff] = useState<Staff[]>([]);

    useEffect(() => {
        const payerId = searchParams.get('payer_id');
        const action = searchParams.get('action');
        if (payerId && clients && clients.length > 0) {
            const client = clients.find(c => c.id === payerId);
            if (client) {
                setSelectedClientId(client.id);
                if (action === 'settle' && client.unpaidFees) {
                    const feeIds = client.unpaidFees.map(f => f.feeId);
                    setAppliedAdjustments(new Set(feeIds));
                    toast({ title: "Settlement Active", description: `Added ${feeIds.length} unpaid fee(s) to sale.` });
                }
            }
        }
    }, [searchParams, clients, toast]);

    useEffect(() => {
        if (staff) {
            const sorted = [...staff].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
        }
    }, [staff]);

    const handleStaffReorder = (newOrder: Staff[]) => {
        setOrderedStaff(newOrder);
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((staffMember, index) => {
            const staffRef = doc(firestore, 'tenants', tenantId, 'staff', staffMember.id);
            batch.update(staffRef, { turnOrder: index });
        });
        batch.commit().catch(err => {
            console.error("Failed to save staff order:", err);
            toast({ variant: 'destructive', title: "Error", description: "Could not save turn order." });
        });
    };

    const handleVerifyPin = () => {
        if (!pendingStatusAction || !staff || !firestore || !tenantId) return;
        const targetStaff = staff.find(s => s.id === pendingStatusAction.staffId);
        if (targetStaff && targetStaff.pin === authPin) {
            const { staffId, action } = pendingStatusAction;
            const activityLogsRef = collection(firestore, 'tenants', tenantId, 'activityLogs');
            const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', staffId);
            const now = new Date().toISOString();
            let staffUpdate: Partial<Staff> = {};
            let logEntry: any = { staffId, type: action, timestamp: now };
            switch (action) {
                case 'clock_in': staffUpdate = { active: true }; break;
                case 'clock_out': staffUpdate = { active: false, onBreak: false, status: 'idle' }; break;
                case 'break_start': staffUpdate = { onBreak: true, breakStartTime: now }; break;
                case 'break_end':
                    if (targetStaff.breakStartTime) {
                        const duration = differenceInMinutes(new Date(now), new Date(targetStaff.breakStartTime));
                        logEntry.durationMinutes = duration;
                    }
                    staffUpdate = { onBreak: false, breakStartTime: undefined };
                    break;
            }
            addDocumentNonBlocking(activityLogsRef, logEntry);
            updateDocumentNonBlocking(staffDocRef, staffUpdate);
            setIsPinAuthOpen(false);
            setAuthPin('');
            setPendingStatusAction(null);
            toast({ title: "Authorized", description: "Status updated successfully." });
        } else {
            toast({ variant: "destructive", title: "Invalid PIN" });
        }
    };

    const appointments = useMemo(() => appointmentsFromInventory || [], [appointmentsFromInventory]);
    const todayAppointments = useMemo(() => {
        const today = startOfDay(new Date());
        return appointments.filter(apt => isSameDay(new Date(apt.startTime), today));
    }, [appointments]);

    const readyForCheckoutAppointments = useMemo(() => {
        if (!todayAppointments || !clients || !services || !staff) return [];
        return todayAppointments
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { id: apt.id, appointment: apt, client, service, addOnServices, staff: staffMember };
            }).filter((a): a is { id: string, appointment: Appointment, client: Client, service: Service, addOnServices: Service[], staff: Staff } => !!(a.client && a.service));
    }, [todayAppointments, clients, services, staff]);

    const handleSelectAppointment = useCallback((id: string) => {
        setSelectedAppointmentIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleApplyAdjustmentToggle = useCallback((id: string, apply: boolean) => {
        setAppliedAdjustments(prev => {
            const next = new Set(prev);
            if (apply) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const handleAddToCart = useCallback((item: any) => {
        setRetailItems(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            let price = 0;
            let type: 'product' | 'service' | 'membership' | 'package' = 'product';
            if ('msrp' in item) { price = item.msrp || item.costPerUnit || 0; type = 'product'; }
            else if ('duration' in item) { price = item.price || 0; type = 'service'; }
            else if ('interval' in item) { price = item.price || 0; type = 'membership'; }
            else if ('sessions' in item) { price = item.price || 0; type = 'package'; }
            return [...prev, { id: item.id, name: item.name, quantity: 1, price, type, imageUrl: item.imageUrl, stock: item.totalStock }];
        });
    }, []);

    const handleScan = useCallback((data: string) => {
      const raw = data.trim();
      const id = raw.split('/').pop();
      if (!id) return;
      const apt = appointments.find(a => a.id === id || a.id.toUpperCase().endsWith(id.toUpperCase()));
      if (apt) {
          if (apt.status === 'ready_for_checkout') {
              handleSelectAppointment(apt.id);
              toast({ title: "Client Added", description: `${apt.clientName} added to sale.` });
          } else {
              setViewingAppointment(apt);
              setIsDetailsOpen(true);
              toast({ title: "Viewing Progress" });
          }
      } else {
          const product = inventory.find(p => p.sku === raw || p.id === id);
          if (product) {
              handleAddToCart(product);
              toast({ title: "Product Added" });
          } else toast({ variant: 'destructive', title: 'Code Not Recognized' });
      }
    }, [appointments, inventory, handleSelectAppointment, handleAddToCart, toast]);

    const handleCheckout = async (paymentDetails: { paymentMethod: string; amountTendered?: number }) => {
        if (!firestore || !tenantId) return;
        if (!selectedClientId && Array.from(selectedAppointmentIds).length > 0) {
            toast({ variant: 'destructive', title: 'Payer Required' });
            return;
        }
        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const nowISO = new Date().toISOString();
        try {
            for (const id of Array.from(selectedAppointmentIds)) {
                const data = readyForCheckoutAppointments.find(a => a.id === id);
                if (!data) continue;
                const { appointment, staff: provider } = data;
                const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
                batch.update(appointmentRef, { status: 'completed' });
                if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'completed', tenantId });
                const staffRef = doc(firestore, 'tenants', tenantId, 'staff', provider.id);
                batch.update(staffRef, { status: 'idle', lastServedTimestamp: nowISO });
            }
            if (selectedClientId && clients.find(c => c.id === selectedClientId)) {
                const clientDocRef = doc(firestore, `tenants/${tenantId}/clients`, selectedClientId);
                if (appliedAdjustments.size > 0) {
                    const client = clients.find(c => c.id === selectedClientId)!;
                    const remainingFees = (client.unpaidFees || []).filter(f => !appliedAdjustments.has(f.feeId));
                    const totalSettled = Array.from(appliedAdjustments).reduce((sum, id) => sum + (client.unpaidFees?.find(f => f.feeId === id)?.feeAmount || 0), 0);
                    batch.update(clientDocRef, { unpaidFees: remainingFees, outstandingBalance: increment(-totalSettled), lastAppointment: nowISO });
                } else {
                    batch.update(clientDocRef, { lastAppointment: nowISO });
                }
            }
            await batch.commit();
            setRetailItems([]); setSelectedAppointmentIds(new Set()); setSelectedClientId(null); setTipAmount(0); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set()); setRedeemedOffer(null);
            toast({ title: 'Sale Complete!' });
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Checkout Failed' });
        } finally { setIsSubmitting(false); }
    };

    const handleStartService = (appointmentId: string) => {
      if (!firestore || !tenantId || !appointments) return;
      const appointment = appointments.find(a => a.id === appointmentId);
      if (!appointment) return;
      const nowISO = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'servicing', actualStartTime: nowISO });
      if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId });
      if (appointment.staffId) batch.update(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' });
      batch.commit().then(() => toast({ title: "Service Started" }));
    };

    const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { status: 'ready_for_checkout', checkoutState, actualEndTime: new Date().toISOString() });
        const appointment = appointments?.find(a => a.id === appointmentId);
        if (appointment?.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'ready_for_checkout', tenantId });
        if (appointment?.staffId) batch.update(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'idle' });
        batch.commit().then(() => { setIsTechnicianReviewOpen(false); setIsDetailsOpen(false); toast({ title: "Service Finished" }); });
    };

    const { currentSubtotal, currentTax, currentTotal, currentDiscount, currentMembershipDiscount } = useMemo(() => {
        const appointmentsSubtotal = Array.from(selectedAppointmentIds).reduce((acc, id) => {
            const data = readyForCheckoutAppointments.find(a => a.id === id);
            if (!data) return acc;
            const mainPrice = getServicePrice(data.service, data.staff);
            const addOnsPrice = data.addOnServices.reduce((sum, s) => sum + getServicePrice(s, data.staff), 0);
            return acc + mainPrice + addOnsPrice;
        }, 0);

        const retailSubtotal = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);

        const adjustmentsSubtotal = Array.from(appliedAdjustments).reduce((acc, id) => {
            if (!selectedClientId) return acc;
            const client = clients?.find(c => c.id === selectedClientId);
            const fee = client?.unpaidFees?.find(f => f.feeId === id);
            return acc + (fee?.feeAmount || 0);
        }, 0);

        const sub = appointmentsSubtotal + retailSubtotal + adjustmentsSubtotal;

        let totalDiscount = 0;
        appliedDiscountCodes.forEach(code => {
            const d = discounts.find(dis => dis.code === code);
            if (d) {
                if (d.type === 'percentage') totalDiscount += sub * (d.value / 100);
                else totalDiscount += d.value;
            }
        });

        let memDiscount = 0;
        const selectedClient = clients.find(c => c.id === selectedClientId);
        if (selectedClient && selectedClient.activeMembershipId) {
            const membership = memberships.find(m => m.id === selectedClient.activeMembershipId);
            if (membership?.retailDiscount && retailSubtotal > 0) {
                memDiscount = retailSubtotal * (membership.retailDiscount / 100);
            }
        }

        const subAfterDiscounts = Math.max(0, sub - totalDiscount - memDiscount);
        const taxVal = subAfterDiscounts * 0.07;
        const totalVal = subAfterDiscounts + taxVal + tipAmount;

        return { 
            currentSubtotal: sub, 
            currentTax: taxVal, 
            currentTotal: totalVal, 
            currentDiscount: totalDiscount, 
            currentMembershipDiscount: memDiscount 
        };
    }, [selectedAppointmentIds, readyForCheckoutAppointments, retailItems, appliedAdjustments, selectedClientId, clients, appliedDiscountCodes, discounts, memberships, tipAmount]);

    const checkoutHubProps = {
        cart: retailItems, onCartChange: setRetailItems,
        appointmentsData: Array.from(selectedAppointmentIds).map(id => readyForCheckoutAppointments.find(a => a.id === id)).filter(Boolean) as any,
        onSelectAppointment: handleSelectAppointment, clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1,
        payerOptions: (clients || []).filter(c => Array.from(selectedAppointmentIds).some(id => readyForCheckoutAppointments.find(a => a.id === id)?.appointment.clientId === c.id)),
        selectedClientId, setSelectedClientId, onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => setIsScannerOpen(true),
        subtotal: currentSubtotal, tax: currentTax, total: currentTotal, tipAmount, setTipAmount, onCheckout: handleCheckout,
        appliedDiscountCodes, setAppliedDiscountCodes, discount: currentDiscount, membershipDiscount: currentMembershipDiscount,
        isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
        adjustments: selectedClientId ? (clients.find(c => c.id === selectedClientId)?.unpaidFees?.map(f => ({ id: f.feeId, clientName: clients.find(c => c.id === selectedClientId)!.name, serviceName: 'Fee', description: f.reason, cost: f.feeAmount })) || []) : [],
        appliedAdjustments, onApplyAdjustmentToggle: handleApplyAdjustmentToggle,
        absorbedCost: 0, redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [], allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
    };

    return (
        <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
            <AppHeader />
            <div className="flex-1 grid lg:grid-cols-[1fr,400px] overflow-hidden">
                <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-8 pb-24 lg:pb-8">
                    <TeamStatus staff={staff} onStatusChange={(id, act) => { setPendingStatusAction({ staffId: id, action: act }); setIsPinAuthOpen(true); }} appointments={todayAppointments} services={services} onReorder={handleStaffReorder} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} />
                    <WalkInQueue walkIns={walkIns} appointments={todayAppointments} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={(w, s) => {}} onAssignNext={() => {}} onCancel={() => {}} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={() => {}} assignmentMode={assignmentMode} onPrintTicket={() => {}} onSkip={() => {}} onReturnToQueue={() => {}} groupSizes={new Map()} onToggleWaitForStaff={() => {}} onScanClick={() => setIsScannerOpen(true)} onFinishService={(a) => { setAppointmentToReview(a); setIsTechnicianReviewOpen(true); }} onUpdateStatus={() => {}} onRevertToReady={() => {}} onRevertToService={() => {}} />
                    <RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => setIsScannerOpen(true)} />
                </main>
                <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto"><CheckoutHub {...checkoutHubProps} /></aside>
            </div>
            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden z-40">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild><Button className="w-full h-14">View Cart</Button></SheetTrigger>
                        <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col">
                            <SheetHeader className="p-4 border-b">
                                <SheetTitle>Current Sale</SheetTitle>
                            </SheetHeader>
                            <div className="p-4 flex-1 overflow-y-auto">
                                <CheckoutHub {...checkoutHubProps} />
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            )}
            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}><DialogContent className="sm:max-w-md p-0 overflow-hidden"><DialogHeader className="p-4 pb-0"><DialogTitle>Scan Ticket</DialogTitle></DialogHeader><div className="p-4"><div id="qr-reader-pos" className="w-full aspect-square bg-muted" /></div></DialogContent></Dialog>
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={() => {}} />
            {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: clients?.find(c => c.id === appointmentToReview.clientId), service: services?.find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={handleSendToFrontDesk} />}
            <Dialog open={isPinAuthOpen} onOpenChange={setIsPinAuthOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Authorize Action</DialogTitle></DialogHeader><div className="py-6 flex flex-col items-center gap-4"><Input type="password" value={authPin} onChange={e => setAuthPin(e.target.value)} maxLength={4} className="text-center text-3xl font-black h-16 w-48" /></div><DialogFooter><Button onClick={handleVerifyPin}>Confirm</Button></DialogFooter></DialogContent></Dialog>
        </div>
    );
}

export default function POSPage() { return <Suspense fallback={<div>Loading...</div>}><POSPageContent /></Suspense> }