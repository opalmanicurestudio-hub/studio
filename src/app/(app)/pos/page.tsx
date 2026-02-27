'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, type ActivityLog, type ClientFormData, StockCorrection, Discount, Membership, Package, PricingTier, InventoryItem } from '@/lib/data';
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
import { differenceInMinutes, parseISO, startOfDay, endOfDay, addMinutes, addMonths, subMonths, isAfter } from 'date-fns';
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
import { ShoppingCart, Clock, TrendingUp, Users, DollarSign, Sparkles, Printer, Loader, Gift, AlertTriangle, Repeat, Award, QrCode, Keyboard } from 'lucide-react';
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
import { InServiceAppointmentCard } from '@/components/pos/InServiceAppointmentCard';
import { SelectProviderDialog } from '@/components/pos/SelectProviderDialog';
import { Separator } from '@/components/ui/separator';


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
    id: string;
    name: string;
    price: number;
    quantity: number;
    imageUrl?: string;
    stock?: number;
    type: 'product' | 'service' | 'membership' | 'package';
    staffId?: string;
};

export default function POSPage() {
    const { inventory, services, appointments: appointmentsFromDB, clients, walkIns, staff, transactions, activityLogs, discounts, memberships, packages, pricingTiers } = useInventory();
    
    const [activeTab, setActiveTab] = useState('catalog');
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; title: string; description: string; onConfirm: () => void; } | null>(null);
    const [isAddClientOpen, setIsAddClientOpen] = useState(false);
    
    const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [retailItems, setRetailItems] = useState<EditableFormulaItem[]>([]);

    const isMobile = useIsMobile();
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
    const [tipAmount, setTipAmount] = useState(0);
    const [paymentTab, setPaymentTab] = useState('card');
    const [amountTendered, setAmountTendered] = useState<number>(0);
    
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannedData, setScannedData] = useState<string | null>(null);
    const [manualTicketId, setManualTicketId] = useState('');
    
    const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
    const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
    const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);


    const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
    const [discount, setDiscount] = useState(0);
    const [membershipDiscount, setMembershipDiscount] = useState(0);
    
    const router = useRouter();
    const searchParams = useSearchParams();
    const [redeemedOffer, setRedeemedOffer] = useState<{type: 'membership' | 'package' | 'retail_discount', id: string} | null>(null);
    const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
    const [serviceStaffOverrides, setServiceStaffOverrides] = useState<Record<string, string>>({});
    const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
    const [serviceToSelectProvider, setServiceToSelectProvider] = useState<Service | null>(null);

    const handleCartChange = (newCart: EditableFormulaItem[]) => {
        setRetailItems(newCart);
    };

    const toSafeDate = (val: any): Date | undefined => {
        if (!val) return undefined;
        if (val instanceof Date) return val;
        if (typeof val.toDate === 'function') return val.toDate();
        if (typeof val === 'string') return parseISO(val);
        return new Date(val);
    };

    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: toSafeDate(apt.startTime),
          endTime: toSafeDate(apt.endTime),
          actualStartTime: toSafeDate(apt.actualStartTime),
          actualEndTime: toSafeDate(apt.actualEndTime),
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
    
    useEffect(() => {
        const appointmentId = searchParams.get('checkout_id');
        if (appointmentId) {
            const appointmentExists = readyForCheckoutAppointments.find(apt => apt.id === appointmentId);
            if (appointmentExists) {
                setSelectedAppointmentIds(prev => {
                    const newSet = new Set(prev);
                    newSet.add(appointmentId);
                    return newSet;
                });
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.delete('checkout_id');
                router.replace(newUrl.toString(), { scroll: false });
            }
        }
    }, [searchParams, readyForCheckoutAppointments, router]);

    const appointmentsData = useMemo(() => {
        return Array.from(selectedAppointmentIds)
            .map(id => readyForCheckoutAppointments.find(a => a.id === id))
            .filter((a): a is Appointment & { client: Client; service: Service; addOnServices: Service[]; staff: Staff; groupInfo: { name: string; id: string; } | null; } => !!a);
    }, [selectedAppointmentIds, readyForCheckoutAppointments]);

    const subtotal = useMemo(() => {
        const servicesTotal = appointmentsData.reduce((total, data) => {
            const servicePrice = redeemedOffer?.id === data.service?.id ? 0 : data.service?.price || 0;
            const addOnsPrice = (data.addOnServices || [])
                .reduce((a, b) => a + (b.price || 0), 0);
            return total + servicePrice + addOnsPrice;
        }, 0);

        const manualItemsTotal = retailItems.reduce((acc, item) => {
            return acc + (item.quantity * item.price);
        }, 0);
        
        return servicesTotal + manualItemsTotal;
    }, [appointmentsData, retailItems, redeemedOffer]);

    useEffect(() => {
        if (appliedDiscountCodes.length === 0 || !discounts) {
            setDiscount(0);
            return;
        }

        const totalCalc = appliedDiscountCodes.reduce((acc, code) => {
            const d = discounts.find(d => d.code === code);
            if (d) {
                let applicableSubtotal = subtotal;
                if (d.applicableServiceIds && d.applicableServiceIds.length > 0) {
                    applicableSubtotal = appointmentsData.reduce((sum, data) => {
                        let innerSum = 0;
                        if (d.applicableServiceIds?.includes(data.serviceId)) {
                            innerSum += (redeemedOffer?.id === data.serviceId ? 0 : data.service.price);
                        }
                        data.addOnServices.forEach(addon => {
                            if (d.applicableServiceIds?.includes(addon.id)) {
                                innerSum += addon.price;
                            }
                        });
                        return sum + innerSum;
                    }, 0);
                }

                if (d.type === 'percentage') {
                    return acc + (applicableSubtotal * (d.value / 100));
                } else {
                    return acc + d.value;
                }
            }
            return acc;
        }, 0);

        setDiscount(totalCalc);
    }, [appliedDiscountCodes, discounts, subtotal, appointmentsData, redeemedOffer]);

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
    
      }, [appointmentsData, inventory, selectedTenant?.tmhr]);

    
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
    
    const handleAddToCart = useCallback((item: InventoryItem | Service | Membership | Package) => {
        let itemType: 'product' | 'service' | 'membership' | 'package';
        let price = 0;
        
        if ('interval' in item) {
            itemType = 'membership';
            price = item.price;
        } else if ('sessions' in item) {
            itemType = 'package';
            price = item.price;
        } else if ('duration' in item) {
            itemType = 'service';
            price = item.price;
        } else {
            itemType = 'product';
            price = item.msrp || 0;
        }
        
        const existingItem = retailItems.find(cartItem => cartItem.id === item.id);
        if (existingItem) {
            const newCart = retailItems.map(cartItem =>
                cartItem.id === item.id
                    ? { ...cartItem, quantity: cartItem.quantity + 1 }
                    : cartItem
            );
            setRetailItems(newCart);
        } else {
            setRetailItems([...retailItems, { ...item, id: item.id, name: item.name, quantity: 1, price, type: itemType }]);
        }
    }, [retailItems]);

    const handleAddServiceWithProvider = (service: Service, provider: Staff) => {
        const staffPricingTierId = provider.pricingTierId;
        let finalPrice = service.price;
    
        if (staffPricingTierId && service.serviceTiers) {
            const tierInfo = service.serviceTiers.find(t => t.tierId === staffPricingTierId);
            if (tierInfo) {
                finalPrice = tierInfo.price;
            }
        }
        
        const cartItem: EditableFormulaItem = {
            id: `${service.id}-${provider.id}-${nanoid()}`,
            name: `${service.name} (w/ ${provider.name.split(' ')[0]})`,
            price: finalPrice,
            type: 'service' as const,
            staffId: provider.id,
            quantity: 1,
        };
    
        setRetailItems(prev => [...prev, cartItem]);
        setServiceToSelectProvider(null);
    };

    const handleAddClient = (data: ClientFormData) => {
        if (!firestore || !tenantId) return;
    
        const firstName = data.name.split(' ')[0].toUpperCase();
        const referralCode = `${firstName}${nanoid(4)}`;

        const newClient: Omit<Client, 'id'> = {
          name: data.name,
          email: data.email || '',
          phone: data.phone || '',
          avatarUrl: data.avatarUrl || `https://picsum.photos/seed/${nanoid()}/100`,
          lifetimeValue: 0,
          lastAppointment: new Date().toISOString(),
          status: 'active',
          notes: data.notes,
          referralCode: referralCode,
          birthday: data.birthday ? data.birthday.toISOString() : undefined,
          address: data.address,
          emergencyContact: data.emergencyContact,
          intel: {
            referralSource: data.intel?.referralSource
          }
        };
        
        addDocumentNonBlocking(collection(firestore, 'tenants', tenantId, 'clients'), newClient);
    
        toast({
          title: "Client Added",
          description: `${data.name} has been added to your client list.`,
        });
        setIsAddClientOpen(false);
    }

    const client = useMemo(() => clients?.find(c => c.id === selectedClientId), [clients, selectedClientId]);

    const retailTotalForDiscount = useMemo(() => {
        return retailItems.filter(i => i.type === 'product').reduce((acc, item) => {
            return acc + (item.quantity * item.price);
        }, 0);
    }, [retailItems]);

    useEffect(() => {
        if (client && client.subscription?.status === 'active') {
            const membership = memberships.find(m => m.id === client.subscription!.membershipId);
            
            // Apply automatic membership discount if no limit or handled automatically
            if (membership?.retailDiscount && retailTotalForDiscount > 0) {
                // If there's a limit, it's handled via 'redeemedOffer' in CheckoutHub manually
                if (!membership.retailDiscountLimit || membership.retailDiscountLimit === 0) {
                    const discountValue = retailTotalForDiscount * (membership.retailDiscount / 100);
                    setMembershipDiscount(discountValue);
                } else {
                    // Manual limited redemption
                    if (redeemedOffer?.type === 'retail_discount') {
                        const discountValue = retailTotalForDiscount * (membership.retailDiscount / 100);
                        setMembershipDiscount(discountValue);
                    } else {
                        setMembershipDiscount(0);
                    }
                }
            } else {
                setMembershipDiscount(0);
            }
        } else {
            setMembershipDiscount(0);
        }
    }, [client, retailTotalForDiscount, memberships, redeemedOffer]);

    const totalDiscount = discount + membershipDiscount;
    const subtotalAfterDiscounts = Math.max(0, (subtotal + additionalCharge) - totalDiscount);
    const tax = subtotalAfterDiscounts * 0.07;
    const total = subtotalAfterDiscounts + tax + tipAmount;
    
    const changeDue = amountTendered > 0 && paymentTab === 'cash' ? amountTendered - total : 0;
    
     const quickTenderOptions = useMemo(() => {
        const options = new Set<number>();
        if (total <= 0) return [];
    
        const roundUp = (num: number, multiple: number) => Math.ceil(num / multiple) * multiple;

        const next5 = roundUp(total, 5);
        if (next5 > total) options.add(next5);

        const next10 = roundUp(total, 10);
        if (next10 > total) options.add(next10);

        const next20 = roundUp(total, 20);
        if (next20 > total) options.add(next20);
        
        const next50 = roundUp(total, 50);
        if (next50 > total) options.add(next50);
        
        const next100 = roundUp(total, 100);
        if (next100 > total) options.add(next100);

        return Array.from(options).sort((a,b) => a - b).slice(0, 3);
    }, [total]);

    const handleSelectAppointment = useCallback((appointmentId: string) => {
        setSelectedAppointmentIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(appointmentId)) {
                newSet.delete(appointmentId);
            } else {
                newSet.add(appointmentId);
            }
            return newSet;
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
      
      const rawData = data.trim();
      console.log("Scanned POS Data:", rawData);

      if (rawData.startsWith('clarityflow://checkout/')) {
        const appointmentIdFromData = rawData.split('/').pop()?.trim();
        if (!appointmentIdFromData) return;

        const appointment = readyForCheckoutAppointments.find(apt => 
            apt.id === appointmentIdFromData || apt.id.toUpperCase().endsWith(appointmentIdFromData.toUpperCase())
        );

        if (appointment) {
            handleSelectAppointment(appointment.id);
            toast({ title: "Client Added", description: `${appointment.clientName}'s services added to sale.` });
        } else {
            const rawApt = appointments.find(a => a.id === appointmentIdFromData || a.id.toUpperCase().endsWith(appointmentIdFromData.toUpperCase()));
            if (rawApt) {
                toast({ 
                    variant: 'destructive', 
                    title: 'Waiting for Technician', 
                    description: "This appointment is found but hasn't been sent to checkout yet." 
                });
            } else {
                toast({ variant: 'destructive', title: 'Ticket Not Found', description: "Could not find a matching appointment for this ticket." });
            }
        }
      } else if (rawData.startsWith('clarityflow://walk-in/')) {
        const walkInId = rawData.split('/').pop()?.trim();
        if (!walkInId) return;
        
        const appointmentId = `apt-walkin-${walkInId}`;
        const appointment = readyForCheckoutAppointments.find(apt => apt.id === appointmentId);
        
        if (appointment) {
            handleSelectAppointment(appointmentId);
            toast({ title: "Walk-in Added", description: `${appointment.clientName} added to sale.` });
        } else {
            const walkIn = walkIns?.find(w => w.id === walkInId);
            if (walkIn) {
                toast({ title: "Walk-in Status", description: `${walkIn.customerName} is currently ${walkIn.status.replace('_', ' ')}.` });
            } else {
                toast({ variant: 'destructive', title: 'Ticket Not Found', description: "Could not find an active walk-in for this ticket." });
            }
        }
      } else if (rawData.startsWith('clarityflow://product/')) {
        const productId = rawData.split('/').pop()?.trim();
        const product = inventory.find(p => p.id === productId || p.id.toUpperCase().endsWith(productId?.toUpperCase() || ''));
        if (product) {
            handleAddToCart(product);
            toast({ title: "Product Added", description: `${product.name} added to cart.` });
        } else {
            toast({ variant: 'destructive', title: 'Product Not Found', description: "Could not find the product in inventory." });
        }
      } else {
        const product = inventory.find(p => 
            p.sku === rawData || 
            p.id === rawData || 
            p.id.toUpperCase().endsWith(rawData.toUpperCase())
        );

        if (product) {
            handleAddToCart(product);
            toast({ title: "Product Added", description: `${product.name} added to cart.` });
        } else {
            if (rawData.length >= 5 && rawData.length <= 8) {
                const appointment = readyForCheckoutAppointments.find(apt => 
                    apt.id.toUpperCase().endsWith(rawData.toUpperCase())
                );
                if (appointment) {
                    handleSelectAppointment(appointment.id);
                    toast({ title: "Client Added", description: `${appointment.clientName}'s services added to sale.` });
                    return;
                }
            }
            toast({ variant: 'destructive', title: 'Unknown Code', description: "This code doesn't match a checkout ticket or product SKU." });
        }
      }
    }, [inventory, appointments, walkIns, readyForCheckoutAppointments, handleAddToCart, toast, handleSelectAppointment]);

    const handleManualTicketSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (manualTicketId.trim()) {
            handleScan(`clarityflow://checkout/${manualTicketId.trim()}`);
            setManualTicketId('');
        }
    };

    const [orderedStaff, setOrderedStaff] = useState<Staff[]>([]);
    useEffect(() => {
        if (staff) {
            const sorted = [...staff].sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0));
            setOrderedStaff(sorted);
        }
    }, [staff]);

     const enrichedOrderedStaff = useMemo(() => {
        if (!orderedStaff || !appointments || !transactions || !activityLogs || !services) return orderedStaff;
        
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        return orderedStaff.map(member => {
            const staffAppointmentsToday = (appointments || []).filter(apt =>
                apt.staffId === member.id &&
                apt.status === 'completed' &&
                apt.startTime &&
                apt.startTime >= todayStart &&
                apt.startTime <= todayEnd
            );
            
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

            const totalInServiceMinutes = staffAppointmentsToday.reduce((acc, apt) => {
                 if (apt.actualStartTime && apt.actualEndTime) {
                    return acc + differenceInMinutes(apt.actualEndTime, apt.actualStartTime);
                 }
                 const service = services.find(s => s.id === apt.serviceId);
                 return acc + (service?.duration || 0);
            }, 0);

            return {
                ...member,
                stats: {
                    totalSales,
                    tips,
                    consumptionValue,
                    completedServices: staffAppointmentsToday.length,
                    earnings,
                    totalInServiceMinutes
                }
            };
        });
    }, [orderedStaff, appointments, transactions, activityLogs, services]);

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

        const totalInServiceMinutes = enrichedOrderedStaff.reduce((total, staffMember) => {
            return total + (staffMember.stats?.totalInServiceMinutes || 0);
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
    }, [walkIns, enrichedOrderedStaff, transactions]);
    
    const { waitingQueue, notifiedQueue } = useMemo(() => {
        const waiting = (walkIns || []).filter(w => w.status === 'waiting');
        const notified = (walkIns || []).filter(w => w.status === 'notified');
        return { waitingQueue: waiting, notifiedQueue: notified };
    }, [walkIns]);

    const inServiceQueue = useMemo(() => {
        return (appointments || []).filter(apt => apt.status === 'servicing');
    }, [appointments]);

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

        for (const client of waitingClients) {
            if (client.preferredStaffId) {
                const preferredStaff = availableStaff.find(s => s.id === client.preferredStaffId);
                if (preferredStaff) {
                    handleAssignStaff(client, preferredStaff.id);
                    assignedStaffIds.add(preferredStaff.id);
                    assignedClientIds.add(client.id);
                    assignmentsMade++;
                }
            }
        }
        
        let remainingClients = waitingClients
            .filter(c => !assignedClientIds.has(c.id))
            .filter(client => {
                if (client.preferredStaffId && client.waitForPreferredStaff) {
                    const preferredStaffIsAvailable = availableStaff.some(s => s.id === client.preferredStaffId);
                    if (!preferredStaffIsAvailable) {
                        return false;
                    }
                }
                return true;
            });
            
        let remainingStaff = availableStaff.filter(s => !assignedStaffIds.has(s.id));

        if (assignmentMode === 'fair_play') {
            remainingStaff.sort((a, b) => (a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0));
        } else {
            const orderedMap = new Map(orderedStaff.map(s => [s.id, s]));
            remainingStaff = remainingStaff
                .filter(s => orderedMap.has(s.id))
                .sort((a, b) => (orderedMap.get(a.id)?.turnOrder || 0) - (orderedMap.get(b.id)?.turnOrder || 0));
        }
        
        for (const client of remainingClients) {
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
            isPlaceholder: true,
            startTime: now.toISOString(),
            endTime: addMinutes(now, duration).toISOString(),
        };
        batch.set(appointmentRef, appointmentData);

        const staffMember = staff.find(s => s.id === staffId);
        if (staffMember) {
            const notificationMessage = `You have a new walk-in client: ${walkIn.customerName}.`;
            const notificationRef = doc(collection(firestore, `tenants/${selectedTenant.id}/notifications`));
            batch.set(notificationRef, {
                userId: staffId,
                type: 'new_walk_in',
                message: notificationMessage,
                link: '/pos',
                createdAt: new Date().toISOString(),
                read: false,
            });
        }

        batch.commit();
        
        toast({
            title: `Assigned!`,
            description: `${walkIn.customerName} has been assigned to ${staffMember?.name}.`,
        });
    };
    
    const handleToggleWaitForStaff = (walkInId: string, wait: boolean) => {
        if (!firestore || !selectedTenant) return;
        const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
        updateDocumentNonBlocking(walkInRef, { waitForPreferredStaff: wait });
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
                const batch = writeBatch(firestore);

                const walkInRef = doc(firestore, 'tenants', selectedTenant.id, 'walkIns', walkInId);
                batch.update(walkInRef, { 
                    status: 'waiting',
                    assignedStaffId: deleteField(),
                    notifiedTimestamp: deleteField(),
                    queueOrder: Date.now(),
                }); 
    
                if (walkIn.assignedStaffId) {
                    const staffRef = doc(firestore, 'tenants', selectedTenant.id, 'staff', walkIn.assignedStaffId);
                    batch.update(staffRef, { status: 'idle' });
                }
    
                try {
                    await batch.commit();
                    toast({
                        title: "Returned to Queue",
                        description: `${walkIn.customerName} is now back in the waiting list.`,
                    });
                } catch (error) {
                     console.error("Error returning to queue:", error);
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: "Could not return client to queue."
                    });
                } finally {
                    setConfirmation(null);
                }
            }
        });
    };

    const handleStartService = (appointmentId: string) => {
        if (!firestore || !tenantId || !appointments) return;
        
        const appointmentToStart = appointments.find(apt => apt.id === appointmentId);
        if (!appointmentToStart) return;

        const batch = writeBatch(firestore);
        const nowISO = new Date().toISOString();

        const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
        batch.update(appointmentRef, { status: 'servicing', actualStartTime: nowISO });

        if (appointmentToStart.checkInToken) {
            const checkInRef = doc(firestore, 'appointmentCheckIns', appointmentToStart.checkInToken);
            batch.update(checkInRef, { status: 'servicing' });
        }
        
        if (appointmentToStart.isWalkIn) {
            const walkInId = appointmentId.replace('apt-walkin-', '');
            const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
            batch.update(walkInRef, { status: 'servicing', serviceStartTime: nowISO });
        }

        if (appointmentToStart.staffId) {
            const staffRef = doc(firestore, 'tenants', tenantId, 'staff', appointmentToStart.staffId);
            batch.update(staffRef, { status: 'busy' });
        }

        batch.commit().then(() => {
            toast({
                title: "Service Started!",
                description: `The service for ${appointmentToStart.clientName} has begun.`
            });
        }).catch(error => {
            console.error("Error starting service from POS:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not start service.' });
        });
    };

  const handleConfirmAndClose = async (checkoutDetails: { paymentMethod: string; amountTendered?: number }) => {
    setIsSubmitting(true);
    
    let finalClient = client;
    if (!finalClient && appointmentsData.length > 0) {
        finalClient = appointmentsData[0].client;
    }

    if (!finalClient || (appointmentsData.length === 0 && retailItems.length === 0)) {
        toast({ variant: 'destructive', title: 'Error', description: 'No client or items selected for checkout.' });
        setIsSubmitting(false);
        return;
    }
    
    if (!firestore || !tenantId || !selectedTenant) {
        toast({ variant: 'destructive', title: 'Database Error' });
        setIsSubmitting(false);
        return;
    }

    const batch = writeBatch(firestore);
    try {
        const now = new Date();
        const nowISO = now.toISOString();

        let finalPreTaxRevenue = 0;
        
        appointmentsData.forEach(data => {
            const servicePrice = redeemedOffer?.id === data.service?.id && (redeemedOffer.type === 'membership' || redeemedOffer.type === 'package') ? 0 : data.service?.price || 0;
            const addOnsPrice = (data.addOnServices || []).reduce((a, b) => a + (b.price || 0), 0);
            finalPreTaxRevenue += (servicePrice + addOnsPrice);
        });

        retailItems.forEach(item => {
            finalPreTaxRevenue += (item.quantity * item.price);
        });

        finalPreTaxRevenue += additionalCharge;

        const rawRevenueIncrement = finalPreTaxRevenue - totalDiscount;
        const finalRevenueIncrement = Math.max(0, isNaN(rawRevenueIncrement) ? 0 : rawRevenueIncrement);

        const clientDocRef = doc(firestore, `tenants/${tenantId}/clients`, finalClient.id);
        let clientUpdates: any = {
            lifetimeValue: increment(finalRevenueIncrement),
            lastAppointment: nowISO
        };

        const updatedProductLevels = new Map<string, { totalStock: number, partialUses: number, partialSize: number }>();

        for (const data of appointmentsData) {
            const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', data.id);
            const servicePrice = redeemedOffer?.id === data.service?.id && (redeemedOffer.type === 'membership' || redeemedOffer.type === 'package') ? 0 : data.service?.price || 0;
            
            if (redeemedOffer && redeemedOffer.id === data.service?.id) {
                if (redeemedOffer.type === 'membership') {
                    clientUpdates['subscription.perkLastUsed'] = nowISO;
                    const perkKey = `subscription.perkUsage.${data.service.id}`;
                    clientUpdates[perkKey] = increment(1);
                } else if (redeemedOffer.type === 'package') {
                    const currentPackages = finalClient.activePackages || [];
                    const pkgIdx = currentPackages.findIndex(p => p.packageId === redeemedOffer.id);
                    if (pkgIdx > -1) {
                        const newPackages = [...currentPackages];
                        newPackages[pkgIdx] = {
                            ...newPackages[pkgIdx],
                            sessionsRemaining: Math.max(0, newPackages[pkgIdx].sessionsRemaining - 1)
                        };
                        clientUpdates.activePackages = newPackages;
                    }
                }
            }

            batch.update(appointmentRef, { 
                status: 'completed', 
                inventoryProcessed: true, 
                actualEndTime: nowISO 
            });

            if (data.checkInToken) {
                const ciRef = doc(firestore, 'appointmentCheckIns', data.checkInToken);
                batch.update(ciRef, { status: 'completed', tenantId: tenantId });
            }
            
            if (data.isWalkIn) {
                const walkInId = data.id.replace('apt-walkin-', '');
                const walkInRef = doc(firestore, 'tenants', tenantId, 'walkIns', walkInId);
                batch.update(walkInRef, { status: 'completed', serviceEndTime: nowISO });
            }

            if (data.checkoutState?.formula) {
                for (const formulaItem of data.checkoutState.formula) {
                    const product = inventory.find(p => p.id === formulaItem.id);
                    if (!product) continue;

                    if (!updatedProductLevels.has(product.id)) {
                        updatedProductLevels.set(product.id, {
                            totalStock: product.totalStock,
                            partialUses: product.partialContainerUses || 0,
                            partialSize: product.partialContainerSize || 0
                        });
                    }

                    const levels = updatedProductLevels.get(product.id)!;
                    let quantityToDeduct = formulaItem.quantity;
                    let unit = 'units';

                    if (product.costingMethod === 'uses') {
                        unit = product.useUnit || 'uses';
                        levels.partialUses -= quantityToDeduct;
                        while (levels.partialUses < 0 && levels.totalStock > 0) {
                            levels.totalStock -= 1;
                            levels.partialUses += (product.estimatedUses || 1);
                        }
                    } else if (product.costingMethod === 'size') {
                        unit = product.unit || 'ml';
                        levels.partialSize -= quantityToDeduct;
                        while (levels.partialSize < 0 && levels.totalStock > 0) {
                            levels.totalStock -= 1;
                            levels.partialSize += (product.size || 1);
                        }
                    } else {
                        levels.totalStock -= quantityToDeduct;
                    }

                    batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), {
                        productId: product.id,
                        date: nowISO,
                        change: -quantityToDeduct,
                        unit: unit,
                        reason: `Service #${data.id.slice(-6).toUpperCase()}: ${data.clientName}`,
                    });
                }
            }

            const transactionBase = {
                clientOrVendor: data.clientName || finalClient.name,
                clientId: data.client?.id || finalClient.id,
                type: 'income' as const,
                context: 'Business' as const,
                paymentMethod: checkoutDetails.paymentMethod,
                hasReceipt: true,
                appliedDiscountCode: appliedDiscountCodes.join(', ') || null,
                date: nowISO,
                staffId: data.staffId,
                appointmentId: data.id,
            };

            if (servicePrice > 0) {
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {
                    ...transactionBase,
                    description: `Service: ${data.service?.name}`,
                    category: 'Service Revenue',
                    amount: servicePrice,
                });
            }

            data.addOnServices.forEach(addon => {
                if (addon.price > 0) {
                    batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {
                        ...transactionBase,
                        description: `Add-on: ${addon.name}`,
                        category: 'Service Revenue',
                        amount: addon.price,
                    });
                }
            });
        }

        const packagesToAdd: { packageId: string; sessionsRemaining: number }[] = [];

        retailItems.forEach(item => {
            const itemRevenue = item.quantity * item.price;
            if (itemRevenue <= 0) return;

            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {
                date: nowISO,
                description: `${item.type.charAt(0).toUpperCase() + item.type.slice(1)}: ${item.quantity}x ${item.name}`, 
                clientOrVendor: finalClient.name,
                clientId: finalClient.id,
                type: 'income',
                context: 'Business',
                category: item.type === 'product' ? 'Retail' : 'Membership/Package Sales', 
                amount: itemRevenue,
                paymentMethod: checkoutDetails.paymentMethod,
                hasReceipt: true,
                staffId: appointmentsData[0]?.staffId || null,
            });

            if (item.type === 'product') {
                if (!updatedProductLevels.has(item.id)) {
                    const product = inventory.find(p => p.id === item.id);
                    if (product) {
                        updatedProductLevels.set(item.id, {
                            totalStock: product.totalStock,
                            partialUses: product.partialContainerUses || 0,
                            partialSize: product.partialContainerSize || 0
                        });
                    }
                }
                const levels = updatedProductLevels.get(item.id);
                if (levels) levels.totalStock -= item.quantity;
            } else if (item.type === 'membership') {
                clientUpdates.activeMembershipId = item.id;
                clientUpdates.subscription = {
                    membershipId: item.id,
                    status: 'active',
                    nextBillingDate: addMonths(now, 1).toISOString(),
                    perkLastUsed: null,
                    perkUsage: {},
                };
            } else if (item.type === 'package') {
                const pkg = packages.find(p => p.id === item.id);
                if (pkg) packagesToAdd.push({ packageId: item.id, sessionsRemaining: pkg.sessions });
            }
        });

        if (packagesToAdd.length > 0) {
            clientUpdates.activePackages = arrayUnion(...packagesToAdd);
        }

        if (redeemedOffer?.type === 'retail_discount') {
            clientUpdates['subscription.perkLastUsed'] = nowISO;
            const discountKey = `subscription.perkUsage.retail_discount`;
            clientUpdates[discountKey] = increment(1);
        }

        if (totalDiscount > 0) {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {
                date: nowISO,
                description: `Discounts Applied: ${appliedDiscountCodes.join(', ') || 'Manual'}`,
                clientOrVendor: finalClient.name,
                clientId: finalClient.id,
                type: 'expense',
                context: 'Business',
                category: 'Discounts',
                amount: totalDiscount,
                paymentMethod: 'Internal',
                hasReceipt: false,
            });
        }

        if (additionalCharge > 0) {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {
                date: nowISO,
                description: `Additional Charges (Time/Product Adjustments)`,
                clientOrVendor: finalClient.name,
                clientId: finalClient.id,
                type: 'income',
                context: 'Business',
                category: 'Service Revenue',
                amount: additionalCharge,
                paymentMethod: checkoutDetails.paymentMethod,
                hasReceipt: false,
            });
        }

        Object.entries(tipAllocations).forEach(([staffId, tip]) => {
            if (tip > 0) {
                batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), {
                    date: nowISO,
                    description: 'Tip',
                    clientOrVendor: finalClient.name,
                    clientId: finalClient.id,
                    type: 'income',
                    context: 'Business',
                    category: 'Tips',
                    amount: tip,
                    paymentMethod: checkoutDetails.paymentMethod,
                    hasReceipt: true,
                    staffId,
                    tipAmount: tip,
                });
            }
        });

        updatedProductLevels.forEach((levels, productId) => {
            batch.update(doc(firestore, `tenants/${tenantId}/inventory`, productId), {
                totalStock: levels.totalStock,
                partialContainerUses: levels.partialUses,
                partialContainerSize: levels.partialSize
            });
        });

        batch.update(clientDocRef, clientUpdates);
        
        const allInvolvedStaffIds = new Set<string>();
        appointmentsData.forEach(d => { if (d.staffId) allInvolvedStaffIds.add(d.staffId); });
        Object.values(serviceStaffOverrides).forEach(id => { if (id) allInvolvedStaffIds.add(id); });
        allInvolvedStaffIds.forEach(id => {
            batch.update(doc(firestore, `tenants/${tenantId}/staff`, id), { status: 'idle', lastServedTimestamp: nowISO });
        });

        // Update discount usage metrics for all applied codes
        for (const code of appliedDiscountCodes) {
            const matchingDiscount = discounts.find(d => d.code === code);
            if (matchingDiscount) {
                const discountRef = doc(firestore, `tenants/${tenantId}/discounts`, matchingDiscount.id);
                batch.update(discountRef, {
                    usageCount: increment(1),
                    usedByClientIds: arrayUnion(finalClient.id)
                });
            }
        }

        await batch.commit();
  
        const allCartItems = [
            ...appointmentsData.flatMap(d => {
                const mainService = d.service ? [{ name: d.service.name, quantity: 1, price: redeemedOffer?.id === d.service.id && (redeemedOffer.type === 'membership' || redeemedOffer.type === 'package') ? 0 : d.service.price }] : [];
                const addOns = d.addOnServices.map(s => ({ name: s.name, quantity: 1, price: s.price, isDiscount: false }));
                return [...mainService, ...addOns];
            }),
            ...retailItems.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
        ];

        const receiptData: ReceiptData = {
            business: { name: selectedTenant.name, phone: selectedTenant.twilioPhoneNumber || '555-123-4567' },
            clientName: finalClient.name,
            date: now, 
            items: allCartItems.map(item => ({...item, isDiscount: false})),
            subtotal, discount: totalDiscount, tax, tip: tipAmount, total,
            payment: {
                method: checkoutDetails.paymentMethod,
                amountTendered: checkoutDetails.paymentMethod === 'cash' ? (checkoutDetails.amountTendered || total) : total,
                changeDue: changeDue > 0 ? changeDue : 0,
            },
            adjustments: checkoutSummary.adjustments?.filter(adj => appliedAdjustments.has(adj.id)),
        };
  
        setReceiptToPrint(receiptData);
        setIsReceiptDialogOpen(true);
        resetCheckoutState();
        setIsCartSheetOpen(false); 
  
      } catch (e) {
          console.error("Checkout failed:", e);
          toast({ variant: 'destructive', title: 'Checkout Failed', description: 'Could not process the transaction.' });
      } finally {
          setIsSubmitting(false);
      }
    };
    
    const payerOptions = useMemo(() => {
        const clientIds = new Set<string>();
        appointmentsData.forEach(apt => {
          if (apt.client) {
            clientIds.add(apt.client.id);
          }
        });
        return (clients || []).filter(c => clientIds.has(c.id));
    }, [appointmentsData, clients]);
    
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
        appliedDiscountCodes,
        setAppliedDiscountCodes,
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
        redeemedOffer,
        setRedeemedOffer,
        memberships: memberships || [],
        packages: packages || [],
        allowStacking: !!selectedTenant?.allowDiscountStacking,
    };
    
    const handleStatusChangeWithConfirmation = () => {};

    const resetCheckoutState = () => {
        setSelectedAppointmentIds(new Set());
        setRetailItems([]);
        setTipAmount(0);
        setAmountTendered(0);
        setDiscount(0);
        setMembershipDiscount(0);
        setAppliedDiscountCodes([]);
        setRedeemedOffer(null);
        setServiceStaffOverrides({});
        setTipAllocations({});
    };

    useEffect(() => {
        let html5QrCode: Html5Qrcode | undefined;
        if (isScannerOpen) {
          const timer = setTimeout(() => {
            const element = document.getElementById('qr-reader-pos');
            if (element) {
                html5QrCode = new Html5Qrcode('qr-reader-pos');
                const onScanSuccess = (decodedText: string) => {
                    if (html5QrCode?.isScanning) {
                        html5QrCode.stop().catch(console.error);
                    }
                    handleScan(decodedText);
                    setIsScannerOpen(false);
                };
                const onScanFailure = () => { /* ignore */ };
                
                html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, onScanFailure)
                  .catch(err => {
                    toast({ variant: 'destructive', title: 'Camera Error', description: 'Could not start camera. Please check permissions.' });
                    setIsScannerOpen(false);
                  });
            }
          }, 300);
          return () => {
              clearTimeout(timer);
              if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().catch(err => console.error("Failed to stop QR scanner.", err));
              }
          };
        }
    }, [isScannerOpen, toast, handleScan]);

    return (
        <>
            <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
                <AppHeader />
                <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                    <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-6 pb-24 lg:pb-8">
                        {/* KPI Cards */}
                        <div className="hidden md:grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                           <KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Today's average wait for walk-ins." />
                           <KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500"/>} iconBgColor="bg-green-100 dark:bg-blue-900/50" description="Walk-ins that resulted in a service." />
                           <KpiCard title="Today's Walk-ins" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500"/>} iconBgColor="bg-purple-100 dark:bg-blue-900/50" description="Total number of walk-in parties." />
                           <KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign className="text-amber-500"/>} iconBgColor="bg-amber-100 dark:bg-blue-900/50" description="Revenue per hour of active service." />
                        </div>

                        <div className="md:hidden">
                            <ScrollArea>
                                <div className="flex space-x-4 pb-4">
                                    <div className="w-60 shrink-0"><KpiCard title="Avg. Wait Time" value={`${kpiData.avgWaitTime.toFixed(0)} min`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100 dark:bg-blue-900/50" description="Today's average wait for walk-ins." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Walk-in Conversion" value={`${kpiData.walkInConversionRate.toFixed(0)}%`} icon={<TrendingUp className="text-green-500"/>} iconBgColor="bg-green-100 dark:bg-blue-900/50" description="Walk-ins that resulted in a service." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Today's Walk-ins" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500"/>} iconBgColor="bg-purple-100 dark:bg-blue-900/50" description="Total number of walk-in parties." /></div>
                                    <div className="w-60 shrink-0"><KpiCard title="Revenue / Hour" value={`$${kpiData.revenuePerServiceHour.toFixed(2)}`} icon={<DollarSign className="text-amber-500"/>} iconBgColor="bg-amber-100 dark:bg-blue-900/50" description="Revenue per hour of active service." /></div>
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
                        <CheckoutQueue appointments={readyForCheckoutAppointments} onSelectAppointment={handleSelectAppointment} selectedAppointmentIds={selectedAppointmentIds} onScanClick={() => setIsScannerOpen(true)} />
                        
                         <Card>
                            <CardHeader>
                                <CardTitle>Currently In Service</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {inServiceQueue.length > 0 ? (
                                    <ScrollArea>
                                        <div className="flex space-x-4 pb-4">
                                            {inServiceQueue.map(appointment => (
                                                <div key={appointment.id} className="w-72 shrink-0">
                                                    <InServiceAppointmentCard appointment={appointment} services={services} staff={staff} onSendToCheckout={() => {}} />
                                                </div>
                                            ))}
                                        </div>
                                        <ScrollBar orientation="horizontal" />
                                    </ScrollArea>
                                ) : <p className="text-center text-muted-foreground p-8">No clients are currently in service.</p>}
                            </CardContent>
                        </Card>

                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="catalog">Retail Catalog</TabsTrigger>
                                <TabsTrigger value="queue">Walk-in Queue<Badge className="ml-2">{orderedWaitingQueue.length + notifiedQueue.length}</Badge></TabsTrigger>
                            </TabsList>
                            <TabsContent value="catalog" className="flex-1 mt-6">
                                <RetailCatalog 
                                    services={services || []} 
                                    inventory={inventory || []} 
                                    memberships={memberships || []}
                                    packages={packages || []}
                                    onAddToCart={handleAddToCart} 
                                />
                            </TabsContent>
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
                             <Button className="w-full h-14 text-lg" size="lg" disabled={retailItems.length === 0 && appointmentsData.length === 0}>
                                <div className="flex justify-between items-center w-full">
                                    <span><ShoppingCart className="inline-block mr-2" />{retailItems.length + appointmentsData.length} item(s)</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="h-[95dvh] p-0 flex flex-col">
                           <SheetHeader className="p-4 border-b">
                               <SheetTitle>Current Sale</SheetTitle>
                           </SheetHeader>
                            <div className="flex-1 overflow-hidden">
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
                        <AlertDialogHeader><DialogTitle>{confirmation.title}</DialogTitle><AlertDialogDescription>{confirmation.description}</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmation.onConfirm}>Confirm</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
            <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
              <DialogContent className="sm:max-w-md p-0 overflow-hidden">
                <DialogHeader className="p-4 pb-0">
                  <DialogTitle>Scan Ticket or SKU</DialogTitle>
                  <DialogDescription>
                    Scanning is automatic. Position the code inside the frame.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="p-4 space-y-4">
                  <div className="relative overflow-hidden rounded-xl border-2 border-muted bg-muted/50 aspect-square">
                    <div id="qr-reader-pos" className="w-full h-full" />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
                    </div>
                  </div>

                  <Separator />

                  <form onSubmit={handleManualTicketSubmit} className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-widest">
                        <Keyboard className="w-4 h-4" />
                        <span>Manual Entry</span>
                    </div>
                    <div className="flex gap-2">
                        <Input 
                            placeholder="Enter Ticket or Product ID..." 
                            value={manualTicketId}
                            onChange={(e) => setManualTicketId(e.target.value)}
                            className="h-11 font-mono uppercase"
                        />
                        <Button type="submit" disabled={!manualTicketId.trim()}>Pull Up</Button>
                    </div>
                  </form>
                </div>

                <DialogFooter className="p-4 pt-0">
                  <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button" className="w-full">Close Scanner</Button>
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
            <SelectProviderDialog
                open={!!serviceToSelectProvider}
                onOpenChange={() => setServiceToSelectProvider(null)}
                service={serviceToSelectProvider}
                staff={staff || []}
                pricingTiers={pricingTiers || []}
                onConfirm={handleAddServiceWithProvider}
            />
            <div className="hidden print:block print-only">
                <div id="printable-ticket-pos">
                    {ticketToPrint && <PrintWalkInTicket key={ticketToPrint.id} data={ticketToPrint} />}
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
