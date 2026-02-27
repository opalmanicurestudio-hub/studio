'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type PricingTier, InventoryItem } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes, addMonths, subMonths, isAfter } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckoutQueue } from '@/components/pos/CheckoutQueue';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, QrCode, Keyboard, Loader, TicketIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { InServiceAppointmentCard } from '@/components/pos/InServiceAppointmentCard';
import { SelectProviderDialog } from '@/components/pos/SelectProviderDialog';
import { Separator } from '@/components/ui/separator';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';

const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <div className={cn("p-2 rounded-lg", iconBgColor)}>{React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}</div>
    </CardHeader>
    <CardContent><div className="text-2xl font-bold">{value}</div><p className="text-xs text-muted-foreground">{description}</p></CardContent>
  </Card>
);

type EditableFormulaItem = { id: string; name: string; price: number; quantity: number; imageUrl?: string; stock?: number; type: 'product' | 'service' | 'membership' | 'package'; staffId?: string; };

export default function POSPage() {
    const { inventory, services, appointments: appointmentsFromDB, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages, pricingTiers } = useInventory();
    const { firestore, selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobile();

    const [activeTab, setActiveTab] = useState('catalog');
    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<EditableFormulaItem[]>([]);
    const [tipAmount, setTipAmount] = useState(0);
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [manualTicketId, setManualTicketId] = useState('');
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [viewingAppointment, setViewingAppointment] = useState<Appointment | null>(null);
    const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
    const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package' | 'retail_discount', id: string} | null>(null);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [serviceToSelectProvider, setServiceToSelectProvider] = useState<Service | null>(null);

    const appointments = useMemo(() => appointmentsFromDB?.map(apt => ({ ...apt, startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any), endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any) })) || [], [appointmentsFromDB]);

    const readyForCheckoutAppointments = useMemo(() => appointments.filter(apt => apt.status === 'ready_for_checkout').map(apt => ({ ...apt, client: clients?.find(c => c.id === apt.clientId), service: services?.find(s => s.id === apt.serviceId), addOnServices: (apt.addOnIds || []).map(id => services?.find(s => s.id === id)).filter(Boolean) as Service[], staff: staff?.find(s => s.id === apt.staffId) })), [appointments, clients, services, staff]);

    const handleSelectAppointment = (id: string) => setSelectedAppointmentIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

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
              toast({ title: "Viewing Progress", description: `Opening progress for ${apt.clientName}.` });
          }
      } else {
          const product = inventory.find(p => p.sku === raw || p.id === id);
          if (product) {
              const existing = retailItems.find(i => i.id === product.id);
              if (existing) setRetailItems(retailItems.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
              else setRetailItems([...retailItems, { id: product.id, name: product.name, price: product.msrp || 0, quantity: 1, type: 'product' }]);
              toast({ title: "Product Added" });
          } else toast({ variant: 'destructive', title: 'Code Not Recognized' });
      }
    }, [appointments, inventory, retailItems, toast]);

    useEffect(() => {
        let html5QrCode: Html5Qrcode | undefined;
        if (isScannerOpen) {
          setTimeout(() => {
            const el = document.getElementById('qr-reader-pos');
            if (el) {
                html5QrCode = new Html5Qrcode('qr-reader-pos');
                html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, (txt) => { html5QrCode?.stop(); handleScan(txt); setIsScannerOpen(false); }, () => {})
                  .catch(() => { toast({ variant: 'destructive', title: 'Camera Error' }); setIsScannerOpen(false); });
            }
          }, 300);
        }
        return () => { if (html5QrCode?.isScanning) html5QrCode.stop(); };
    }, [isScannerOpen, handleScan, toast]);

    const subtotal = useMemo(() => {
        const servicesTotal = Array.from(selectedAppointmentIds).reduce((acc, id) => {
            const apt = readyForCheckoutAppointments.find(a => a.id === id);
            if (!apt) return acc;
            return acc + (redeemedOffer?.id === apt.serviceId ? 0 : apt.service?.price || 0) + apt.addOnServices.reduce((s, a) => s + a.price, 0);
        }, 0);
        const retailTotal = retailItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        return servicesTotal + retailTotal;
    }, [selectedAppointmentIds, readyForCheckoutAppointments, retailItems, redeemedOffer]);

    const total = subtotal + (subtotal * 0.07) + tipAmount;

    return (
        <>
            <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-6 pb-24 lg:pb-8">
                        <CheckoutQueue appointments={readyForCheckoutAppointments as any} onSelectAppointment={handleSelectAppointment} selectedAppointmentIds={selectedAppointmentIds} onScanClick={() => setIsScannerOpen(true)} />
                        <Card><CardHeader><CardTitle>Currently In Service</CardTitle></CardHeader><CardContent>
                            {(appointments.filter(a => a.status === 'servicing')).length > 0 ? (
                                <ScrollArea><div className="flex space-x-4 pb-4">{appointments.filter(a => a.status === 'servicing').map(apt => (
                                    <div key={apt.id} className="w-72 shrink-0"><InServiceAppointmentCard appointment={apt} services={services} staff={staff} onSendToCheckout={() => {}} /></div>
                                ))}</div><ScrollBar orientation="horizontal" /></ScrollArea>
                            ) : <p className="text-center text-muted-foreground p-8">No clients in service.</p>}
                        </CardContent></Card>
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="catalog">Retail Catalog</TabsTrigger><TabsTrigger value="queue">Walk-in Queue</TabsTrigger></TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6"><RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={(i: any) => setRetailItems([...retailItems, { ...i, quantity: 1, price: i.price || i.msrp || 0, type: 'product' }])} /></TabsContent>
                        </Tabs>
                    </main>
                    <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto"><CheckoutHub cart={retailItems} onCartChange={setRetailItems} appointmentsData={Array.from(selectedAppointmentIds).map(id => readyForCheckoutAppointments.find(a => a.id === id)).filter(Boolean) as any} onSelectAppointment={handleSelectAppointment} clients={clients || []} isGroupCheckout={selectedAppointmentIds.size > 1} payerOptions={[]} selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} onAddClientClick={() => setIsAddClientOpen(true)} onScanClick={() => setIsScannerOpen(true)} subtotal={subtotal} tax={subtotal * 0.07} total={total} tipAmount={tipAmount} setTipAmount={setTipAmount} onCheckout={() => setIsReceiptDialogOpen(true)} appliedDiscountCodes={appliedDiscountCodes} setAppliedDiscountCodes={setAppliedDiscountCodes} discount={0} membershipDiscount={0} isSubmitting={isSubmitting} paymentTab={paymentTab} setPaymentTab={setPaymentTab} discounts={discounts || []} amountTendered={amountTendered} setAmountTendered={setAmountTendered} adjustments={[]} appliedAdjustments={new Set()} onApplyAdjustmentToggle={() => {}} absorbedCost={0} redeemedOffer={redeemedOffer} setRedeemedOffer={setRedeemedOffer} memberships={memberships || []} packages={packages || []} allowStacking={false} /></aside>
                </div>
            </div>

            <AppointmentDetailsSheet 
                open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={viewingAppointment}
                client={clients?.find(c => c.id === viewingAppointment?.clientId) || null}
                service={services?.find(s => s.id === viewingAppointment?.serviceId) || null}
                tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []}
                onStartService={() => {}} onFinishService={() => {}} onEdit={() => {}} onDelete={() => {}} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}}
            />

            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
              <DialogContent className="sm:max-w-md p-0 overflow-hidden">
                <DialogHeader className="p-4 pb-0"><DialogTitle>Scan Ticket or SKU</DialogTitle><DialogDescription>Scanning is automatic. Position the code inside the frame.</DialogDescription></DialogHeader>
                <div className="p-4 space-y-4"><div className="relative overflow-hidden rounded-xl border-2 border-muted bg-muted/50 aspect-square"><div id="qr-reader-pos" className="w-full h-full" /><div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div></div>
                  <Separator /><form onSubmit={handleManualTicketSubmit} className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-widest"><Keyboard className="w-4 h-4" /><span>Manual Entry</span></div><div className="flex gap-2"><Input placeholder="Enter Ticket or Product ID..." value={manualTicketId} onChange={(e) => setManualTicketId(e.target.value)} className="h-11 font-mono uppercase" /><Button type="submit" disabled={!manualTicketId.trim()}>Pull Up</Button></div></form>
                </div>
                <DialogFooter className="p-4 pt-0"><Button variant="outline" onClick={() => setIsScannerOpen(false)} className="w-full">Close Scanner</Button></DialogFooter>
              </DialogContent>
            </Dialog>
        </>
    );

    function handleManualTicketSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (manualTicketId.trim()) { handleScan(`clarityflow://checkout/${manualTicketId.trim()}`); setManualTicketId(''); }
    }
}
