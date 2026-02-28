
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type PricingTier, InventoryItem, AppointmentCheckoutState, getServicePrice, type Discount, type Membership, type Package } from '@/lib/data';
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
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes, addMonths, subMonths, isAfter, format, isSameMonth, differenceInDays } from 'date-fns';
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
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';

type EditableFormulaItem = { id: string; name: string; price: number; quantity: number; imageUrl?: string; stock?: number; type: 'product' | 'service' | 'membership' | 'package'; staffId?: string; };

export default function POSPage() {
    const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages, pricingTiers } = useInventory();
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const router = useRouter();
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
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [viewingAppointment, setViewingAppointment] = useState<Appointment | null>(null);
    const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
    const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package' | 'retail_discount', id: string} | null>(null);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    
    const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
    const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);

    const appointments = useMemo(() => appointmentsFromInventory || [], [appointmentsFromInventory]);

    const readyForCheckoutAppointments = useMemo(() => {
        if (!appointments || !clients || !services || !staff) return [];
        return appointments
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);
                return { 
                    id: apt.id,
                    appointment: apt,
                    client, 
                    service, 
                    addOnServices, 
                    staff: staffMember 
                };
            }).filter((a): a is { id: string, appointment: Appointment, client: Client, service: Service, addOnServices: Service[], staff: Staff } => !!(a.client && a.service));
    }, [appointments, clients, services, staff]);

    const handleSelectAppointment = useCallback((id: string) => {
        setSelectedAppointmentIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleAddToCart = useCallback((item: any) => {
        setRetailItems(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) {
                return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            let price = 0;
            let type: 'product' | 'service' | 'membership' | 'package' = 'product';
            
            if ('msrp' in item) {
                price = item.msrp || item.costPerUnit || 0;
                type = 'product';
            } else if ('duration' in item) {
                price = item.price || 0;
                type = 'service';
            } else if ('interval' in item) {
                price = item.price || 0;
                type = 'membership';
            } else if ('sessions' in item) {
                price = item.price || 0;
                type = 'package';
            }

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
              toast({ title: "Viewing Progress", description: `Opening progress for ${apt.clientName}.` });
          }
      } else {
          const product = inventory.find(p => p.sku === raw || p.id === id);
          if (product) {
              handleAddToCart(product);
              toast({ title: "Product Added" });
          } else toast({ variant: 'destructive', title: 'Code Not Recognized' });
      }
    }, [appointments, inventory, handleSelectAppointment, handleAddToCart, toast]);

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

    const selectedClient = useMemo(() => clients?.find(c => c.id === selectedClientId), [clients, selectedClientId]);

    const subtotal = useMemo(() => {
        const servicesTotal = Array.from(selectedAppointmentIds).reduce((acc, id) => {
            const aptData = readyForCheckoutAppointments.find(a => a.id === id);
            if (!aptData) return acc;
            
            const servicePrice = redeemedOffer?.id === aptData.service.id ? 0 : getServicePrice(aptData.service, aptData.staff);
            const addOnsPrice = aptData.addOnServices.reduce((s, a) => s + getServicePrice(a, aptData.staff), 0);
            
            return acc + servicePrice + addOnsPrice;
        }, 0);
        const retailTotal = retailItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        return servicesTotal + retailTotal;
    }, [selectedAppointmentIds, readyForCheckoutAppointments, retailItems, redeemedOffer]);

    const { totalDiscountValue, membershipDiscountValue } = useMemo(() => {
        let disc = 0;
        let memDisc = 0;

        if (selectedClientId) {
            const client = clients.find(c => c.id === selectedClientId);
            if (client?.activeMembershipId && redeemedOffer?.type === 'retail_discount') {
                const membership = memberships.find(m => m.id === client.activeMembershipId);
                const retailTotal = retailItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                if (membership?.retailDiscount && retailTotal > 0) {
                    memDisc = retailTotal * (membership.retailDiscount / 100);
                }
            }
        }

        appliedDiscountCodes.forEach(code => {
            const d = discounts.find(disc => disc.code === code);
            if (!d) return;

            let basis = 0;
            if (!d.applicableServiceIds || d.applicableServiceIds.length === 0) {
                basis = subtotal;
            } else {
                const eligibleServicesTotal = Array.from(selectedAppointmentIds).reduce((acc, id) => {
                    const data = readyForCheckoutAppointments.find(a => a.id === id);
                    if (!data) return acc;
                    let sTotal = 0;
                    if (d.applicableServiceIds?.includes(data.appointment.serviceId)) {
                        sTotal += redeemedOffer?.id === data.service.id ? 0 : getServicePrice(data.service, data.staff);
                    }
                    data.addOnServices.forEach(addOn => {
                        if (d.applicableServiceIds?.includes(addOn.id)) {
                            sTotal += getServicePrice(addOn, data.staff);
                        }
                    });
                    return acc + sTotal;
                }, 0);
                
                const eligibleRetailTotal = retailItems.filter(item => d.applicableServiceIds?.includes(item.id))
                    .reduce((acc, item) => acc + (item.price * item.quantity), 0);
                
                basis = eligibleServicesTotal + eligibleRetailTotal;
            }

            if (d.type === 'percentage') {
                disc += basis * (d.value / 100);
            } else {
                disc += d.value;
            }
        });

        return { totalDiscountValue: disc, membershipDiscountValue: memDisc };
    }, [appliedDiscountCodes, discounts, subtotal, selectedAppointmentIds, readyForCheckoutAppointments, retailItems, selectedClientId, clients, memberships, redeemedOffer]);

    const subtotalAfterDiscounts = Math.max(0, subtotal - (totalDiscountValue + membershipDiscountValue));
    const tax = subtotalAfterDiscounts * 0.07;
    const total = subtotalAfterDiscounts + tax + tipAmount;

    useEffect(() => {
        if (selectedAppointmentIds.size > 0 && !selectedClientId) {
            const firstAptId = Array.from(selectedAppointmentIds)[0];
            const aptData = readyForCheckoutAppointments.find(a => a.id === firstAptId);
            if (aptData) {
                setSelectedClientId(aptData.appointment.clientId);
            }
        }
    }, [selectedAppointmentIds, readyForCheckoutAppointments, selectedClientId]);

    const handleCheckout = async (paymentDetails: { paymentMethod: string; amountTendered?: number }) => {
        if (!firestore || !tenantId) return;
        if (!selectedClientId && Array.from(selectedAppointmentIds).length > 0) {
            toast({ variant: 'destructive', title: 'Payer Required' });
            return;
        }

        setIsSubmitting(true);
        const batch = writeBatch(firestore);
        const now = new Date();
        const nowISO = now.toISOString();

        // Track local product states to handle multiple impacts on same SKU in one checkout
        const productStates = new Map<string, any>();
        const getProductState = (id: string) => {
            if (productStates.has(id)) return productStates.get(id);
            const p = inventory.find(i => i.id === id);
            if (!p) return null;
            const state = { ...p, batches: JSON.parse(JSON.stringify(p.batches)) };
            productStates.set(id, state);
            return state;
        };

        try {
            // 1. Process Appointments
            for (const id of Array.from(selectedAppointmentIds)) {
                const data = readyForCheckoutAppointments.find(a => a.id === id);
                if (!data) continue;

                const { appointment, service, staff: provider, client: aptClient } = data;
                const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
                const shortTicketId = appointment.id.slice(-6).toUpperCase();
                
                // Inventory Logic: Professional Products from Formula
                if (appointment.checkoutState?.formula) {
                    for (const formulaItem of appointment.checkoutState.formula) {
                        const pState = getProductState(formulaItem.id);
                        if (!pState) continue;

                        const qty = formulaItem.quantity;
                        if (pState.costingMethod === 'uses') {
                            const usesPerContainer = pState.estimatedUses || 1;
                            let currentUses = (pState.partialContainerUses || 0) - qty;
                            while (currentUses < 0 && pState.totalStock > 0) {
                                // FIFO Batch Reduction
                                const sorted = pState.batches.sort((a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                                for (const b of sorted) { if (b.stock > 0) { b.stock -= 1; break; } }
                                pState.totalStock -= 1;
                                currentUses += usesPerContainer;
                            }
                            pState.partialContainerUses = currentUses;
                        } else if (pState.costingMethod === 'size') {
                            const sizePerContainer = pState.size || 1;
                            let currentSize = (pState.partialContainerSize || 0) - qty;
                            while (currentSize < 0 && pState.totalStock > 0) {
                                const sorted = pState.batches.sort((a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                                for (const b of sorted) { if (b.stock > 0) { b.stock -= 1; break; } }
                                pState.totalStock -= 1;
                                currentSize += sizePerContainer;
                            }
                            pState.partialContainerSize = currentSize;
                        } else {
                            pState.totalStock -= qty;
                        }

                        const scRef = doc(collection(firestore, 'tenants', tenantId, 'stockCorrections'));
                        batch.set(scRef, {
                            productId: pState.id,
                            date: nowISO,
                            change: -qty,
                            unit: pState.costingMethod === 'uses' ? (pState.useUnit || 'uses') : (pState.unit || 'units'),
                            reason: `Service: ${service.name} (#${shortTicketId}) for ${aptClient.name} by ${provider.name}`
                        });
                    }
                }

                batch.update(appointmentRef, { 
                    status: 'completed',
                    inventoryProcessed: true,
                    discountAmount: (totalDiscountValue + membershipDiscountValue) / (selectedAppointmentIds.size || 1),
                    appliedDiscountCode: appliedDiscountCodes.join(', ')
                });

                if (appointment.checkInToken) {
                    batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'completed' });
                }

                const staffRef = doc(firestore, 'tenants', tenantId, 'staff', provider.id);
                batch.update(staffRef, { status: 'idle', lastServedTimestamp: nowISO });

                const servicePrice = redeemedOffer?.id === service.id ? 0 : getServicePrice(service, provider);
                const serviceTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                batch.set(serviceTxnRef, {
                    date: nowISO,
                    description: `Service: ${service.name}`,
                    clientOrVendor: selectedClient?.name || 'Walk-in',
                    clientId: selectedClientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Service Revenue',
                    amount: servicePrice,
                    paymentMethod: paymentDetails.paymentMethod,
                    hasReceipt: true,
                    staffId: provider.id,
                    appointmentId: appointment.id,
                });

                data.addOnServices.forEach(addon => {
                    const addonPrice = getServicePrice(addon, provider);
                    const addonTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                    batch.set(addonTxnRef, {
                        date: nowISO,
                        description: `Add-on: ${addon.name}`,
                        clientOrVendor: selectedClient?.name || 'Walk-in',
                        clientId: selectedClientId,
                        type: 'income',
                        context: 'Business',
                        category: 'Service Revenue',
                        amount: addonPrice,
                        paymentMethod: paymentDetails.paymentMethod,
                        hasReceipt: true,
                        staffId: provider.id,
                        appointmentId: appointment.id,
                    });
                });
            }

            // 2. Process Retail
            for (const item of retailItems) {
                const pState = getProductState(item.id);
                if (pState && item.type === 'product') {
                    // FIFO Deduction
                    const sorted = pState.batches.sort((a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                    let remaining = item.quantity;
                    for (const b of sorted) {
                        if (remaining <= 0) break;
                        const d = Math.min(b.stock, remaining);
                        b.stock -= d;
                        remaining -= d;
                    }
                    pState.totalStock = sorted.reduce((acc: number, b: any) => acc + b.stock, 0);
                    pState.batches = sorted;

                    const scRef = doc(collection(firestore, 'tenants', tenantId, 'stockCorrections'));
                    batch.set(scRef, {
                        productId: pState.id,
                        date: nowISO,
                        change: -item.quantity,
                        unit: 'units',
                        reason: `Retail Sale: ${item.name} to ${selectedClient?.name || 'Walk-in'}`
                    });
                }
                
                const retailTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                batch.set(retailTxnRef, {
                    date: nowISO,
                    description: `Retail: ${item.quantity}x ${item.name}`,
                    clientOrVendor: selectedClient?.name || 'Walk-in',
                    clientId: selectedClientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Retail',
                    amount: item.price * item.quantity,
                    paymentMethod: paymentDetails.paymentMethod,
                    hasReceipt: true,
                });
            }

            // Write all modified product states back
            productStates.forEach((state, id) => {
                const productRef = doc(firestore, 'tenants', tenantId, 'inventory', id);
                batch.update(productRef, {
                    totalStock: state.totalStock,
                    batches: state.batches,
                    partialContainerUses: state.partialContainerUses ?? 0,
                    partialContainerSize: state.partialContainerSize ?? 0
                });
            });

            // 3. Process Tips
            if (tipAmount > 0) {
                const tipTxnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
                batch.set(tipTxnRef, {
                    date: nowISO,
                    description: 'Gratuity',
                    clientOrVendor: selectedClient?.name || 'Walk-in',
                    clientId: selectedClientId,
                    type: 'income',
                    context: 'Business',
                    category: 'Tips',
                    amount: tipAmount,
                    paymentMethod: paymentDetails.paymentMethod,
                    hasReceipt: true,
                    staffId: readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.staff?.id,
                });
            }

            // 4. Update Discounts
            appliedDiscountCodes.forEach(code => {
                const d = discounts.find(disc => disc.code === code);
                if (d) {
                    batch.update(doc(firestore, 'tenants', tenantId, 'discounts', d.id), { usageCount: increment(1) });
                }
            });

            await batch.commit();
            
            setReceiptToPrint({
                business: { name: selectedTenant?.name || 'ClarityFlow', phone: selectedTenant?.twilioPhoneNumber || '' },
                clientName: selectedClient?.name || 'Walk-in Customer',
                date: now,
                items: [
                    ...readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).flatMap(a => [
                        { name: a.service.name, quantity: 1, price: redeemedOffer?.id === a.service.id ? 0 : getServicePrice(a.service, a.staff) },
                        ...a.addOnServices.map(addon => ({ name: addon.name, quantity: 1, price: getServicePrice(addon, a.staff) }))
                    ]),
                    ...retailItems.map(i => ({ name: i.name, quantity: i.quantity, price: i.price }))
                ],
                subtotal,
                discount: totalDiscountValue + membershipDiscountValue,
                tax,
                tip: tipAmount,
                total,
                payment: {
                    method: paymentDetails.paymentMethod,
                    amountTendered: paymentDetails.amountTendered || total,
                    changeDue: (paymentDetails.amountTendered || total) - total
                }
            });
            setIsReceiptDialogOpen(true);
            
            setRetailItems([]);
            setSelectedAppointmentIds(new Set());
            setSelectedClientId(null);
            setTipAmount(0);
            setAppliedDiscountCodes([]);
            setRedeemedOffer(null);
            toast({ title: 'Sale Complete!' });

        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Checkout Failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFinishService = (apt: Appointment) => {
        setAppointmentToReview(apt);
        setIsTechnicianReviewOpen(true);
    };

    const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
        if (!firestore || !tenantId) return;
        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
        updateDocumentNonBlocking(appointmentRef, {
            status: 'ready_for_checkout',
            checkoutState,
            actualEndTime: new Date().toISOString(),
        });
        const appointment = appointments?.find(a => a.id === appointmentId);
        if (appointment?.checkInToken) {
            updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'ready_for_checkout' });
        }
        setIsTechnicianReviewOpen(false);
        setIsDetailsOpen(false);
        toast({ title: "Service Finished", description: "Client sent to checkout queue." });
    };

    const handleStartService = (id: string) => {
        if (!firestore || !tenantId) return;
        const now = new Date().toISOString();
        updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), { status: 'servicing', actualStartTime: now });
        const apt = appointments?.find(a => a.id === id);
        if (apt?.checkInToken) {
            updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'servicing' });
        }
    }

    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        selectedAppointmentIds.forEach(aptId => {
          const aptData = readyForCheckoutAppointments.find(a => a.id === aptId);
          if (aptData) clientIds.add(aptData.appointment.clientId);
        });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [selectedAppointmentIds, readyForCheckoutAppointments, clients]);

    const checkoutHubProps = {
        cart: retailItems, 
        onCartChange: setRetailItems,
        appointmentsData: Array.from(selectedAppointmentIds).map(id => readyForCheckoutAppointments.find(a => a.id === id)).filter(Boolean) as any,
        onSelectAppointment: handleSelectAppointment,
        clients: clients || [],
        isGroupCheckout: selectedAppointmentIds.size > 1,
        payerOptions,
        selectedClientId,
        setSelectedClientId,
        onAddClientClick: () => setIsAddClientOpen(true),
        onScanClick: () => setIsScannerOpen(true),
        subtotal,
        tax,
        total,
        tipAmount,
        setTipAmount,
        onCheckout: handleCheckout,
        appliedDiscountCodes,
        setAppliedDiscountCodes,
        discount: totalDiscountValue,
        membershipDiscount: membershipDiscountValue,
        isSubmitting,
        paymentTab,
        setPaymentTab,
        discounts: discounts || [],
        amountTendered,
        setAmountTendered,
        adjustments: [],
        appliedAdjustments: new Set<string>(),
        onApplyAdjustmentToggle: () => {},
        absorbedCost: 0,
        redeemedOffer,
        setRedeemedOffer,
        memberships: memberships || [],
        packages: packages || [],
        allowStacking: selectedTenant?.allowDiscountStacking || false,
        showTitle: false,
    };

    return (
        <>
            <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-6 pb-24 lg:pb-8">
                        <CheckoutQueue appointments={readyForCheckoutAppointments} onSelectAppointment={handleSelectAppointment} selectedAppointmentIds={selectedAppointmentIds} onScanClick={() => setIsScannerOpen(true)} />
                        <Card><CardHeader><CardTitle>Currently In Service</CardTitle></CardHeader><CardContent>
                            {(appointments.filter(a => a.status === 'servicing')).length > 0 ? (
                                <ScrollArea><div className="flex space-x-4 pb-4">{appointments.filter(a => a.status === 'servicing').map(apt => (
                                    <div key={apt.id} className="w-72 shrink-0">
                                        <InServiceAppointmentCard 
                                            appointment={apt} 
                                            services={services} 
                                            staff={staff} 
                                            onSendToCheckout={() => handleFinishService(apt)} 
                                        />
                                    </div>
                                ))}</div><ScrollBar orientation="horizontal" /></ScrollArea>
                            ) : <p className="text-center text-muted-foreground p-8">No clients in service.</p>}
                        </CardContent></Card>
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="catalog">Retail Catalog</TabsTrigger><TabsTrigger value="queue">Walk-in Queue</TabsTrigger></TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6"><RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} /></TabsContent>
                            <TabsContent value="queue" className="flex-1 mt-6">
                                <WalkInQueue 
                                    walkIns={walkIns} 
                                    appointments={readyForCheckoutAppointments.map(a => a.appointment).filter(a => a.status === 'servicing')} 
                                    services={services} 
                                    staff={staff} 
                                    onAssignStaff={() => {}}
                                    onAssignNext={() => {}}
                                    onCancel={() => {}}
                                    onStartService={handleStartService}
                                    orderedWaitingQueue={[]}
                                    onReorder={() => {}}
                                    assignmentMode="ordered_list"
                                    onPrintTicket={() => {}}
                                    onSkip={() => {}}
                                    onReturnToQueue={() => {}}
                                    groupSizes={new Map()}
                                    onToggleWaitForStaff={() => {}}
                                />
                            </TabsContent>
                        </Tabs>
                    </main>
                    <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4">Current Sale</h2>
                        <CheckoutHub {...checkoutHubProps} />
                    </aside>
                </div>
            </div>

            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden z-40">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild>
                            <Button className="w-full h-14 text-lg" size="lg" disabled={retailItems.length === 0 && selectedAppointmentIds.size === 0}>
                                <div className="flex justify-between items-center w-full">
                                    <span><ShoppingCart className="inline-block mr-2" />{retailItems.length + selectedAppointmentIds.size} item(s)</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                            </Button>
                        </SheetTrigger>
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

            <AppointmentDetailsSheet 
                open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={viewingAppointment}
                client={clients?.find(c => c.id === viewingAppointment?.clientId) || null}
                service={services?.find(s => s.id === viewingAppointment?.serviceId) || null}
                tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []}
                onStartService={handleStartService} 
                onFinishService={handleFinishService} 
                onEdit={() => {}} onDelete={() => {}} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}}
                resources={[]}
            />

            {appointmentToReview && (
                <TechnicianReviewDialog 
                    open={isTechnicianReviewOpen}
                    onOpenChange={setIsTechnicianReviewOpen}
                    appointmentData={{
                        appointment: appointmentToReview,
                        client: clients?.find(c => c.id === appointmentToReview.clientId),
                        service: services?.find(s => s.id === appointmentToReview.serviceId)
                    }}
                    staff={staff || []}
                    onSendToFrontDesk={handleSendToFrontDesk}
                />
            )}

            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
              <DialogContent className="sm:max-w-md p-0 overflow-hidden">
                <DialogHeader className="p-4 pb-0"><DialogTitle>Scan Ticket or SKU</DialogTitle><DialogDescription>Scanning is automatic. Position the code inside the frame.</DialogDescription></DialogHeader>
                <div className="p-4 space-y-4"><div className="relative overflow-hidden rounded-xl border-2 border-muted bg-muted/50 aspect-square"><div id="qr-reader-pos" className="w-full h-full" /><div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div></div>
                  <Separator /><form onSubmit={(e) => { e.preventDefault(); if (manualTicketId.trim()) { handleScan(`clarityflow://checkout/${manualTicketId.trim()}`); setManualTicketId(''); } }} className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-widest"><Keyboard className="w-4 h-4" /><span>Manual Entry</span></div><div className="flex gap-2"><Input placeholder="Enter Ticket or Product ID..." value={manualTicketId} onChange={(e) => setManualTicketId(e.target.value)} className="h-11 font-mono uppercase" /><Button type="submit" disabled={!manualTicketId.trim()}>Pull Up</Button></div></form>
                </div>
                <DialogFooter className="p-4 pt-0"><Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Close Scanner</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={(d) => { if (!firestore || !selectedTenant) return; const newClient = { ...d, id: nanoid(), lifetimeValue: 0, lastAppointment: new Date().toISOString(), status: 'active' as const }; setDocumentNonBlocking(doc(firestore, 'tenants', selectedTenant.id, 'clients', newClient.id), newClient, {}); toast({ title: "Client Added" }); }} />
            
            {receiptToPrint && (
                <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
                    <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
                        <DialogHeader><DialogTitle>Receipt</DialogTitle></DialogHeader>
                        <PrintReceipt data={receiptToPrint} />
                        <DialogFooter><Button onClick={() => window.print()}>Print</Button></DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
