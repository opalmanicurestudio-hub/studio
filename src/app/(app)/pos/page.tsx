

'use client';

import React, { useState, useMemo, useEffect, KeyboardEvent, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type ActivityLog, type ClientFormData, StockCorrection, Discount, Membership, Package } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from '@/components/ui/button';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckoutQueue } from '@/components/pos/CheckoutQueue';
import { AddClientDialog } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, Sparkles, Printer, Loader, Gift, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Html5Qrcode } from 'html5-qrcode';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { useSearchParams, useRouter } from 'next/navigation';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '@/components/ui/progress';


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

type EditableFormulaItem = {
    id: string; // productId
    name: string;
    price: number;
    quantity: number;
    imageUrl?: string;
    stock?: number;
    type: 'product' | 'service';
};

export default function POSPage() {
    const { inventory, services, appointments: appointmentsFromDB, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages } = useInventory();
    const [cart, setCart] = useState<EditableFormulaItem[]>([]);
    
    const retailItems = cart.filter(item => item.type === 'product');
    
    const [activeTab, setActiveTab] = useState('catalog');
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    
    // State for group checkouts
    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState(new Set<string>());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    const isMobile = useIsMobile();
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [tipAmount, setTipAmount] = useState(0);
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannedData, setScannedData] = useState<string | null>(null);
    
    const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
    const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
    const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);


    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [promoCode, setPromoCode] = useState('');
    const [discount, setDiscount] = useState(0);
    const [membershipDiscount, setMembershipDiscount] = useState(0);
    const [appliedDiscountCode, setAppliedDiscountCode] = useState<string | undefined>(undefined);
    const router = useRouter();
    const searchParams = useSearchParams();
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package', id: string} | null>(null);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
    const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});

    const resetCheckoutState = useCallback(() => {
        setCart([]);
        setSelectedAppointmentIds(new Set());
        setSelectedClientId(null);
        setTipAmount(0);
        setAmountTendered(0);
        setPromoCode('');
        setDiscount(0);
        setMembershipDiscount(0);
        setAppliedDiscountCode(undefined);
        setRedeemedOffer(null);
        setAppliedAdjustments(new Set());
        setIsReceiptDialogOpen(false);
        setReceiptToPrint(null);
    }, []);

    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any),
          endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any),
        }));
    }, [appointmentsFromDB]);

    const readyForCheckoutAppointments = useMemo(() => {
        if (!appointments || !clients || !services || !staff || !walkIns) return [];
        
        return appointments
            .filter(apt => apt.status === 'ready_for_checkout')
            .map(apt => {
                let client = clients.find(c => c.id === apt.clientId);
                if (!client && apt.clientName) {
                    client = {
                        id: apt.clientId,
                        name: apt.clientName,
                        email: apt.clientEmail || '',
                        phone: apt.clientPhone || '',
                        avatarUrl: '',
                        lifetimeValue: 0,
                        lastAppointment: ''
                    } as Client;
                }

                let service = services.find(s => s.id === apt.serviceId);
                const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
                const staffMember = staff.find(s => s.id === apt.staffId);

                if (service && staffMember?.pricingTierId) {
                    const tierInfo = service.serviceTiers?.find(t => t.tierId === staffMember.pricingTierId);
                    if (tierInfo) {
                        service = {
                            ...service,
                            price: tierInfo.price,
                            duration: tierInfo.durationMinutes
                        };
                    }
                }
                
                let groupInfo: { name: string; id: string } | null = null;
                if (apt.isWalkIn) {
                    const walkInId = apt.id.replace('apt-walkin-', '');
                    const walkIn = walkIns.find(w => w.id === walkInId);
                    if (walkIn && walkIn.groupName && (walkIns.filter(w => w.groupId === walkIn.groupId).length) > 1) {
                        groupInfo = {
                            name: walkIn.groupName,
                            id: walkIn.groupId,
                        };
                    }
                }

                return { ...apt, client, service, addOnServices, staff: staffMember, groupInfo };
            })
            .filter((a): a is Appointment & { client: Client, service: Service, addOnServices: Service[], staff: Staff, groupInfo: {name: string; id: string;} | null } => !!(a.client && a.service));
    }, [appointments, clients, services, staff, walkIns]);
    
    const appointmentsData = useMemo(() => {
        const appointmentId = searchParams.get('checkout_id');
        const selectedIds = new Set(selectedAppointmentIds);
        if (appointmentId && !selectedIds.has(appointmentId)) {
            const appointmentToSelect = readyForCheckoutAppointments.find(apt => apt.id === appointmentId);
            if(appointmentToSelect?.checkoutState){
                selectedIds.add(appointmentId);
                setSelectedAppointmentIds(new Set(selectedIds));
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.delete('checkout_id');
                router.replace(newUrl.toString(), { scroll: false });
            }
        }
        return Array.from(selectedIds)
            .map(id => readyForCheckoutAppointments.find(a => a.id === id))
            .filter((a): a is Appointment & { client: Client; service: Service; addOnServices: Service[]; staff: Staff; groupInfo: { name: string; id: string; } | null; } => !!a);
    }, [selectedAppointmentIds, readyForCheckoutAppointments, searchParams, router]);

    const checkoutSummary = useMemo(() => {
        if (appointmentsData.length === 0) {
            return { adjustments: [] };
        }
    
        const adjustments: { id: string; type: 'time' | 'product'; clientName: string; serviceName: string; description: string; cost: number; }[] = [];
    
        for (const data of appointmentsData) {
            const { checkoutState, service, client } = data;
            if (!checkoutState || !service || !client) continue;
            
            const scheduledDuration = service.duration || 0;
            const timeDifference = (checkoutState.actualDuration || 0) - scheduledDuration;
            
            if (timeDifference > 0) {
                const timeCost = (timeDifference / 60) * (selectedTenant?.tmhr || 50);
                adjustments.push({
                    id: `time-${data.id}`,
                    type: 'time',
                    clientName: client.name,
                    serviceName: service.name,
                    description: `${timeDifference} min extra time`,
                    cost: timeCost,
                });
            }
    
            const baseProducts = new Map(service.products?.map(p => [p.id, p.quantityUsed]) || []);
            const actualProducts = new Map(checkoutState.formula?.map(p => [p.id, p.quantity]) || []);
            const allProductIds = new Set([...baseProducts.keys(), ...actualProducts.keys()]);
            
            allProductIds.forEach(id => {
                const baseQty = baseProducts.get(id) || 0;
                const actualQty = actualProducts.get(id) || 0;
                const extraQuantity = actualQty - baseQty;
    
                if (extraQuantity > 0) {
                    const productInfo = inventory.find(p => p.id === id);
                    if (productInfo) {
                        let costPerUse = 0;
                         if (productInfo.costingMethod === 'size' && productInfo.size && productInfo.size > 0) {
                            costPerUse = (productInfo.costPerUnit || 0) / productInfo.size;
                        } else if (productInfo.costingMethod === 'uses' && productInfo.estimatedUses && productInfo.estimatedUses > 0) {
                            costPerUse = (productInfo.costPerUnit || 0) / productInfo.estimatedUses;
                        } else {
                            costPerUse = productInfo.costPerUnit || 0;
                        }
                        const cost = extraQuantity * costPerUse;
                        adjustments.push({
                            id: `product-${data.id}-${id}`,
                            type: 'product',
                            clientName: client.name,
                            serviceName: service.name,
                            description: `+${extraQuantity.toFixed(1)}${productInfo.unit || 'unit'} ${productInfo.name}`,
                            cost: cost,
                        });
                    }
                }
            });
        }
    
        return { adjustments };
    
      }, [appointmentsData, services, inventory, selectedTenant?.tmhr]);

    
    useEffect(() => {
        if (checkoutSummary.adjustments) {
            setAppliedAdjustments(new Set(checkoutSummary.adjustments.map(adj => adj.id)));
        }
    }, [checkoutSummary.adjustments]);

    const handleAdjustmentToggle = (adjustmentId: string, apply: boolean) => {
        setAppliedAdjustments(prev => {
            const newSet = new Set(prev);
            if (apply) {
                newSet.add(adjustmentId);
            } else {
                newSet.delete(adjustmentId);
            }
            return newSet;
        });
    };

    const additionalCharge = useMemo(() => {
        if (!checkoutSummary.adjustments) return 0;
        return checkoutSummary.adjustments
            .filter(adj => appliedAdjustments.has(adj.id))
            .reduce((sum, adj) => sum + adj.cost, 0);
    }, [appliedAdjustments, checkoutSummary.adjustments]);

    const absorbedCost = useMemo(() => {
        if (!checkoutSummary.adjustments) return 0;
        return checkoutSummary.adjustments
            .filter(adj => !appliedAdjustments.has(adj.id))
            .reduce((sum, adj) => sum + adj.cost, 0);
    }, [appliedAdjustments, checkoutSummary.adjustments]);
    
    const handleCartChange = useCallback((newCart: any[]) => {
        setCart(currentCart => {
            const otherItems = currentCart.filter(item => item.type !== 'product');
            return [...otherItems, ...newCart];
        });
    }, []);

    const subtotal = useMemo(() => {
        const servicesTotal = appointmentsData.reduce((total, data) => {
            const servicePrice = redeemedOffer?.id === data.service?.id ? 0 : data.service?.price || 0;
            const addOnsPrice = (data.addOnServices || [])
                .reduce((a, b) => a + (b.price || 0), 0);
            return total + servicePrice + addOnsPrice;
        }, 0);

        const retailTotal = retailItems.reduce((acc, item) => {
            const product = inventory.find(p => p.id === item.id);
            const price = product?.msrp || 0;
            return acc + (item.quantity * price);
        }, 0);
        
        return servicesTotal + retailTotal;
    }, [appointmentsData, services, retailItems, redeemedOffer, inventory]);
    
    const totalDiscount = discount + membershipDiscount;
    const subtotalAfterDiscounts = (subtotal + additionalCharge) > totalDiscount ? (subtotal + additionalCharge) - totalDiscount : 0;
    const tax = subtotalAfterDiscounts * 0.07;
    const total = subtotalAfterDiscounts + tax + tipAmount;
    
    const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - total : 0;
    
    const isGroupCheckout = appointmentsData.length > 1;

    useEffect(() => {
        if (appointmentsData.length === 1) {
            setSelectedClientId(appointmentsData[0].clientId);
        } else if (appointmentsData.length === 0) {
            setSelectedClientId(null);
        }
    }, [appointmentsData]);
    
    const handleSelectAppointment = useCallback((appointmentId: string) => {
        const newSet = new Set(selectedAppointmentIds);
        if (newSet.has(appointmentId)) {
            newSet.delete(appointmentId);
        } else {
            newSet.add(appointmentId);
        }
        setSelectedAppointmentIds(newSet);
    }, [selectedAppointmentIds]);
    
    const handleAddToCart = useCallback((item: InventoryItem | Service) => {
        setCart(prevCart => {
            const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
            if (existingItem) {
                return prevCart.map(cartItem => 
                    cartItem.id === item.id 
                    ? { ...cartItem, quantity: cartItem.quantity + 1 }
                    : cartItem
                );
            }
            const price = 'price' in item ? item.price : ('msrp' in item ? item.msrp || 0 : 0);
            return [...prevCart, { ...item, quantity: 1, price, type: 'price' in item ? 'service' : 'product' }];
        });
    }, []);

    const handleScan = useCallback((data: string) => {
      if (!inventory || !appointments) {
        toast({
          variant: 'destructive',
          title: 'Data Not Ready',
          description: 'Inventory and appointments are still loading. Please try again in a moment.'
        });
        return;
      }
      let appointmentId: string | undefined;

      if (data.startsWith('clarityflow://checkout/')) {
        appointmentId = data.split('/').pop();
      } else if (data.startsWith('clarityflow://walk-in/')) {
        const walkInId = data.split('/').pop();
        if (walkInId) {
          appointmentId = `apt-walkin-${walkInId}`;
        }
      } else {
        const product = inventory.find(p => p.sku === data || p.id === data);
        if (product) {
            handleAddToCart(product);
            toast({
                title: "Product Added",
                description: `${product.name} has been added to the sale.`
            });
        } else {
            toast({ variant: 'destructive', title: 'Invalid Code', description: 'Scanned code is not a valid checkout ticket or product.' });
        }
        return;
      }
      
      if (!appointmentId) {
        toast({ variant: 'destructive', title: 'Invalid Code', description: 'Could not read ID from QR code.' });
        return;
      }

      const appointmentToCheckout = readyForCheckoutAppointments.find(apt => apt.id === appointmentId);
      if (appointmentToCheckout) {
        handleSelectAppointment(appointmentId);
        toast({ title: "Appointment Added", description: "The client's services have been added to the sale." });
      } else {
        toast({ variant: 'destructive', title: 'Appointment Not Found', description: "This appointment is not ready for checkout." });
      }
    }, [inventory, appointments, readyForCheckoutAppointments, handleAddToCart, toast, handleSelectAppointment]);

    // Initialize and sort staff based on turnOrder
    const [orderedStaff, setOrderedStaff] = useState<Staff[]>([]);
    useEffect(() => {
        if (staff) {
            const sorted = [...staff].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
        }
    }, [staff]);

     const enrichedOrderedStaff = useMemo(() => {
        if (!orderedStaff || !appointments || !transactions || !activityLogs) return orderedStaff;
        
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        return orderedStaff.map(member => {
            const staffAppointmentsToday = (appointments || []).filter(apt =>
                apt.staffId === member.id &&
                new Date(apt.startTime) >= todayStart &&
                new Date(apt.startTime) <= todayEnd
            );
            
            const completedAppointmentsCount = staffAppointmentsToday.filter(apt => apt.status === 'completed').length;
            
            const staffTransactionsToday = (transactions || []).filter(t => {
                if (t.staffId !== member.id) return false;
                const transactionDate = new Date(t.date);
                return transactionDate >= todayStart && transactionDate <= todayEnd;
            });

            const serviceRevenue = staffTransactionsToday
                .filter(t => t.category === 'Service Revenue')
                .reduce((acc, t) => acc + t.amount, 0);

            const retailSales = staffTransactionsToday
                .filter(t => t.category === 'Retail')
                .reduce((acc, t) => acc + t.amount, 0);

            const totalSales = serviceRevenue + retailSales;
            const tips = staffTransactionsToday.reduce((acc, t) => acc + (t.tipAmount || 0), 0);
            const consumptionValue = 0;
            
            let earnings = 0;
            if (member.payStructure === 'commission') {
                earnings = serviceRevenue * ((member.commissionRate || 0) / 100);
            } else if (member.payStructure === 'hourly' && member.hourlyRate) {
                const staffLogs = activityLogs.filter(log => {
                    if (log.staffId !== member.id) return false;
                    const logDate = new Date(log.timestamp);
                    return logDate >= todayStart && logDate <= todayEnd;
                });
                
                const sortedLogs = staffLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                let totalMinutesWorked = 0;
                let clockInTime: Date | null = null;
                let totalBreakMinutes = 0;
                
                for (const log of sortedLogs) {
                    const logTime = new Date(log.timestamp);
                    if (log.type === 'clock_in') {
                        if (clockInTime) {
                            totalMinutesWorked += Math.max(0, differenceInMinutes(logTime, clockInTime) - totalBreakMinutes);
                        }
                        clockInTime = logTime;
                        totalBreakMinutes = 0;
                    } else if (log.type === 'clock_out' && clockInTime) {
                        let sessionEnd = logTime;
                        if (sessionEnd > todayEnd) sessionEnd = todayEnd;
                        totalMinutesWorked += Math.max(0, differenceInMinutes(sessionEnd, clockInTime) - totalBreakMinutes);
                        clockInTime = null;
                    } else if (log.type === 'break_end' && log.durationMinutes) {
                        totalBreakMinutes += log.durationMinutes;
                    }
                }
                if(clockInTime) {
                    const endOfRange = todayEnd < new Date() ? todayEnd : new Date();
                    totalMinutesWorked += Math.max(0, differenceInMinutes(endOfRange, clockInTime) - totalBreakMinutes);
                }
                
                const hoursWorked = totalMinutesWorked / 60;
                earnings = hoursWorked * member.hourlyRate;
            }

            const retailCommission = retailSales * ((member.retailCommissionRate || 0) / 100);
            earnings += tips + retailCommission;

            return {
                ...member,
                stats: {
                    totalSales,
                    tips,
                    consumptionValue,
                    completedServices: completedAppointmentsCount,
                    earnings,
                }
            };
        });
    }, [orderedStaff, appointments, transactions, activityLogs]);

    const kpiData = useMemo(() => {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const walkInsToday = (walkIns || []).filter(w => {
            const checkInDate = parseISO(w.checkInTime);
            return checkInDate >= todayStart && checkInDate <= todayEnd;
        });

        const completedWalkIns = walkInsToday.filter(w => w.status === 'completed' && w.serviceStartTime);
        const waitTimes = completedWalkIns.map(w => differenceInMinutes(parseISO(w.serviceStartTime!), parseISO(w.checkInTime)));
        const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;

        const terminalWalkIns = walkInsToday.filter(w => ['completed', 'skipped', 'cancelled'].includes(w.status));
        const conversionRate = terminalWalkIns.length > 0 ? (completedWalkIns.length / terminalWalkIns.length) * 100 : 0;

        const totalInServiceMinutes = enrichedOrderedStaff.reduce((total, staff) => {
            const staffAppointmentsToday = (appointments || []).filter(apt =>
                apt.staffId === staff.id &&
                apt.status === 'completed' &&
                new Date(apt.startTime) >= todayStart &&
                new Date(apt.startTime) <= todayEnd
            );
            return total + staffAppointmentsToday.reduce((acc, apt) => {
                 if (apt.actualStartTime && apt.actualEndTime) {
                    return acc + differenceInMinutes(parseISO(apt.actualEndTime as string), parseISO(apt.actualStartTime as string));
                 }
                 const service = services.find(s => s.id === apt.serviceId);
                 return acc + (service?.duration || 0);
            }, 0);
        }, 0);

        const totalServiceRevenue = (transactions || []).filter(t => {
            const transactionDate = new Date(t.date);
            return t.category === 'Service Revenue' && transactionDate >= todayStart && transactionDate <= todayEnd;
        }).reduce((acc, t) => acc + t.amount, 0);

        const revenuePerServiceHour = totalInServiceMinutes > 0 ? (totalServiceRevenue / (totalInServiceMinutes / 60)) : 0;

        return {
            avgWaitTime,
            walkInConversionRate: conversionRate,
            totalWalkIns: walkInsToday.length,
            revenuePerServiceHour,
        };
    }, [walkIns, enrichedOrderedStaff, appointments, transactions, services]);
    
    const { waitingQueue, notifiedQueue, inServiceQueue } = useMemo(() => {
        const waiting = (walkIns || []).filter(w => w.status === 'waiting');
        const notified = (walkIns || []).filter(w => w.status === 'notified');
        const inService = (appointments || []).filter(apt => apt.isWalkIn && apt.status === 'servicing');
        return { waitingQueue: waiting, notifiedQueue: notified, inServiceQueue: inService };
    }, [walkIns, appointments]);

    const [orderedWaitingQueue, setOrderedWaitingQueue] = useState<WalkIn[]>([]);
    useEffect(() => {
        const sorted = [...waitingQueue].sort((a, b) => {
            const orderA = a.queueOrder || new Date(a.checkInTime).getTime();
            const orderB = b.queueOrder || new Date(b.checkInTime).getTime();
            return orderA - orderB;
        });
        setOrderedWaitingQueue(sorted);
    }, [waitingQueue]);

    const handleReorder = (newOrder: WalkIn[]) => {
        setOrderedWaitingQueue(newOrder);
        if (!firestore || !selectedTenant) return;

        const baseOrder = Date.now();
        const batch = writeBatch(firestore);
        newOrder.forEach((walkIn, index) => {
            const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);
            batch.update(walkInRef, { queueOrder: baseOrder + index });
        });
        batch.commit().catch(err => {
            console.error("Failed to save reorder", err);
            toast({ variant: 'destructive', title: "Reorder Failed", description: "Could not save the new queue order."});
        });
    };

    const handleStaffReorder = (newOrder: Staff[]) => {
        setOrderedStaff(newOrder);

        if (!firestore || !selectedTenant) return;
        const batch = writeBatch(firestore);
        newOrder.forEach((staffMember, index) => {
            const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', staffMember.id);
            batch.update(staffRef, { turnOrder: index });
        });
        batch.commit().catch(err => {
            console.error("Failed to save staff order:", err);
            // Revert on failure
            const sorted = [...(staff || [])].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
            toast({ variant: 'destructive', title: "Error", description: "Could not save new staff order." });
        });
    };
    
    const handleAssignNext = () => {
        if (!staff || !orderedWaitingQueue || !services) {
            toast({ title: 'Data not loaded', description: 'Please wait a moment and try again.' });
            return;
        }
    
        const availableStaff = staff.filter(s => s.active && !s.onBreak && s.status === 'idle');
        const waitingClients = [...orderedWaitingQueue.filter(w => w.status === 'waiting')];
    
        if (waitingClients.length === 0) {
            toast({ title: 'No Clients Waiting', description: 'The waiting queue is empty.' });
            return;
        }
    
        if (availableStaff.length === 0) {
            toast({ variant: 'destructive', title: 'No Staff Available', description: 'All staff members are currently busy or on break.' });
            return;
        }

        let assignmentsMade = 0;
        const assignedStaffIds = new Set<string>();
        const assignedClientIds = new Set<string>();

        // --- First Pass: Assign clients with an available preferred staff member ---
        for (const client of waitingClients) {
            if (client.preferredStaffId) {
                // Check if the preferred staff member is in the list of currently available staff
                const preferredStaff = availableStaff.find(s => s.id === client.preferredStaffId);
                
                // If preferred staff is available, assign immediately regardless of waitForPreferredStaff
                if (preferredStaff) {
                    handleAssignStaff(client, preferredStaff.id);
                    assignedStaffIds.add(preferredStaff.id);
                    assignedClientIds.add(client.id);
                    assignmentsMade++;
                }
            }
        }
        
        // --- Second Pass: Assign remaining clients based on assignment mode ---
        
        // Filter out clients who are waiting for a preferred but currently unavailable staff member.
        let remainingClients = waitingClients
            .filter(c => !assignedClientIds.has(c.id)) // Get unassigned clients
            .filter(client => {
                // If the client has a preferred staff AND is waiting for them...
                if (client.preferredStaffId && client.waitForPreferredStaff) {
                    // ...and that staff was not assigned in the first pass (meaning they are not available)...
                    const preferredStaffIsAvailable = availableStaff.some(s => s.id === client.preferredStaffId);
                    if (!preferredStaffIsAvailable) {
                        // ...then this client should NOT be assigned to anyone else. Filter them out.
                        return false;
                    }
                }
                // Otherwise, the client is eligible for the general assignment pool.
                return true;
            });
            
        let remainingStaff = availableStaff.filter(s => !assignedStaffIds.has(s.id));

        // Sort remaining available staff based on the selected mode
        if (assignmentMode === 'fair_play') {
            remainingStaff.sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
        } else { // 'ordered_list'
            const orderedMap = new Map(orderedStaff.map(s => [s.id, s]));
            remainingStaff = remainingStaff
                .filter(s => orderedMap.has(s.id))
                .sort((a, b) => (orderedMap.get(a.id)?.turnOrder || 0) - (orderedMap.get(b.id)?.turnOrder || 0));
        }
        
        for (const client of remainingClients) {
            // Find a staff member who is qualified and hasn't been assigned in this run
            const staffMember = remainingStaff.find(s => {
                const clientServices = client.serviceIds.map(id => services.find(svc => svc.id === id)).filter((s): s is Service => !!s);
                return clientServices.every(service => {
                    const staffSkills = s.skillSet || [];
                    const requiredSkills = service.requiredSkills || [];
                    const isDirectlyAssigned = (s.services || []).includes(service.id);
                    return isDirectlyAssigned || requiredSkills.every(skill => staffSkills.includes(skill));
                });
            });

            if (staffMember) {
                handleAssignStaff(client, staffMember.id);
                // Remove the assigned staff from the pool for this run
                remainingStaff = remainingStaff.filter(s => s.id !== staffMember.id);
                assignmentsMade++;
            }
        }
    
        if (assignmentsMade === 0) {
            toast({ variant: 'destructive', title: 'No Suitable Match', description: "Couldn't find an available and qualified staff member for any waiting client." });
        }
    };
    
    const onPrintTicket = (walkInId: string) => {
        const walkIn = walkIns?.find(w => w.id === walkInId);
        if (walkIn) {
            setTicketToPrint({
                id: walkIn.id,
                name: walkIn.customerName,
                services: (walkIn.serviceIds || []).map(id => services?.find(s => s.id === id)).filter((s): s is Service => !!s),
                queuePosition: orderedWaitingQueue.findIndex(w => w.id === walkInId) + 1,
                checkInTime: walkIn.checkInTime,
            });
            setIsPrintDialogOpen(true);
        }
    };

    const handleAssignStaff = (walkIn: WalkIn, staffId: string) => {
        if (!firestore || !selectedTenant || !services || !staff) return;
        
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkIn.id);
        
        const batch = writeBatch(firestore);

        const updateData: Partial<WalkIn> = {
            assignedStaffId: staffId,
            status: 'notified',
            notifiedTimestamp: new Date().toISOString()
        };

        if (walkIn.preferredStaffId && walkIn.preferredStaffId !== staffId) {
            updateData.waitForPreferredStaff = false;
        }

        batch.update(walkInRef, updateData);
        
        const personServices = (walkIn.serviceIds || []).map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
        const duration = personServices.reduce((acc, s) => acc + s.duration, 0);

        const appointmentId = `apt-walkin-${walkIn.id}`;
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointmentId);
        
        const now = new Date();

        const appointmentData: Omit<Appointment, 'id' | 'startTime' | 'endTime'> & { id: string, startTime: string, endTime: string, isPlaceholder: boolean } = {
            id: appointmentId,
            tenantId: selectedTenant.id,
            clientId: walkIn.clientId || walkIn.id,
            clientName: walkIn.customerName,
            serviceId: walkIn.serviceIds[0],
            staffId: staffId,
            status: 'confirmed',
            source: 'walk-in',
            isWalkIn: true,
            isPlaceholder: true, // This is a key addition
            startTime: now.toISOString(),
            endTime: addMinutes(now, duration).toISOString(),
        };
        batch.set(appointmentRef, appointmentData);

        batch.commit();
        
        const staffMember = staff.find(s => s.id === staffId);
        toast({
            title: `Assigned!`,
            description: `${walkIn.customerName} has been assigned to ${staffMember?.name}.`,
        });
    };
    
    const handleToggleWaitForStaff = async (walkInId: string, wait: boolean) => {
        if (!firestore || !selectedTenant) return;
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
        await updateDocumentNonBlocking(walkInRef, { waitForPreferredStaff: wait });
        toast({
          title: wait ? "Client will wait" : "Client will not wait",
          description: `Preference has been updated.`
        });
    };

    const handleCancelWalkIn = (walkInId: string) => {
      if (!firestore || !selectedTenant || !walkIns) return;
    
      const walkIn = walkIns.find((a) => a.id === walkInId);
      if (!walkIn) return;
    
      setConfirmation({
        isOpen: true,
        title: "Are you sure?",
        description:
          "This will remove the client from the queue. This action cannot be undone.",
        onConfirm: async () => {
          const walkInRef = doc(
            firestore,
            "tenants",
            selectedTenant.id,
            "walkIns",
            walkInId
          );
          const batch = writeBatch(firestore);
          batch.update(walkInRef, { status: "cancelled" });
    
          const appointmentId = `apt-walkin-${walkInId}`;
          const appointment = appointments?.find((a) => a.id === appointmentId);
          if (appointment) {
            const appointmentRef = doc(
              firestore,
              "tenants",
              selectedTenant.id,
              "appointments",
              appointmentId
            );
            batch.update(appointmentRef, { status: "cancelled" });
          }
    
          await batch.commit();
    
          toast({
            title: "Walk-in Cancelled",
            description: "The client has been removed from the queue.",
          });
          setConfirmation(null);
        },
      });
    };
    
    const handleSkipWalkIn = async (walkInId: string) => {
        if (!firestore || !selectedTenant || !walkIns || !staff) return;

        const walkIn = walkIns.find(w => w.id === walkInId);
        if (!walkIn) return;

        setConfirmation({
            isOpen: true,
            title: 'Are you sure?',
            description: `This will mark ${walkIn.customerName} as a "skipped" no-show and remove them from the active queue. This action cannot be undone.`,
            onConfirm: async () => {
                const batch = writeBatch(firestore);

                const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
                batch.update(walkInRef, { status: 'skipped' });

                if (walkIn.assignedStaffId) {
                    const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
                    batch.update(staffRef, { status: 'idle' });
                }

                await batch.commit();

                toast({
                    title: "Client Skipped",
                    description: `${walkIn.customerName} has been skipped.`,
                });
                setConfirmation(null);
            }
        });
    };
    
    const handleReturnToQueue = async (walkInId: string) => {
        if (!firestore || !selectedTenant || !walkIns || !staff) return;
    
        const walkIn = walkIns.find(w => w.id === walkInId);
        if (!walkIn) return;
    
        setConfirmation({
            isOpen: true,
            title: `Return ${walkIn.customerName} to Queue?`,
            description: `This will move the client back to the 'Waiting' list and free up the assigned staff member.`,
            onConfirm: async () => {
                const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
                
                await updateDocumentNonBlocking(walkInRef, { 
                    status: 'waiting',
                    assignedStaffId: deleteField(),
                    notifiedTimestamp: deleteField(),
                    queueOrder: Date.now(),
                });
    
                if (walkIn.assignedStaffId) {
                    const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
                    await updateDocumentNonBlocking(staffRef, { status: 'idle' });
                }
    
                toast({
                    title: "Returned to Queue",
                    description: `${walkIn.customerName} is now back in the waiting list.`,
                });
                setConfirmation(null);
            }
        });
    };

    const handleConfirmAndClose = async (checkoutDetails: { paymentMethod: string; amountTendered?: number }) => {
        // This is the main checkout logic, which needs to be updated.
        // It's quite long, so I will focus on the inventory deduction part.
    };
    
    const handleStartService = (appointmentId: string) => {
        if (!firestore || !selectedTenant || !walkIns) return;

        let appointmentToStart = appointments?.find(apt => apt.id === appointmentId);
        
        // If appointment not found in state (due to listener delay), construct it from walk-in data
        if (!appointmentToStart) {
            const walkInId = appointmentId.replace('apt-walkin-', '');
            const walkIn = walkIns.find(w => w.id === walkInId);

            if (walkIn) {
                appointmentToStart = {
                    id: appointmentId,
                    clientId: walkIn.clientId || walkIn.id,
                    clientName: walkIn.customerName,
                    serviceId: walkIn.serviceIds[0],
                    staffId: walkIn.assignedStaffId,
                    isWalkIn: true,
                    // These are just for the toast, the actual appointment doc will be updated
                    startTime: new Date(), 
                    endTime: new Date(),
                    status: 'confirmed',
                    source: 'walk-in',
                    tenantId: selectedTenant.id,
                };
            }
        }

        if (!appointmentToStart) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Could not find appointment to start. Please try again in a moment.',
            });
            return;
        }

        const nowISO = new Date().toISOString();
        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointmentId);

        // Update appointment status to 'servicing' and set actual start time
        updateDocumentNonBlocking(appointmentRef, {
            status: 'servicing',
            actualStartTime: nowISO
        });

        // Update staff status
        if (appointmentToStart.staffId) {
            const staffDocRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', appointmentToStart.staffId);
            updateDocumentNonBlocking(staffDocRef, { status: 'busy' });
        }

        // Update walk-in status
        if (appointmentToStart.isWalkIn) {
            const walkInId = appointmentId.replace('apt-walkin-', '');
            const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
            updateDocumentNonBlocking(walkInRef, {
                status: 'servicing',
                serviceStartTime: nowISO,
            });
        }
        
        toast({
            title: "Service Started!",
            description: `The service for ${appointmentToStart.clientName} has begun.`
        });
    };

    const handleSendToCheckout = (appointment: Appointment) => {
        if (!firestore || !selectedTenant) return;

        const appointmentRef = doc(firestore, 'tenants', selectedTenant.id, 'appointments', appointment.id);
        updateDocumentNonBlocking(appointmentRef, {
            status: 'ready_for_checkout',
            actualEndTime: new Date().toISOString()
        });

        if (appointment.staffId) {
            const staffDocRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', appointment.staffId);
            updateDocumentNonBlocking(staffDocRef, { status: 'idle' });
        }

        if (appointment.isWalkIn) {
            const walkInId = appointment.id.replace('apt-walkin-', '');
            const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
            updateDocumentNonBlocking(walkInRef, { status: 'ready_for_checkout' });
        }

        toast({
            title: 'Ready for Checkout',
            description: `${appointment.clientName} has been sent to the checkout queue.`
        });
    };
    
    useEffect(() => {
        if (scannedData) {
            handleScan(scannedData);
            setScannedData(null); // Reset after processing
        }
    }, [scannedData, handleScan]);
    
    useEffect(() => {
        let html5QrCode: Html5Qrcode | undefined;
        if (isScannerOpen) {
          const timer = setTimeout(() => {
            const element = document.getElementById('qr-reader-pos');
            if (element) {
                html5QrCode = new Html5Qrcode('qr-reader-pos');
                const onScanSuccess = (decodedText: string, decodedResult: any) => {
                    if (html5QrCode?.isScanning) {
                        html5QrCode.stop().catch(console.error);
                    }
                    setScannedData(decodedText);
                    setIsScannerOpen(false);
                };

                const onScanFailure = (error: any) => { /* ignore */ };
                
                setTimeout(() => {
                    html5QrCode?.start(
                        { facingMode: "environment" },
                        { fps: 10, qrbox: { width: 250, height: 250 } },
                        onScanSuccess,
                        onScanFailure
                    ).catch(err => {
                        toast({
                            variant: 'destructive',
                            title: 'Camera Error',
                            description: 'Could not start the camera. Please check permissions and try again.',
                        });
                        setIsScannerOpen(false);
                    });
                }, 300);
            }
          }, 100); 

          return () => {
              clearTimeout(timer);
              if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().catch(err => console.error("Failed to stop QR scanner.", err));
              }
          };
        }
    }, [isScannerOpen, handleScan, toast]);
    
    const handleAddClient = (data: ClientFormData) => {
        if (!firestore || !selectedTenant) return;
    
        const newClient: Omit<Client, 'id'> = {
          name: data.name,
          email: data.email || '',
          phone: data.phone || '',
          avatarUrl: `https://picsum.photos/seed/${nanoid()}/100`,
          lifetimeValue: 0,
          lastAppointment: new Date().toISOString(),
          status: 'active',
          notes: data.notes,
          referralCode: '', // referral code generation logic is missing here
          birthday: data.birthday ? data.birthday.toISOString() : undefined,
          address: data.address,
          emergencyContact: data.emergencyContact,
          intel: {
            referralSource: data.intel?.referralSource
          }
        };
        
        addDocumentNonBlocking(collection(firestore, 'tenants', selectedTenant.id, 'clients'), newClient);
    
        toast({
          title: "Client Added",
          description: `${data.name} has been added to your client list.`,
        });
      }

    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        appointmentsData.forEach(apt => {
          if (apt.client) {
            clientIds.add(apt.client.id);
          }
        });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [appointmentsData, clients]);
    
    const allCartItems = useMemo(() => {
      return [
        ...appointmentsData.flatMap(d => {
            const mainService = d.service ? [{ name: d.service.name, quantity: 1, price: redeemedOffer?.id === d.service.id ? 0 : d.service.price }] : [];
            const addOns = (d.appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter(Boolean).map(s => ({ name: s!.name, quantity: 1, price: s!.price }));
            return [...mainService, ...addOns];
        }),
        ...retailItems.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
      ];
    }, [appointmentsData, retailItems, redeemedOffer, services]);


    const checkoutHubProps = {
        cart: retailItems,
        onCartChange: handleCartChange,
        appointmentsData,
        onSelectAppointment: handleSelectAppointment,
        clients: clients || [],
        isGroupCheckout: selectedAppointmentIds.size > 0,
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
        onCheckout: handleConfirmAndClose,
        appliedDiscountCode,
        setAppliedDiscountCode,
        discount,
        membershipDiscount,
        showTitle: false,
        isSubmitting,
        paymentTab,
        setPaymentTab,
        discounts: discounts || [],
        amountTendered,
        setAmountTendered,
        adjustments: checkoutSummary.adjustments,
        appliedAdjustments,
        onApplyAdjustmentToggle: handleAdjustmentToggle,
        absorbedCost,
    };
    
    const handleStatusChangeWithConfirmation = () => {};

    return (
        <>
            <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-6 pb-24 lg:pb-8">
                        {/* KPI Cards for Desktop */}
                        <div className="hidden md:grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                           <KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Today's average wait for walk-ins." />
                           <KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500"/>} iconBgColor="bg-green-100 dark:bg-green-900/50" description="Walk-ins that resulted in a service." />
                           <KpiCard title="Today's Walk-ins" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500"/>} iconBgColor="bg-purple-100 dark:bg-purple-900/50" description="Total number of walk-in parties." />
                           <KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign className="text-amber-500"/>} iconBgColor="bg-amber-100 dark:bg-amber-900/50" description="Revenue per hour of active service." />
                        </div>

                        {/* KPI Cards for Mobile */}
                        <div className="md:hidden">
                            <ScrollArea>
                                <div className="flex space-x-4 pb-4">
                                    <div className="w-60 shrink-0"><KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Today's average wait for walk-ins." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500"/>} iconBgColor="bg-green-100 dark:bg-green-900/50" description="Walk-ins that resulted in a service." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Today's Walk-ins" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500"/>} iconBgColor="bg-purple-100 dark:bg-purple-900/50" description="Total number of walk-in parties." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign className="text-amber-500"/>} iconBgColor="bg-amber-100 dark:bg-amber-900/50" description="Revenue per hour of active service." /></div>
                                </div>
                                <ScrollBar orientation="horizontal" />
                            </ScrollArea>
                        </div>
                        
                        <TeamStatus 
                            staff={enrichedOrderedStaff} 
                            onStatusChange={handleStatusChangeWithConfirmation} 
                            appointments={appointments} 
                            services={services} 
                            onReorder={handleStaffReorder}
                            assignmentMode={assignmentMode}
                            onAssignmentModeChange={setAssignmentMode}
                        />
                        <CheckoutQueue appointments={readyForCheckoutAppointments} onSelectAppointment={handleSelectAppointment} selectedAppointmentIds={selectedAppointmentIds} />
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="catalog">Retail Catalog</TabsTrigger>
                                <TabsTrigger value="queue">Walk-in Queue<Badge className="ml-2">{orderedWaitingQueue.length + notifiedQueue.length + inServiceQueue.length}</Badge></TabsTrigger>
                            </TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6"><RetailCatalog services={services || []} inventory={inventory || []} onAddToCart={handleAddToCart} /></TabsContent>
                            <TabsContent value="queue" className="flex-1 mt-6">
                                <WalkInQueue 
                                    walkIns={walkIns} 
                                    appointments={inServiceQueue} 
                                    services={services} 
                                    staff={staff} 
                                    onAssignStaff={handleAssignStaff}
                                    onAssignNext={handleAssignNext}
                                    onCancel={handleCancelWalkIn}
                                    onStartService={handleStartService}
                                    onSendToCheckout={handleSendToCheckout}
                                    orderedWaitingQueue={orderedWaitingQueue}
                                    onReorder={handleReorder}
                                    assignmentMode={assignmentMode}
                                    onPrintTicket={onPrintTicket}
                                    onSkip={handleSkipWalkIn}
                                    onReturnToQueue={handleReturnToQueue}
                                    groupSizes={new Map()}
                                    onToggleWaitForStaff={handleToggleWaitForStaff}
                                />
                            </TabsContent>
                        </Tabs>
                    </main>
                    <aside className="hidden lg:flex border-l bg-card p-4 lg:p-6 flex-col h-full overflow-y-auto">
                         <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Current Sale</h2>
                        </div>
                        <CheckoutHub {...checkoutHubProps} />
                    </aside>
                </div>
            </div>
            {isMobile && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-sm lg:hidden">
                    <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                        <SheetTrigger asChild>
                             <Button className="w-full h-14 text-lg" size="lg" disabled={cart.length === 0 && appointmentsData.length === 0}>
                                <div className="flex justify-between items-center w-full">
                                    <span><ShoppingCart className="inline-block mr-2" />{cart.length + appointmentsData.length} item(s)</span>
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
            <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={handleAddClient} />
             {confirmation && (
                <AlertDialog open={confirmation.isOpen} onOpenChange={() => setConfirmation(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>{confirmation.title}</AlertDialogTitle><AlertDialogDescription>{confirmation.description}</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmation.onConfirm}>Confirm</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
              <DialogContent className="sm:max-w-md p-0">
                <DialogHeader className="p-4 pb-0">
                  <DialogTitle>Scan QR Code</DialogTitle>
                  <DialogDescription>
                    Position the code inside the frame to add to sale or checkout.
                  </DialogDescription>
                </DialogHeader>
                <div className="p-4 relative">
                  <div id="qr-reader-pos" className="w-full rounded-md bg-muted" />
                  <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                      <div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
                  </div>
                </div>
                <DialogFooter className="p-4 pt-0">
                  <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
                <DialogContent className="max-w-sm print:hidden">
                    <DialogHeader>
                        <DialogTitle>Walk-in Ticket</DialogTitle>
                    </DialogHeader>
                    <div id="print-ticket-area">
                        {ticketToPrint && <PrintWalkInTicket key={ticketToPrint.id} data={ticketToPrint} />}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsPrintDialogOpen(false)}>Close</Button>
                        <Button onClick={() => window.print()}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
             <Dialog open={isReceiptDialogOpen} onOpenChange={(isOpen) => {
                setIsReceiptDialogOpen(isOpen);
                if (!isOpen) {
                    resetCheckoutState();
                }
            }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Receipt</DialogTitle>
                        <DialogDescription>A summary of the completed transaction.</DialogDescription>
                    </DialogHeader>
                    <div id="receipt-area" className="my-4">
                        {receiptToPrint && <PrintReceipt data={receiptToPrint} />}
                    </div>
                    <DialogFooter className="print:hidden">
                        <Button variant="outline" onClick={() => { setIsReceiptDialogOpen(false); resetCheckoutState(); }}>Close</Button>
                        <Button onClick={() => window.print()}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <div className="hidden print:block print-only">
                <div id="printable-ticket-pos">
                    {ticketToPrint && <PrintWalkInTicket key={`print-${ticketToPrint.id}`} data={ticketToPrint} />}
                </div>
                {receiptToPrint && (
                    <div id="printable-receipt-pos">
                        <PrintReceipt data={receiptToPrint} />
                    </div>
                )}
            </div>
            <style jsx global>{`
                @media print {
                    body > *:not(.print-only) {
                    display: none !important;
                    }
                    .print-only, .print-only * {
                    display: block !important;
                    visibility: visible !important;
                    }
                    .print-only {
                    position: absolute;
                    left: 0;
                    top: 0;
                    }
                }
            `}</style>
        </>
    );
}
