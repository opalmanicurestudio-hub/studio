
'use client';

import { differenceInMonths, endOfDay, format, isPast, parseISO, startOfDay, subDays } from 'date-fns';
import { collection, doc, writeBatch, query, where, orderBy } from 'firebase/firestore';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Activity,
  AlertTriangle,
  BarChart,
  Beaker,
  Box,
  Briefcase,
  Building,
  Calendar as CalendarIcon,
  Check,
  CheckCircle,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Clock,
  DollarSign,
  Edit,
  Eye,
  File,
  FileImage,
  FileText,
  FlaskConical,
  Hammer,
  HardHat,
  Link as LinkIcon,
  ListFilter,
  MapPin,
  MoreHorizontal,
  Package,
  PackageX,
  Pencil,
  Pipette,
  Plus,
  PlusCircle,
  Printer,
  QrCode,
  Recycle,
  RefreshCw,
  Rocket,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Trash2,
  TrendingUp,
  TrendingDown,
  Truck,
  Warehouse,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  XCircle,
  PackageOpen,
  Loader,
  ArrowRight,
  CheckCircle2,
  Info,
  Coffee,
  History
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AddEquipmentDialog } from '@/components/inventory/AddEquipmentDialog';
import { AddLocationDialog } from '@/components/inventory/AddLocationDialog';
import { AddOrderDialog } from '@/components/inventory/AddOrderDialog';
import { AddOverheadDialog } from '@/components/inventory/AddOverheadDialog';
import { AddProductDialog } from '@/components/inventory/AddProductDialog';
import { AddRefreshmentDialog } from '@/components/inventory/AddRefreshmentDialog';
import { EditEquipmentDialog } from '@/components/inventory/EditEquipmentDialog';
import { EditLocationDialog } from '@/components/inventory/EditLocationDialog';
import { EditProductDialog } from '@/components/inventory/EditProductDialog';
import { EndCostPerUseTestDialog } from '@/components/inventory/EndCostPerUseTestDialog';
import { InventorySidebar } from '@/components/inventory/InventorySidebar';
import { Locations } from '@/components/inventory/Locations';
import { LogSaleDialog } from '@/components/inventory/LogSaleDialog';
import { LogUseDialog } from '@/components/inventory/LogUseDialog';
import { ManageSpoilageDialog, type SpoilageItem } from '@/components/inventory/ManageSpoilageDialog';
import { ProductCard } from '@/components/inventory/ProductCard';
import { ReceiveStockDialog, type ReceivedItem } from '@/components/inventory/ReceiveStockDialog';
import { WriteOffDialog } from '@/components/inventory/WriteOffDialog';
import { AppHeader } from '@/components/shared/AppHeader';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { ImageUpload } from '@/components/shared/ImageUpload';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn, safeNumber } from '@/lib/utils';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import {
  addDocumentNonBlocking,
  deleteDocumentNonBlocking,
  setDocumentNonBlocking,
  updateDocumentNonBlocking,
  useCollection,
  useFirebase,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  Batch,
  InventoryItem,
  Location,
  LocationType,
  Order,
  StockCorrection,
  Staff,
  RefreshmentRequest
} from '@/lib/data';
import { Transaction } from '@/lib/financial-data';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

const HospitalityLedger = () => {
    const { refreshmentRequests, isLoading } = useInventory();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    const filteredRequests = useMemo(() => {
        if (!refreshmentRequests) return [];
        return refreshmentRequests.filter(r => {
            const matchesSearch = !searchTerm.trim() || 
                r.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.itemName.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [refreshmentRequests, searchTerm, statusFilter]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-center gap-4">
                <div className="relative flex-1 w-full text-left">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                    <Input 
                        placeholder="SEARCH GUESTS OR ITEMS..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white"
                    />
                </div>
                <div className="w-full md:w-auto">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full md:w-48 bg-white shadow-inner">
                            <SelectValue placeholder="STATUS" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                            <SelectItem value="all" className="font-bold">ALL ENTRIES</SelectItem>
                            <SelectItem value="pending" className="font-bold">PENDING</SelectItem>
                            <SelectItem value="delivered" className="font-bold text-green-600">DELIVERED</SelectItem>
                            <SelectItem value="cancelled" className="font-bold text-destructive">CANCELLED</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardContent className="p-0 overflow-x-auto text-left">
                    {isLoading ? (
                        <div className="p-20 text-center flex flex-col items-center gap-4">
                            <Loader className="w-8 h-8 animate-spin text-primary" />
                            <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Syncing Registry...</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="bg-muted/10 border-b-2">
                                <TableRow>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900">Guest & Item</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Timestamp</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Location</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Status</TableHead>
                                    <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10 text-slate-900">Qty</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredRequests.length > 0 ? filteredRequests.map(req => (
                                    <TableRow key={req.id} className="group hover:bg-primary/[0.02]">
                                        <TableCell className="p-6 text-left">
                                            <div className="space-y-1">
                                                <p className="font-black uppercase tracking-tight text-xs text-slate-900">{req.clientName}</p>
                                                <p className="text-[10px] font-bold text-primary uppercase tracking-widest">{req.itemName}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-[10px] font-black uppercase text-slate-600">
                                            {format(safeDate(req.requestedAt), 'MMM d, h:mm a')}
                                        </TableCell>
                                        <TableCell className="text-[10px] font-black uppercase text-muted-foreground">
                                            {req.stationName || 'Lounge'}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={cn(
                                                "h-5 px-2 font-black text-[8px] uppercase tracking-widest border-2",
                                                req.status === 'delivered' ? "bg-green-50 border-green-100 text-green-700" :
                                                req.status === 'pending' ? "bg-amber-50 border-amber-100 text-amber-700 animate-pulse" :
                                                "bg-destructive/5 border-destructive/10 text-destructive"
                                            )}>
                                                {req.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-10 font-black font-mono text-sm">
                                            {req.quantity || 1}
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="py-20 text-center opacity-30 uppercase font-black tracking-widest text-xs">
                                            No hospitality events found
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

const OrderCard = ({ order, onSelect, onTrack, onReceive }: { order: Order, onSelect: (order: Order) => void, onTrack: (e: React.MouseEvent, url?: string) => void, onReceive: (order: Order) => void }) => {
    const getStatusVariant = (status: Order['status']) => {
        switch (status) {
            case 'Placed': return { icon: <Clock className="h-3 w-3" />, className: 'bg-blue-500/10 text-blue-700 border-blue-200' };
            case 'Shipped': return { icon: <Truck className="h-3 w-3" />, className: 'bg-amber-500/10 text-amber-700 border-amber-200' };
            case 'Received':
            case 'Partially Received':
                return { icon: <CheckCircle className="h-3 w-3" />, className: 'bg-green-500/10 text-green-700 border-green-200' };
            case 'Cancelled':
                return { icon: <XCircle className="h-3 w-3" />, className: 'bg-destructive/10 text-destructive border-destructive/20' };
            default: return { icon: <Package className="h-3 w-3" />, className: 'bg-muted text-muted-foreground' };
        }
    };
    const statusInfo = getStatusVariant(order.status);
    const totalItems = order.items.reduce((acc, item) => acc + item.quantity, 0);
    const totalCost = order.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);

    return (
        <Card onClick={() => onSelect(order)} className="cursor-pointer hover:shadow-2xl transition-all duration-500 rounded-[2rem] border-2 shadow-sm overflow-hidden group bg-white hover:border-primary/20">
            <CardHeader className="p-6 border-b bg-muted/5">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <CardTitle className="text-base font-black uppercase tracking-tight text-slate-900 truncate max-w-[180px]">{order.supplier}</CardTitle>
                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Logistics Date: {format(parseISO(order.orderDate), 'MMM d, yyyy')}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-[8px] font-black uppercase h-6 px-2.5 border-2 shadow-sm", statusInfo.className)}>{statusInfo.icon} <span className="ml-1.5">{order.status}</span></Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/5" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent onClick={(e) => e.stopPropagation()} align="end" className="rounded-2xl border-2 shadow-xl p-1">
                                <DropdownMenuItem onClick={() => onSelect(order)} className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                                    <Eye className="mr-2 h-3.5 w-3.5 opacity-40" /> View Summary
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onReceive(order)} className="font-bold text-[10px] uppercase tracking-widest text-primary py-2.5">
                                    <PackageOpen className="mr-2 h-3.5 w-3.5 opacity-40" /> Receive Stock
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-muted/20 border shadow-inner">
                        <p className="text-[8px] font-black uppercase text-muted-foreground tracking-widest opacity-40 mb-1">Manifest Load</p>
                        <p className="text-xl font-black tracking-tighter text-slate-900">{totalItems} <span className="text-[10px] font-bold opacity-40 uppercase ml-0.5">SKUs</span></p>
                    </div>
                    <div className="p-4 rounded-2xl bg-primary/[0.03] border border-primary/5 shadow-inner text-right">
                        <p className="text-[8px] font-black uppercase text-primary/60 tracking-widest opacity-60 mb-1">Investment</p>
                        <p className="text-xl font-black font-mono tracking-tighter text-primary">${totalCost.toFixed(2)}</p>
                    </div>
                </div>
                {order.expectedArrivalDate && (
                    <div className="pt-4 border-t border-dashed flex items-center justify-between text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <Truck className="w-3.5 h-3.5 opacity-40" />
                            <span className="text-[10px] font-black uppercase tracking-tight">Deployment Window</span>
                        </div>
                        <span className="text-[10px] font-black uppercase text-slate-900">{format(parseISO(order.expectedArrivalDate), 'MMM d, yyyy')}</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

const ViewOrEditOrderDialog = ({ order, open, onOpenChange, onSave, onCancelOrder, onTrack }: { order: Order | null, open: boolean, onOpenChange: (open: boolean) => void, onSave: (order: Order) => void, onCancelOrder: (orderId: string) => void, onTrack: (e: React.MouseEvent, url?: string) => void }) => {
    const [editableOrder, setEditableOrder] = useState<Order | null>(order);
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        setEditableOrder(order);
        if (!open) {
            setIsEditing(false);
        }
    }, [order, open]);

    const handleSave = () => {
        if (editableOrder) {
            onSave(editableOrder);
        }
        setIsEditing(false);
    }
    
    const handleCancel = () => {
        if (editableOrder) {
            onCancelOrder(editableOrder.id);
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setEditableOrder(prev => prev ? ({ ...prev, [name]: value }) : null);
    };

    const handleDateChange = (date: Date | undefined, field: 'orderDate' | 'expectedArrivalDate') => {
        setEditableOrder(prev => prev ? ({...prev, [field]: date?.toISOString()}) : null)
    }
    
    const handleItemChange = (productId: string, field: 'quantity' | 'costPerUnit', value: number) => {
        setEditableOrder(prev => prev ? ({
            ...prev,
            items: prev.items.map(item => item.productId === productId ? { ...item, [field]: value } : item)
        }) : null);
    }

    if (!editableOrder) return null;

    const totalCost = editableOrder.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
                <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <Truck className="w-5 h-5 text-primary" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Logistics Detail</span>
                            </div>
                            <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Order from {editableOrder.supplier}</DialogTitle>
                            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
                                Order ID: {editableOrder.id.slice(-6).toUpperCase()}
                            </DialogDescription>
                        </div>
                        <Badge className="bg-primary text-white border-none font-black text-[9px] uppercase tracking-widest h-6 px-3 shadow-lg shadow-primary/20">{editableOrder.status}</Badge>
                    </div>
                </DialogHeader>
                 <ScrollArea className="max-h-[60vh]">
                    <div className="p-8">
                        <div className="space-y-8">
                            {isEditing ? (
                                <div className="space-y-6 text-left">
                                    <div className="space-y-2"><Label htmlFor="edit-supplier" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Supplier</Label><Input id="edit-supplier" value={editableOrder.supplier} onChange={handleChange} name="supplier" className="h-12 rounded-xl border-2 font-black uppercase tracking-tight" /></div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Financial Context</Label>
                                        <RadioGroup value={editableOrder.paymentContext || 'Business'} onValueChange={(v: any) => setEditableOrder(prev => prev ? ({...prev, paymentContext: v}) : null)} className="grid grid-cols-2 gap-3">
                                            <div><RadioGroupItem value="Business" id="business-order-edit" className="peer sr-only" /><Label htmlFor="business-order-edit" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-xs font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer">Business</Label></div>
                                            <div><RadioGroupItem value="Personal" id="personal-order-edit" className="peer sr-only" /><Label htmlFor="personal-order-edit" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-3 text-xs font-black uppercase tracking-widest hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer">Personal</Label></div>
                                        </RadioGroup>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <div className="space-y-2"><Label htmlFor="paymentMethod-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Ledger Account</Label><Select value={editableOrder.paymentMethod || ''} onValueChange={(v) => setEditableOrder(prev => prev ? ({...prev, paymentMethod: v}) : null)}><SelectTrigger id="paymentMethod-edit" className="h-12 rounded-xl border-2 font-bold"><SelectValue placeholder="Select account" /></SelectTrigger><SelectContent className="rounded-xl border-2 shadow-2xl"><SelectItem value="Checking" className="font-bold">Checking</SelectItem><SelectItem value="Credit Card" className="font-bold">Credit Card</SelectItem><SelectItem value="Cash" className="font-bold">Cash</SelectItem><SelectItem value="Other" className="font-bold">Other</SelectItem></SelectContent></Select></div>
                                        <div className="space-y-2"><Label htmlFor="paymentMethodIdentifier-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Account ID</Label><Input id="paymentMethodIdentifier-edit" placeholder="e.g., Chase ****1234" value={editableOrder.paymentMethodIdentifier || ''} onChange={e => setEditableOrder(prev => prev ? ({...prev, paymentMethodIdentifier: e.target.value}) : null)} className="h-12 rounded-xl border-2 font-bold" /></div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Order Date</Label>
                                            <Input
                                                type="date"
                                                value={editableOrder.orderDate ? format(parseISO(editableOrder.orderDate), 'yyyy-MM-dd') : ''}
                                                onChange={(e) => handleDateChange(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined, 'orderDate')}
                                                className="h-12 rounded-xl border-2 font-bold"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Expected Arrival</Label>
                                            <Input
                                                type="date"
                                                value={editableOrder.expectedArrivalDate ? format(parseISO(editableOrder.expectedArrivalDate), 'yyyy-MM-dd') : ''}
                                                onChange={(e) => handleDateChange(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined, 'expectedArrivalDate')}
                                                className="h-12 rounded-xl border-2 font-bold"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2"><Label htmlFor="edit-trackingNumber" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Tracking Number</Label><Input id="edit-trackingNumber" value={editableOrder.trackingNumber || ''} onChange={handleChange} name="trackingNumber" className="h-12 rounded-xl border-2 font-bold" /></div>
                                    <div className="space-y-2"><Label htmlFor="edit-trackingUrl" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Carrier Link</Label><Input id="edit-trackingUrl" value={editableOrder.trackingUrl || ''} onChange={handleChange} name="trackingUrl" placeholder="https://..." className="h-12 rounded-xl border-2 font-bold text-xs" /></div>
                                    <div className="space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Itemized SKUs</Label>
                                        <div className="space-y-2">
                                            {editableOrder.items.map(item => (
                                                <div key={item.productId} className="flex items-center gap-3 p-3 rounded-xl border-2 bg-muted/10">
                                                    <span className="flex-1 text-[11px] font-black uppercase tracking-tight text-slate-900 truncate">{item.productName}</span>
                                                    <div className="flex items-center gap-2">
                                                        <Input type="number" value={item.quantity} onChange={e => handleItemChange(item.productId, 'quantity', Number(e.target.value))} className="w-16 h-9 rounded-lg border-2 text-center font-black" />
                                                        <div className="relative w-24">
                                                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                                                            <Input type="number" value={item.costPerUnit} onChange={e => handleItemChange(item.productId, 'costPerUnit', Number(e.target.value))} className="w-24 h-9 pl-6 rounded-lg border-2 font-mono text-center" />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Logistics Proof</Label>
                                        <ImageUpload
                                            onImageUploaded={(url) => setEditableOrder(prev => prev ? ({...prev, invoiceUrl: url}) : null)}
                                            initialImage={editableOrder.invoiceUrl}
                                        />
                                    </div>
                                    <div className="space-y-2"><Label htmlFor="edit-notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Internal Log</Label><Textarea id="edit-notes" value={editableOrder.notes || ''} onChange={handleChange} name="notes" className="rounded-xl border-2 bg-muted/5 focus-visible:ring-primary/20" /></div>
                                </div>
                            ) : (
                                 <div className="space-y-8 text-left">
                                    <div className="space-y-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Itemized Manifest</p>
                                        <div className="space-y-2 p-4 rounded-[2rem] border-2 bg-muted/10 shadow-inner">
                                            {editableOrder.items.map(item => (
                                                <div key={item.productId} className="flex justify-between items-center p-3 hover:bg-white hover:shadow-sm rounded-xl transition-all border-2 border-transparent">
                                                    <div className="min-w-0 flex-1 text-left">
                                                        <p className="font-black text-xs uppercase tracking-tight text-slate-900 truncate">{item.productName}</p>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{item.quantity} units @ ${item.costPerUnit.toFixed(2)}/unit</p>
                                                    </div>
                                                    <p className="font-black font-mono text-sm tracking-tighter text-slate-900 shrink-0 ml-4">${(item.quantity * item.costPerUnit).toFixed(2)}</p>
                                                </div>
                                            ))}
                                            <div className="flex justify-between items-center px-3 pt-4 mt-2 border-t border-dashed border-primary/20">
                                                <span className="text-[10px] font-black uppercase text-primary tracking-widest">Investment Total</span>
                                                <span className="font-black text-2xl font-mono tracking-tighter text-primary">${totalCost.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">Fulfillment Tracker</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-10 rounded-xl border-2 w-full justify-start font-bold uppercase text-[10px] tracking-widest bg-white shadow-sm"
                                                onClick={(e) => onTrack(e, editableOrder.trackingUrl)}
                                            >
                                                <Truck className="w-4 h-4 text-primary mr-2"/>
                                                Track Shipment
                                            </Button>
                                        </div>
                                        {editableOrder.expectedArrivalDate && (
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60 text-left">Estimated Arrival</p>
                                                <p className="text-sm font-black uppercase tracking-tight text-slate-900 pt-2 text-left">{format(parseISO(editableOrder.expectedArrivalDate), 'MMMM d, yyyy')}</p>
                                            </div>
                                        )}
                                    </div>
                                    {editableOrder.invoiceUrl && (
                                        <div className="space-y-2">
                                            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60 text-left">Attached Proof</p>
                                            <a href={editableOrder.invoiceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 p-4 rounded-2xl border-2 border-primary/10 bg-primary/[0.02] w-full group hover:bg-primary/5 transition-all">
                                                <div className="p-2 bg-white rounded-xl shadow-sm border border-primary/10"><FileImage className="w-5 h-5 text-primary" /></div>
                                                <span className="font-black text-xs uppercase tracking-tight text-primary underline">View Digital Manifest</span>
                                            </a>
                                        </div>
                                    )}
                                    {editableOrder.notes && (
                                        <div className="space-y-2">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Audit Notes</p>
                                            <div className="p-4 rounded-2xl bg-muted/20 border-2 italic text-slate-600 text-sm font-medium leading-relaxed">
                                                "{editableOrder.notes}"
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </ScrollArea>
                <DialogFooter className="p-8 pt-4 border-t bg-muted/5">
                    {isEditing ? (
                        <div className="grid grid-cols-2 gap-3 w-full">
                            <Button variant="ghost" onClick={() => setIsEditing(false)} className="h-12 font-black uppercase tracking-tighter text-[10px] tracking-widest text-slate-400">Cancel</Button>
                            <Button onClick={handleSave} className="h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Commit Changes</Button>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row gap-3 w-full">
                            <Button variant="outline" onClick={handleCancel} disabled={editableOrder.status === 'Cancelled'} className="h-12 sm:h-14 flex-1 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest text-destructive hover:bg-destructive/5 border-destructive/20">Cancel Order</Button>
                            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-12 sm:h-14 flex-1 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white">Close Summary</Button>
                            <Button onClick={() => setIsEditing(true)} className="h-12 sm:h-14 flex-[1.5] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-primary/30">Modify Manifest</Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

const EmptyOrdersState = ({ onAddFirstOrder }: { onAddFirstOrder: () => void }) => (
    <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
        <div className='w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner'>
            <Truck className='w-12 h-12 text-muted-foreground' />
        </div>
        <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Procurement Clear</h3>
            <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground max-sm mx-auto">
                No supply orders in the ledger. Track supplier shipments and landed costs to protect your margins.
            </p>
        </div>
        <Button size="lg" onClick={onAddFirstOrder} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">
            <PlusCircle className="mr-2 h-5 w-5" />
            Initiate First Order
        </Button>
    </div>
);

const OrdersTab = ({ inventory }: { inventory: InventoryItem[] }) => {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const { toast } = useToast();
    
    const ordersQuery = useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/orders`) : null, [firestore, tenantId]);
    const { data: orders, isLoading: ordersLoading } = useCollection<Order>(ordersQuery);

    const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [orderToReceive, setOrderToReceive] = useState<Order | null>(null);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    const handleAddOrder = (newOrderData: Omit<Order, 'id'>) => {
        if (!firestore || !tenantId) return;

        const finalItems: { productId: string; productName: string; quantity: number; costPerUnit: number; }[] = [];
        
        newOrderData.items.forEach(item => {
            if (item.productId.startsWith('custom-')) {
                const newProductId = nanoid();
                const newProductShell: InventoryItem = {
                    id: newProductId,
                    name: item.productName,
                    type: 'professional',
                    category: 'Uncategorized',
                    totalStock: 0,
                    supplier: newOrderData.supplier,
                    costPerUnit: item.costPerUnit,
                    batches: [],
                };
                const productDocRef = doc(firestore, `tenants/${tenantId}/inventory`, newProductId);
                setDocumentNonBlocking(productDocRef, newProductShell, {});
                finalItems.push({ ...item, productId: newProductId });
            } else {
                finalItems.push(item);
            }
        });

        const newOrder: Order = {
            ...newOrderData,
            id: nanoid(),
            items: finalItems,
            status: 'Placed',
        };
        const orderRef = collection(firestore, 'tenants', tenantId, 'orders');
        addDocumentNonBlocking(orderRef, newOrder);
        
        const totalCost = newOrder.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
        if (totalCost > 0) {
            const newTransaction: Omit<Transaction, 'id' | 'date'> = {
                description: `Purchase Order: ${newOrder.supplier}`,
                clientOrVendor: newOrder.supplier,
                type: 'expense',
                context: newOrder.paymentContext || 'Business',
                category: 'Supplies',
                amount: totalCost,
                paymentMethod: newOrder.paymentMethod || 'On Account',
                paymentMethodIdentifier: newOrder.paymentMethodIdentifier,
                hasReceipt: !!newOrder.invoiceUrl,
                receiptUrl: newOrder.invoiceUrl,
                relatedOrderId: newOrder.id,
            };
            const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
            addDocumentNonBlocking(transactionsRef, { ...newTransaction, date: newOrder.orderDate });
        }

        toast({
            title: "Order Created!",
            description: `Your order to ${newOrder.supplier} has been saved as '${newOrder.status}'.`
        });
    };

    const handleUpdateOrder = (updatedOrder: Order) => {
        if (!firestore || !tenantId) return;
        const orderRef = doc(firestore, `tenants/${tenantId}/orders`, updatedOrder.id);
        updateDocumentNonBlocking(orderRef, updatedOrder);
        toast({
            title: "Order Updated",
            description: `Order ${updatedOrder.id.slice(-6)} has been updated.`
        })
    }

    const handleCancelOrderClick = (orderId: string) => {
        const order = orders?.find(o => o.id === orderId);
        if (order) {
            setSelectedOrder(null);
            setOrderToCancel(order);
        }
    };

    const handleConfirmCancelOrder = () => {
        if (!firestore || !orderToCancel || !tenantId) return;

        const orderRef = doc(firestore, `tenants/${tenantId}/orders`, orderToCancel.id);
        const existingNotes = orderToCancel.notes || '';
        const newNotes = `Cancelled on ${new Date().toLocaleDateString()}${cancelReason ? `: ${cancelReason}` : ''}\n---\n${existingNotes}`;
        
        updateDocumentNonBlocking(orderRef, { status: 'Cancelled', notes: newNotes });

        const totalCost = orderToCancel.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);
        if (totalCost > 0) {
            const newTransaction: Omit<Transaction, 'id' | 'date'> = {
                description: `Reversal for Order: ${orderToCancel.supplier}`,
                clientOrVendor: orderToCancel.supplier,
                type: 'reversal',
                context: orderToCancel.paymentContext || 'Business',
                category: 'Supplies',
                amount: totalCost,
                paymentMethod: 'On Account',
                paymentMethodIdentifier: orderToCancel.paymentMethodIdentifier,
                hasReceipt: !!orderToCancel.invoiceUrl,
                receiptUrl: orderToCancel.invoiceUrl,
                relatedOrderId: orderToCancel.id,
            };
            const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
            addDocumentNonBlocking(transactionsRef, { ...newTransaction, date: new Date().toISOString() });
        }

        toast({
            title: "Order Cancelled",
            description: `Order ${orderToCancel.id.slice(-6)} has been cancelled and the expense reversed.`
        });
        
        setOrderToCancel(null);
        setCancelReason('');
    };
    
    const filteredOrders = useMemo(() => {
        if (!orders) return [];
        return orders.filter(order => {
            const searchTermLower = searchTerm.toLowerCase();
            const searchTermMatch = searchTerm === '' ||
                order.supplier.toLowerCase().includes(searchTermLower) ||
                order.id.toLowerCase().includes(searchTermLower) ||
                order.items.some(item => item.productName.toLowerCase().includes(searchTermLower));

            const statusMatch = statusFilter === 'all' || order.status === statusFilter;

            return searchTermMatch && statusMatch;
        }).sort((a,b) => parseISO(b.orderDate).getTime() - parseISO(a.orderDate).getTime());
    }, [orders, searchTerm, statusFilter]);
    
    const openTrackingUrl = (e: React.MouseEvent, url?: string) => {
        e.stopPropagation();
        if (!url) return;
        let finalUrl = url;
        if (!/^https?:\/\//i.test(url)) {
            finalUrl = 'https://' + url;
        }
        window.open(finalUrl, '_blank', 'noopener,noreferrer');
    };

    const handleReceiveStock = (receivedItems: ReceivedItem[]) => {
      if (!firestore || !orderToReceive || !tenantId) return;

      const batch = writeBatch(firestore);

      receivedItems.forEach(item => {
        const existingProduct = inventory.find(p => p.id === item.productId);
        if (existingProduct) {
          const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.productId);
          
          if (item.quantityReceived > 0) {
              const newBatchData: any = {
                id: `batch-${nanoid()}`,
                stock: item.quantityReceived,
                costPerUnit: item.costPerUnit,
                receivedDate: new Date().toISOString(),
              };
              if (item.expirationDate) {
                newBatchData.expirationDate = item.expirationDate.toISOString();
              }
              
              const updatedBatches = [...existingProduct.batches, newBatchData];
              const totalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);

              batch.update(productRef, JSON.parse(JSON.stringify({
                batches: updatedBatches,
                totalStock: totalStock,
                costPerUnit: item.costPerUnit,
              })));

              const stockCorrection: any = {
                productId: item.productId,
                date: new Date().toISOString(),
                change: item.quantityReceived,
                unit: existingProduct.unit || 'units',
                reason: `Shipment from ${orderToReceive.supplier}`,
              };
              const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
              batch.set(scRef, stockCorrection);
          }

          if (item.quantityDamaged > 0) {
              const damageCost = item.quantityDamaged * item.costPerUnit;
              const damageTransaction: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Damaged on arrival: ${item.quantityDamaged} x ${item.productName}`,
                clientOrVendor: orderToReceive.supplier,
                type: 'expense',
                context: 'Business',
                category: 'Spoilage',
                amount: damageCost,
                paymentMethod: 'Internal',
                hasReceipt: !!orderToReceive.invoiceUrl,
                receiptUrl: orderToReceive.invoiceUrl,
                relatedOrderId: orderToReceive.id,
              };
              const dtRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
              batch.set(dtRef, damageTransaction);
          }
        }
      });
      
      const allItemsFullyOrPartiallyReceived = receivedItems.every(item => item.quantityReceived + item.quantityDamaged >= item.quantityOrdered);
      const someItemsReceived = receivedItems.some(item => item.quantityReceived > 0 || item.quantityDamaged > 0);

      let newStatus: Order['status'] = orderToReceive.status;
      if (allItemsFullyOrPartiallyReceived) {
        newStatus = 'Received';
      } else if (someItemsReceived) {
        newStatus = 'Partially Received';
      }
      
      if (newStatus !== orderToReceive.status) {
        const orderRef = doc(firestore, `tenants/${tenantId}/orders`, orderToReceive.id);
        batch.update(orderRef, { status: newStatus });
      }

      batch.commit().then(() => {
          toast({
              title: "Stock Updated!",
              description: "Inventory has been updated with the received items.",
          });
          setOrderToReceive(null);
      }).catch(error => {
          console.error("Error receiving stock: ", error);
          toast({
              variant: "destructive",
              title: "Error",
              description: "Failed to update stock.",
          });
      });
    };
    
    return (
        <div className="space-y-8 text-left">
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter text-left">Purchase Orders</CardTitle>
                        <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60 text-left">Procurement & landed cost ledger.</CardDescription>
                    </div>
                    <Button onClick={() => setIsAddOrderOpen(true)} className="h-12 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full sm:w-auto">
                        <PlusCircle className="mr-2 h-4 w-4"/> Initiate Order
                    </Button>
                </div>
                
                <div className="p-4 md:p-6 bg-primary/[0.03] rounded-3xl border-2 border-dashed border-primary/20 flex flex-col md:flex-row items-center gap-4">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                        <input
                            placeholder="SEARCH BY SUPPLIER OR SKU..."
                            className="pl-12 h-14 w-full rounded-2xl border-2 border-border bg-white font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="w-full md:w-auto">
                        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
                            <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full md:w-48 bg-white shadow-inner">
                                <SelectValue placeholder="STATUS" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-2 shadow-2xl">
                                <SelectItem value="all" className="font-bold">ALL STATUSES</SelectItem>
                                <SelectItem value="Draft" className="font-bold">DRAFT</SelectItem>
                                <SelectItem value="Placed" className="font-bold">PLACED</SelectItem>
                                <SelectItem value="Shipped" className="font-bold">SHIPPED</SelectItem>
                                <SelectItem value="Partially Received" className="font-bold text-amber-600">PARTIAL</SelectItem>
                                <SelectItem value="Received" className="font-bold text-green-600">RECEIVED</SelectItem>
                                <SelectItem value="Cancelled" className="font-bold text-destructive">CANCELLED</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {ordersLoading ? (
                <div className="flex flex-col items-center justify-center p-24 gap-4">
                    <Loader className="animate-spin h-8 w-8 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Ledger...</p>
                </div>
            ) : orders && orders.length > 0 ? (
                filteredOrders.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-500">
                        {filteredOrders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} onTrack={openTrackingUrl} onReceive={setOrderToReceive} />)}
                    </div>
                ) : (
                    <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                        <Filter className="w-16 h-16" />
                        <p className="font-black uppercase tracking-widest text-sm">No Matches Found</p>
                    </div>
                )
            ) : (
                <EmptyOrdersState onAddFirstOrder={() => setIsAddOrderOpen(true)} />
            )}

            <AddOrderDialog
                open={isAddOrderOpen}
                onOpenChange={setIsAddOrderOpen}
                onSave={handleAddOrder}
            />
            <ViewOrEditOrderDialog
                order={selectedOrder}
                open={!!selectedOrder}
                onOpenChange={(isOpen) => !isOpen && setSelectedOrder(null)}
                onSave={handleUpdateOrder}
                onCancelOrder={handleCancelOrderClick}
                onTrack={openTrackingUrl}
            />
             <ReceiveStockDialog
                open={!!orderToReceive}
                onOpenChange={() => setOrderToReceive(null)}
                order={orderToReceive}
                onConfirm={handleReceiveStock}
            />
            <AlertDialog open={!!orderToCancel} onOpenChange={() => setOrderToCancel(null)}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                    <AlertDialogHeader className="p-6 pb-0">
                        <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Terminate Order</AlertDialogTitle>
                        <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase">
                            This will void Order <strong>#{orderToCancel?.id.slice(-6).toUpperCase()}</strong> and create a reversal entry in your financial ledger. <strong>This action is non-reversible.</strong>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="p-6 space-y-3 text-left">
                        <Label htmlFor="cancel-reason" className="text-[10px] font-black uppercase tracking-widest ml-1 opacity-60">Audit Note</Label>
                        <Textarea
                            id="cancel-reason"
                            placeholder="Reason for protocol termination..."
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20"
                        />
                    </div>
                    <AlertDialogFooter className="p-6 pt-0 flex flex-col gap-3">
                        <Button onClick={handleConfirmCancelOrder} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm Termination</Button>
                        <AlertDialogCancel onClick={() => setOrderToCancel(null)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

const EmptyState = ({ onAddFirstItem }: { onAddFirstItem: () => void }) => (
    <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
        <div className='w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner'>
            <Package className='w-12 h-12 text-muted-foreground' />
        </div>
        <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Inventory is Empty</h3>
            <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground max-w-sm mx-auto">
                Start building your asset manifest to unlock automated costing and yield tracking.
            </p>
        </div>
        <Button size="lg" onClick={onAddFirstItem} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">
            <PlusCircle className="mr-2 h-5 w-5" />
            Add First Asset
        </Button>
    </div>
);

export default function InventoryPage() {
  const { 
    inventory, 
    stockCorrections,
    locations, 
    locationTypes,
    transactions,
    refreshmentRequests,
    isLoading: isInventoryLoading
  } = useInventory();
  
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  
  const [activeView, setActiveView] = useState('products');
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  
  const [isAddProductDialogOpen, setIsAddProductDialogOpen] = useState(false);
  const [addProductDialogType, setAddProductDialogType] = useState<'professional' | 'retail'>('professional');
  const [isAddEquipmentDialogOpen, setIsAddEquipmentDialogOpen] = useState(false);
  const [isAddOverheadDialogOpen, setIsAddOverheadDialogOpen] = useState(false);
  const [isAddRefreshmentDialogOpen, setIsAddRefreshmentDialogOpen] = useState(false);
  const [isAddLocationDialogOpen, setIsAddLocationDialogOpen] = useState(false);
  const [isEditLocationDialogOpen, setIsEditLocationDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const [isLogUseOpen, setIsLogUseOpen] = useState(false);
  const [isLogSaleOpen, setIsLogSaleOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [isEndExperimentOpen, setIsEndExperimentOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);
  const [logUseDialogType, setLogUseDialogType] = useState<'product' | 'overhead'>('product');

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  const [selectedItems, setSelectedItems] = useState(new Set<string>());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 8;
  
  const [productCategories, setProductCategories] = useState<string[]>([]);

    useEffect(() => {
        if (inventory) {
            const allCategories = inventory.map(p => p.category).filter((c): c is string => !!c);
            setProductCategories([...new Set(allCategories)]);
        }
    }, [inventory]);

    const onNewCategory = useCallback((newCategory: string) => {
        if (!productCategories.includes(newCategory)) {
            setProductCategories(prev => [...prev, newCategory].sort());
        }
    }, [productCategories]);
  
  const ordersQuery = useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/orders`) : null, [firestore, tenantId]);
  const { data: orders, isLoading: ordersLoading } = useCollection<Order>(ordersQuery);

  const orderedProductIds = useMemo(() => {
    if (!orders) return new Set();
    const activeOrders = orders.filter(
      (order) => order.status === 'Placed' || order.status === 'Shipped'
    );
    const productIds = new Set<string>();
    activeOrders.forEach((order) => {
      order.items.forEach((item) => {
        productIds.add(item.productId);
      });
    });
    return productIds;
  }, [orders]);

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setIsEditDialogOpen(true);
  };

  const handleUpdateItem = (updatedItem: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const itemDocRef = doc(firestore, `tenants/${tenantId}/inventory`, updatedItem.id);
    updateDocumentNonBlocking(itemDocRef, updatedItem);
    toast({
        title: "Item Updated",
        description: `${updatedItem.name} has been successfully updated.`,
    });
    setIsEditDialogOpen(false);
  };

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItems(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(itemId)) {
            newSelection.delete(itemId);
        } else {
            newSelection.add(itemId);
        }
        return newSelection;
    });
  }, []);

  const handleBulkDeleteClick = () => {
    setIsBulkDeleteConfirmOpen(true);
  };
  
  const handleBulkDeleteConfirm = useCallback(() => {
    if (!firestore || !tenantId) return;
    const itemCount = selectedItems.size;
    const batch = writeBatch(firestore);
    selectedItems.forEach(id => {
      const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
      batch.delete(itemDoc);
    });
    batch.commit();
    setSelectedItems(new Set());
    setIsBulkDeleteConfirmOpen(false);
    toast({
        title: "Items Deleted",
        description: `${itemCount} item(s) have been removed from your inventory.`,
    })
  }, [selectedItems, toast, firestore, tenantId]);
  
    const handleBulkArchive = useCallback(() => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        selectedItems.forEach(id => {
            const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
            batch.update(itemDoc, { status: 'archived' });
        });
        batch.commit();
        toast({ title: `${selectedItems.size} item(s) have been archived.` });
        setSelectedItems(new Set());
    }, [selectedItems, firestore, tenantId, toast]);

    const handleBulkUnarchive = useCallback(() => {
        if (!firestore || !tenantId) return;
        const batch = writeBatch(firestore);
        selectedItems.forEach(id => {
            const itemDoc = doc(firestore, `tenants/${tenantId}/inventory`, id);
            batch.update(itemDoc, { status: 'active' });
        });
        batch.commit();
        toast({ title: `${selectedItems.size} item(s) have been restored.` });
        setSelectedItems(new Set());
    }, [selectedItems, firestore, tenantId, toast]);


  const handleOpenAddProductDialog = (type: 'professional' | 'retail') => {
    setAddProductDialogType(type);
    setIsAddProductDialogOpen(true);
  };
  
  const handleProductAdded = (newProduct: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const newProductRef = doc(firestore, 'tenants', tenantId, 'inventory', newProduct.id);
    const sanitizedData = JSON.parse(JSON.stringify(newProduct));
    setDocumentNonBlocking(newProductRef, sanitizedData, {});
    toast({
      title: `New ${newProduct.type} product created`,
      description: `${newProduct.name} has been added to your inventory.`
    });
  };

  const handleEquipmentAdded = (newEquipment: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const newEquipmentRef = doc(firestore, 'tenants', tenantId, 'inventory', newEquipment.id);
    const sanitizedData = JSON.parse(JSON.stringify(newEquipment));
    setDocumentNonBlocking(newEquipmentRef, sanitizedData, {});
  };
  
  const handleOverheadAdded = (newOverhead: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const newOverheadRef = doc(firestore, 'tenants', tenantId, 'inventory', newOverhead.id);
    const sanitizedData = JSON.parse(JSON.stringify(newOverhead));
    setDocumentNonBlocking(newOverheadRef, sanitizedData, {});
  };

  const handleRefreshmentAdded = (newItem: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', newItem.id);
    const sanitizedData = JSON.parse(JSON.stringify(newItem));
    setDocumentNonBlocking(itemRef, sanitizedData, {});
    toast({
        title: "Amenity Registered",
        description: `${newItem.name} is now available in your hospitality manifest.`
    });
  };
  
  const handleOpenAddLocation = () => setIsAddLocationDialogOpen(true);
  
  const handleOpenEditLocation = (location: Location) => {
    setSelectedLocation(location);
    setIsEditLocationDialogOpen(true);
  };
  
  const handleSaveLocation = (newLocation: Omit<Location, 'id'>) => {
    if (!firestore || !tenantId) return {} as Location;
    const newLocWithId = { ...newLocation, id: `loc-${nanoid()}`};
    const locationRef = doc(firestore, 'tenants', tenantId, 'locations', newLocWithId.id);
    const sanitizedData = JSON.parse(JSON.stringify(newLocWithId));
    setDocumentNonBlocking(locationRef, sanitizedData, {});
    return newLocWithId;
  };

  const handleUpdateLocation = (updatedLocation: Location) => {
    if (!firestore || !tenantId) return;
    const locationRef = doc(firestore, 'tenants', tenantId, 'locations', updatedLocation.id);
    const sanitizedData = JSON.parse(JSON.stringify(updatedLocation));
    updateDocumentNonBlocking(locationRef, sanitizedData);
  };

  const handleAddNewLocationType = (name: string, icon: string): LocationType => {
    if (!firestore || !tenantId) return { id: '', name: '', icon: '' };
    const newType = { id: `lt-${nanoid()}`, name, icon };
    const locTypeRef = doc(firestore, 'tenants', tenantId, 'locationTypes', newType.id);
    const sanitizedData = JSON.parse(JSON.stringify(newType));
    setDocumentNonBlocking(locTypeRef, sanitizedData, {});
    return newType;
  };


  const handleOpenLogUse = (item: InventoryItem) => {
    setLogUseDialogType('product');
    setSelectedProduct(item);
    setIsLogUseOpen(true);
  }

  const handleOpenLogSale = (item: InventoryItem) => {
    setSelectedProduct(item);
    setIsLogSaleOpen(true);
  };
  
  const handleOpenWriteOff = (item: InventoryItem) => {
    setSelectedProduct(item);
    setIsWriteOffOpen(true);
  };

  const handleWriteOffConfirm = useCallback((productId: string, batchId: string, quantity: number, reason: string, notes?: string, imageUrl?: string): { success: boolean, message: string } => {
    if (!firestore || !tenantId || !inventory) return { success: false, message: 'Firestore not available' };

    const product = inventory.find(p => p.id === productId);
    if (!product) return { success: false, message: 'Product not found.' };

    const batchToIndex = product.batches.findIndex(b => b.id === batchId);
    if (batchToIndex === -1) return { success: false, message: 'Batch not found.' };

    const batchToUpdate = product.batches[batchToIndex];
    if (batchToUpdate.stock < quantity) {
      return { success: false, message: `Cannot write off more than available stock (${batchToUpdate.stock}).` };
    }

    const lossAmount = quantity * batchToUpdate.costPerUnit;

    const productRef = doc(firestore, `tenants/${tenantId}/inventory`, productId);
    const updatedBatches = [...product.batches];
    updatedBatches[batchToIndex] = { ...batchToUpdate, stock: batchToUpdate.stock - quantity };
    const newTotalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);
    
    const updatedData: Partial<InventoryItem> = {
      batches: updatedBatches,
      totalStock: newTotalStock
    };

    if (newTotalStock === 0) {
        updatedData.partialContainerUses = 0;
        updatedData.partialContainerSize = 0;
    }

    updateDocumentNonBlocking(productRef, updatedData);
    
    const stockCorrection: Omit<StockCorrection, 'id'> = {
      productId: productId,
      date: new Date().toISOString(),
      change: -quantity,
      unit: product.unit || 'units',
      reason: `Write-off: ${reason}`,
    };
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/stockCorrections`), stockCorrection);

    const transaction: Omit<Transaction, 'id' | 'date'> = {
      description: `Write-off: ${quantity} x ${product.name}`,
      clientOrVendor: 'Internal',
      type: 'expense',
      context: 'Business',
      category: 'Spoilage',
      amount: lossAmount,
      paymentMethod: 'Internal',
      hasReceipt: !!imageUrl,
      receiptUrl: imageUrl,
      notes: notes,
    };
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/transactions`), { ...transaction, date: new Date().toISOString() });

    toast({
        title: "Item Written Off",
        description: `${quantity} unit(s) of ${product.name} have been written off with a total loss of $${lossAmount.toFixed(2)}.`,
    });

    return { success: true, message: "Write-off successful." };
  }, [inventory, firestore, tenantId, toast]);
  
  const handleLogUseConfirm = (productId: string, quantity: number, notes: string): { success: boolean, message: string } => {
    if (!firestore || !tenantId || !inventory) return { success: false, message: 'Firestore not available' };
    
    const product = inventory.find((p: InventoryItem) => p.id === productId);
    if (!product) return { success: false, message: 'Product not found' };

    const productDocRef = doc(firestore, 'tenants', tenantId, 'inventory', productId);
    const stockCorrectionsRef = collection(firestore, 'tenants', tenantId, 'stockCorrections');
    
    const updateData: Partial<InventoryItem> = {};
    let unit = 'units';
    
    if (product.costingMethod === 'uses') {
        unit = product.useUnit || 'uses';
        let currentUses = safeNumber(product.partialContainerUses);
        let currentStock = safeNumber(product.totalStock);
        const usesPerContainer = safeNumber(product.estimatedUses) || 1;
        
        currentUses -= quantity;
        while (currentUses <= 0 && currentStock > 0) {
            currentStock -= 1;
            currentUses += usesPerContainer;
        }
        
        if (currentStock < 0) {
            return { success: false, message: `Insufficient stock for ${product.name}.`};
        }

        updateData.totalStock = currentStock;
        updateData.partialContainerUses = currentUses;
    } else if (product.costingMethod === 'size' && product.size) {
        unit = product.unit || 'ml';
        let currentSize = safeNumber(product.partialContainerSize);
        let currentStock = safeNumber(product.totalStock);
        const sizePerContainer = safeNumber(product.size);

        currentSize -= quantity;
        while (currentSize <= 0 && currentStock > 0) {
            currentStock -= 1;
            currentSize += sizePerContainer;
        }
        
        if (currentStock < 0) {
            return { success: false, message: `Insufficient stock for ${product.name}.`};
        }

        updateData.totalStock = currentStock;
        updateData.partialContainerSize = currentSize;
    } else { // 'unit' costing method, or undefined
        updateData.totalStock = (product.totalStock || 0) - quantity;
        unit = product.unit || 'units';
    }

    if ((updateData.totalStock !== undefined && updateData.totalStock < 0)) {
        return { success: false, message: `Insufficient stock for ${product.name}.`};
    }
    
    updateDocumentNonBlocking(productDocRef, updateData);

    const newCorrection: Omit<StockCorrection, 'id'> = {
        productId: productId,
        date: new Date().toISOString(),
        change: -quantity,
        unit: unit,
        reason: notes || `Manual Use Log`,
    };
    addDocumentNonBlocking(stockCorrectionsRef, newCorrection);
    
    return { success: true, message: `${quantity} ${unit} of ${product.name} logged.` };
  };

  const handleLogSaleConfirm = (productId: string, quantity: number, paymentMethod: string): { success: boolean; message: string; } => {
    if (!firestore || !tenantId || !inventory) return { success: false, message: 'Firestore not available' };

    const product = inventory.find(p => p.id === productId);
    if (!product) return { success: false, message: 'Product not found.' };

    if (product.totalStock < quantity) {
      return { success: false, message: `Not enough stock. Only ${product.totalStock} available.` };
    }

    const productRef = doc(firestore, `tenants/${tenantId}/inventory`, productId);
    
    const sortedBatches = [...product.batches].sort((a,b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
    let remainingToDeduct = quantity;
    
    for (const batch of sortedBatches) {
        if (remainingToDeduct <= 0) break;
        const deductFromBatch = Math.min(batch.stock, remainingToDeduct);
        batch.stock -= deductFromBatch;
        remainingToDeduct -= deductFromBatch;
    }
    
    const newTotalStock = sortedBatches.reduce((acc, b) => acc + b.stock, 0);

    updateDocumentNonBlocking(productRef, { 
      totalStock: newTotalStock,
      batches: sortedBatches,
    });
    
    const stockCorrection: Omit<StockCorrection, 'id'> = {
      productId: productId,
      date: new Date().toISOString(),
      change: -quantity,
      unit: 'units',
      reason: `Manual Retail Sale`,
    };
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/stockCorrections`), stockCorrection);

    const saleAmount = (product.msrp || product.costPerUnit || 0) * quantity;
    const transaction: Omit<Transaction, 'id' | 'date'> = {
      description: `Retail Sale: ${quantity} x ${product.name}`,
      clientOrVendor: 'In-Store Customer',
      type: 'income',
      context: 'Business',
      category: 'Retail',
      amount: saleAmount,
      paymentMethod: paymentMethod,
      hasReceipt: false,
    };
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/transactions`), { ...transaction, date: new Date().toISOString() });

    toast({
        title: "Sale Logged",
        description: `${quantity} unit(s) of ${product.name} sold for $${saleAmount.toFixed(2)}.`,
    });

    return { success: true, message: "Sale logged successfully." };
  };

  const handleSpoilageConfirm = (items: SpoilageItem[], notes?: string, imageUrl?: string) => {
    if (!firestore || !tenantId || !inventory) return;

    const batch = writeBatch(firestore);
    let totalLoss = 0;

    items.forEach(item => {
        const product = inventory.find(p => p.id === item.productId);
        if (product) {
            const productRef = doc(firestore, `tenants/${tenantId}/inventory`, item.productId);
            const updatedBatches = product.batches.map(b => {
                if (b.id === item.batchId) {
                    totalLoss += item.stock * item.costPerUnit;
                    return { ...b, stock: 0 }; // Set stock of this batch to 0
                }
                return b;
            });
            
            const newTotalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);

            const updatePayload: Partial<InventoryItem> = {
                batches: updatedBatches,
                totalStock: newTotalStock,
            };
            
            // If writing off the last container, clear partial usage as well
            if (newTotalStock === 0) {
                updatePayload.partialContainerUses = 0;
                updatePayload.partialContainerSize = 0;
            }

            batch.update(productRef, JSON.parse(JSON.stringify(updatePayload)));
            
            const stockCorrection: Omit<StockCorrection, 'id'> = {
                productId: item.productId,
                date: new Date().toISOString(),
                change: -item.stock,
                unit: product.unit || 'units',
                reason: 'Spoilage - Expired',
            };
            const scRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
            batch.set(scRef, stockCorrection);
        }
    });
    
    // Create a single transaction for the total loss
    if (totalLoss > 0) {
        const transaction: Omit<Transaction, 'id' | 'date'> = {
            description: `Spoilage Write-off: ${items.length} batch(es)`,
            clientOrVendor: 'Internal',
            type: 'expense',
            context: 'Business',
            category: 'Spoilage',
            amount: totalLoss,
            paymentMethod: 'Internal',
            hasReceipt: !!imageUrl,
            receiptUrl: imageUrl,
            notes: notes,
        };
        const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
        batch.set(txnRef, JSON.parse(JSON.stringify({...transaction, date: new Date().toISOString()})));
    }


    batch.commit().then(() => {
        toast({
            title: "Spoilage Written Off",
            description: `${items.length} item(s) written off with a total loss of $${totalLoss.toFixed(2)}.`,
        });
    }).catch((error) => {
        console.error("Error writing off spoilage:", error);
        toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to write off spoilage.",
        });
    });
  };
  
  const handleToggleExperiment = (item: InventoryItem) => {
    if (!firestore || !tenantId) return;
    const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', item.id);
    updateDocumentNonBlocking(itemRef, { isExperimentActive: true, experimentUses: 0 });
    toast({
        title: "Experiment Started!",
        description: `You are now tracking the cost-per-use for ${item.name}.`,
    });
  };

  const handleEndExperiment = (item: InventoryItem) => {
    setSelectedProduct(item);
    setIsEndExperimentOpen(true);
  };
  
  const handleEndExperimentConfirmed = (results: any) => {
    if (!selectedProduct || !firestore || !tenantId) return;
    
    const itemRef = doc(firestore, 'tenants', tenantId, 'inventory', selectedProduct.id);
    updateDocumentNonBlocking(itemRef, { isExperimentActive: false, lastTestResult: results });

    toast({
        title: "Experiment Ended",
        description: `Cost-per-use tracking for ${selectedProduct.name} has been stopped.`,
    });
    setIsEndExperimentOpen(false);
    setSelectedProduct(null);
  }

  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    let items = inventory.filter(item => {
      return showArchived ? item.status === 'archived' : item.status !== 'archived';
    });

    if (activeFilter !== 'all') {
      items = items.filter(item => item.type === activeFilter);
    }
    
    if (searchTerm) {
        const lowercasedSearchTerm = searchTerm.toLowerCase();
        items = items.filter(item => 
            item.name.toLowerCase().includes(lowercasedSearchTerm) ||
            item.id.toLowerCase().includes(lowercasedSearchTerm) ||
            item.id.toUpperCase().endsWith(searchTerm.toUpperCase()) ||
            item.sku?.toLowerCase().includes(lowercasedSearchTerm)
        );
    }

    return items;
  }, [inventory, activeFilter, searchTerm, showArchived]);
  
  const totalPages = Math.ceil(filteredInventory.length / ITEMS_PER_PAGE);
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredInventory.slice(startIndex, endIndex);
  }, [filteredInventory, currentPage]);

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };


  const handleScan = useCallback((data: string) => {
    const rawData = data.trim();
    if (rawData.startsWith('clarityflow://product/')) {
        const productId = rawData.split('/').pop();
        if (productId) {
            setSearchTerm(productId);
            toast({
                title: "Product Found",
                description: `Displaying results for scanned product.`,
            });
        }
    } else {
        // Handle raw SKU or ID/ShortID scanning
        setSearchTerm(rawData);
        toast({
            title: "Scanning...",
            description: `Searching for code: ${rawData}`,
        });
    }
  }, [toast]);
  
  useEffect(() => {
    let html5QrCode: Html5Qrcode | undefined;
    if (isScannerOpen) {
      const timer = setTimeout(() => {
        const element = document.getElementById('qr-reader-inventory');
        if (element) {
          html5QrCode = new Html5Qrcode('qr-reader-inventory');
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
              toast({ variant: 'destructive', title: 'Camera Error', description: 'Could not start the camera. Please check permissions and try again.' });
              setIsScannerOpen(false);
            });
        }
      }, 300);
      return () => {
          clearTimeout(timer);
          if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => console.error("Failed to stop QR Code scanner.", err));
          }
      };
    }
  }, [isScannerOpen, handleScan, toast]);
  
  const hasInventory = inventory && inventory.length > 0;
  const hasFilteredInventory = filteredInventory.length > 0;

  return (
    <ClientOnly>
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Inventory Hub" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0">
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 text-left">
            <div className="space-y-1">
                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Asset Base</h1>
                <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Supply, retail & equipment pulse</p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
                <Button variant="outline" asChild className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white/50 backdrop-blur-sm">
                    <Link href="/inventory/report"><BarChart className="mr-2 h-4 w-4" /> Reports</Link>
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
                            <PlusCircle className="mr-2 h-4 w-4" /> New Entry
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-2 w-56">
                        <DropdownMenuItem onClick={() => handleOpenAddProductDialog('professional')} className="rounded-xl font-bold uppercase text-[10px] tracking-widest py-3"><Package className="mr-3 h-4 w-4 text-primary" />Professional Product</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenAddProductDialog('retail')} className="rounded-xl font-bold uppercase text-[10px] tracking-widest py-3"><Store className="mr-3 h-4 w-4 text-primary" />Retail Product</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsAddEquipmentDialogOpen(true)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest py-3"><Hammer className="mr-3 h-4 w-4 text-primary" />Equipment Asset</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsAddOverheadDialogOpen(true)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest py-3"><Recycle className="mr-3 h-4 w-4 text-primary" />Overhead Supply</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsAddRefreshmentDialogOpen(true)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest py-3 text-indigo-600"><Coffee className="mr-3 h-4 w-4" />Refreshment Amenity</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>

        <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-10 items-start">
            <div className="hidden lg:block lg:col-span-1">
                <InventorySidebar
                  inventory={inventory || []}
                  stockCorrections={stockCorrections || []}
                  onLogOverheadUse={handleOpenLogUse} 
                />
            </div>

            <div className="lg:col-span-2 xl:col-span-3 space-y-8 min-w-0">
                 <div className="lg:hidden mb-6">
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="outline" className="w-full h-12 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm bg-white/50 backdrop-blur-sm">
                                <SlidersHorizontal className="mr-2 h-4 w-4" />
                                Stats & Tactical Ops
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="h-[80vh] flex flex-col p-0 border-none rounded-t-[3rem] bg-background shadow-3xl">
                             <SheetHeader className="p-8 pb-4 border-b bg-muted/5 flex-shrink-0 text-left">
                                <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Inventory Pulse</SheetTitle>
                                <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60">High-level asset metrics.</SheetDescription>
                            </SheetHeader>
                            <ScrollArea className="flex-1">
                                <div className="p-8">
                                     <InventorySidebar
                                      inventory={inventory || []}
                                      stockCorrections={stockCorrections || []}
                                      onLogOverheadUse={handleOpenLogUse}
                                     />
                                </div>
                            </ScrollArea>
                        </SheetContent>
                    </Sheet>
                </div>

                <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8 space-y-8 text-left">
                        <div className="flex flex-col md:flex-row items-center gap-4">
                            <div className="relative flex-1 w-full">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                                <Input 
                                    placeholder="SEARCH BY NAME, SKU, OR ID..." 
                                    className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest focus-visible:ring-primary/20 bg-white"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <Button variant="outline" size="icon" className="h-14 w-14 rounded-2xl border-2 shrink-0 bg-white/50" onClick={() => setIsScannerOpen(true)}>
                                    <QrCode className="h-6 w-6 opacity-40" />
                                </Button>
                                <Select value={activeFilter} onValueChange={setActiveFilter}>
                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-full md:w-48 bg-white shadow-inner">
                                        <SelectValue placeholder="ALL DEPARTMENTS" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        <SelectItem value="all" className="font-bold">ALL DEPARTMENTS</SelectItem>
                                        <SelectItem value="professional" className="font-bold">PROFESSIONAL</SelectItem>
                                        <SelectItem value="retail" className="font-bold">RETAIL</SelectItem>
                                        <SelectItem value="equipment" className="font-bold">EQUIPMENT</SelectItem>
                                        <SelectItem value="overhead" className="font-bold">OVERHEAD</SelectItem>
                                        <SelectItem value="refreshment" className="font-bold">REFRESHMENT</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="p-4 md:p-6 bg-primary/[0.03] rounded-3xl border-2 border-dashed border-primary/20 flex flex-wrap items-center gap-x-6 md:gap-x-10 gap-y-4 md:gap-y-6">
                            <div className="flex items-center gap-3 w-full md:w-auto text-left">
                                <div className="p-2 bg-primary/10 rounded-xl"><SlidersHorizontal className="w-4 h-4 text-primary" /></div>
                                <h4 className="text-[10px] font-black uppercase text-primary tracking-widest">Base Filters</h4>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 md:gap-8">
                                <div className="flex items-center space-x-2">
                                    <Switch id="show-archived-inv" checked={showArchived} onCheckedChange={setShowArchived} />
                                    <Label htmlFor="show-archived-inv" className="text-[10px] font-black uppercase tracking-widest cursor-pointer text-slate-600">Archived Items</Label>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8">
                        {selectedItems.size > 0 && (
                            <div className="mb-8 p-5 rounded-[2rem] bg-slate-900 text-white flex items-center justify-between shadow-2xl animate-in slide-in-from-top-4 duration-500">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-white/10 rounded-xl"><Check className="w-5 h-5" /></div>
                                    <p className="text-xs font-black uppercase tracking-widest">{selectedItems.size} Selected</p>
                                </div>
                                <div className="flex gap-2">
                                    {showArchived ? (
                                        <Button variant="outline" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-white/20 hover:bg-white/10" onClick={handleBulkUnarchive}>Restore</Button>
                                    ) : (
                                        <Button variant="outline" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-white/20 hover:bg-white/10" onClick={handleBulkArchive}>Archive</Button>
                                    )}
                                    <Button variant="destructive" size="sm" className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest" onClick={handleBulkDeleteClick}>Purge</Button>
                                </div>
                            </div>
                        )}

                        <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
                            <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-8 overflow-x-auto scrollbar-hide">
                                <TabsTrigger value="products" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Manifest</TabsTrigger>
                                <TabsTrigger value="orders" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Orders</TabsTrigger>
                                <TabsTrigger value="hospitality" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Hospitality</TabsTrigger>
                                <TabsTrigger value="locations" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Zones</TabsTrigger>
                            </TabsList>
                            
                            <TabsContent value="products" className="mt-0">
                                {!hasInventory && !isInventoryLoading ? (
                                    <EmptyState onAddFirstItem={() => handleOpenAddProductDialog('professional')} />
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {hasFilteredInventory ? paginatedItems.map(item => (
                                            <ProductCard 
                                                key={item.id}
                                                item={item} 
                                                onEdit={handleEditItem} 
                                                onToggleExperiment={handleToggleExperiment} 
                                                onEndExperiment={handleEndExperiment} 
                                                onLogUse={handleOpenLogUse}
                                                onWriteOff={handleOpenWriteOff}
                                                onLogSale={handleOpenLogSale}
                                                isSelected={selectedItems.has(item.id)}
                                                onSelect={() => handleItemSelect(item.id)}
                                                isOrdered={orderedProductIds.has(item.id)}
                                            />
                                        )) : (
                                            <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4 col-span-full">
                                                <Filter className="w-16 h-16" />
                                                <p className="font-black uppercase tracking-widest text-sm">No Assets Found</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </TabsContent>
                            
                            <TabsContent value="orders" className="mt-0">
                                <OrdersTab inventory={inventory || []} />
                            </TabsContent>

                            <TabsContent value="hospitality" className="mt-0 animate-in fade-in duration-500">
                                <HospitalityLedger />
                            </TabsContent>
                            
                            <TabsContent value="locations" className="mt-0">
                                <Locations 
                                    locations={locations || []}
                                    locationTypes={locationTypes || []}
                                    inventory={inventory || []}
                                    onAddLocation={handleOpenAddLocation}
                                    onEditLocation={handleOpenEditLocation}
                                    onDelete={() => {}}
                                />
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                    
                    {activeView === 'products' && totalPages > 1 && (
                        <CardFooter className="p-8 pt-0 border-t bg-muted/5">
                            <div className="flex items-center justify-between w-full">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                                    Segment {currentPage} of {totalPages}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button variant="ghost" size="sm" onClick={handlePrevPage} disabled={currentPage === 1} className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest"><ChevronLeft className="mr-2 h-4 w-4" /> Previous</Button>
                                    <Button variant="ghost" size="sm" onClick={handleNextPage} disabled={currentPage === totalPages} className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest">Next <ChevronRight className="ml-2 h-4 w-4" /></Button>
                                </div>
                            </div>
                        </CardFooter>
                    )}
                </Card>
            </div>
        </div>
      </main>
      
      <AddProductDialog
        open={isAddProductDialogOpen}
        onOpenChange={setIsAddProductDialogOpen}
        initialType={addProductDialogType}
        categories={productCategories}
        onNewCategory={onNewCategory}
        onProductAdded={handleProductAdded}
        locations={locations || []}
        onAddLocationClick={handleOpenAddLocation}
      />
      
       <AddEquipmentDialog
        open={isAddEquipmentDialogOpen}
        onOpenChange={setIsAddEquipmentDialogOpen}
        onEquipmentAdded={handleEquipmentAdded}
        equipmentCategories={productCategories}
        onNewCategory={onNewCategory}
        locations={locations || []}
      />
      
      <AddOverheadDialog
        open={isAddOverheadDialogOpen}
        onOpenChange={setIsAddOverheadDialogOpen}
        onOverheadAdded={handleOverheadAdded}
        categories={productCategories}
        onNewCategory={onNewCategory}
        locations={locations || []}
      />

      <AddRefreshmentDialog
        open={isAddRefreshmentDialogOpen}
        onOpenChange={setIsAddRefreshmentDialogOpen}
        onRefreshmentAdded={handleRefreshmentAdded}
        locations={locations || []}
      />

        {editingItem && editingItem.type === 'equipment' && (
            <EditEquipmentDialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                equipment={editingItem}
                onEquipmentUpdated={handleUpdateItem}
                equipmentCategories={productCategories}
                onNewCategory={onNewCategory}
                locations={locations || []}
            />
        )}
        
        {editingItem && (editingItem.type === 'professional' || editingItem.type === 'retail' || editingItem.type === 'overhead' || editingItem.type === 'refreshment') && (
            <EditProductDialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                product={editingItem}
                onProductUpdated={handleUpdateItem}
                categories={productCategories}
                onNewCategory={onNewCategory}
                locations={locations || []}
                onAddLocationClick={handleOpenAddLocation}
            />
        )}

      <LogUseDialog
        open={isLogUseOpen}
        onOpenChange={setIsLogUseOpen}
        product={selectedProduct}
        allProducts={inventory || []}
        onConfirm={handleLogUseConfirm}
        dialogType={logUseDialogType}
      />
      <LogSaleDialog
        open={isLogSaleOpen}
        onOpenChange={setIsLogSaleOpen}
        product={selectedProduct}
        onConfirm={handleLogSaleConfirm}
      />

      {selectedProduct && (
        <WriteOffDialog
            open={isWriteOffOpen}
            onOpenChange={setIsWriteOffOpen}
            product={selectedProduct}
            onConfirm={handleWriteOffConfirm}
        />
      )}
      
      {selectedProduct && (
        <EndCostPerUseTestDialog
            open={isEndExperimentOpen}
            onOpenChange={setIsEndExperimentOpen}
            product={selectedProduct}
            onConfirm={handleEndExperimentConfirmed}
        />
       )}
        <AddLocationDialog 
            open={isAddLocationDialogOpen} 
            onOpenChange={setIsAddLocationDialogOpen}
            onSave={handleSaveLocation}
            locationTypes={locationTypes || []}
            onAddNewLocationType={handleAddNewLocationType}
        />
        {selectedLocation && (
            <EditLocationDialog
                open={isEditLocationDialogOpen}
                onOpenChange={setIsEditLocationDialogOpen}
                location={selectedLocation}
                onSave={handleUpdateLocation}
                locationTypes={locationTypes || []}
                onAddNewLocationType={handleAddNewLocationType}
            />
        )}
        
       <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden border-4 rounded-[3rem] shadow-3xl">
          <DialogHeader className="p-8 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Asset Scanner</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Scan ClarityFlow QR codes or standard SKUs.</DialogDescription>
          </DialogHeader>
          <div className="p-8 relative">
             <div id="qr-reader-inventory" className="w-full aspect-square rounded-3xl bg-muted shadow-inner" />
             <div className="absolute inset-8 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-2/3 border-4 border-primary rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>
          </div>
           <DialogFooter className="p-8 pt-0">
                <Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button" className="w-full h-14 rounded-2xl font-bold uppercase tracking-widest text-[10px]">Cancel Scanning</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
            <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                <AlertDialogHeader className="p-6 pb-0">
                    <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Terminate Assets</AlertDialogTitle>
                    <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase">
                        You are about to permanently delete {selectedItems.size} items. This will wipe all associated stock history and performance metrics. <strong>This action is non-reversible.</strong>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                    <Button onClick={handleBulkDeleteConfirm} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-destructive/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Purge Assets</Button>
                    <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
    </ClientOnly>
  );
}
