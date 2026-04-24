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
  History,
  Zap,
  ExternalLink,
  Save,
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

// ─── ORDER STATUS STYLES ─────────────────────────────────────────────────────
const ORDER_STATUS_STYLES: Record<string, string> = {
  'Draft': 'bg-slate-100 border-slate-200 text-slate-600',
  'Placed': 'bg-blue-50 border-blue-100 text-blue-700',
  'Shipped': 'bg-amber-50 border-amber-100 text-amber-700',
  'Partially Received': 'bg-orange-50 border-orange-100 text-orange-700',
  'Received': 'bg-green-50 border-green-100 text-green-700',
  'Cancelled': 'bg-destructive/5 border-destructive/10 text-destructive',
};

// ─── ORDER CARD ───────────────────────────────────────────────────────────────
const OrderCard = ({
  order,
  onSelect,
  onTrack,
  onReceive,
}: {
  order: Order;
  onSelect: (order: Order) => void;
  onTrack: (e: React.MouseEvent, url?: string) => void;
  onReceive: (order: Order) => void;
}) => {
  const totalCost = order.items.reduce((acc, item) => acc + item.quantity * item.costPerUnit, 0);
  const totalItems = order.items.reduce((acc, item) => acc + item.quantity, 0);
  const canReceive = order.status === 'Placed' || order.status === 'Shipped' || order.status === 'Partially Received';

  return (
    <Card
      className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white cursor-pointer hover:shadow-md hover:border-primary/20 transition-all group"
      onClick={() => onSelect(order)}
    >
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-left min-w-0">
            <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{order.supplier}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              #{order.id.slice(-6).toUpperCase()} · {format(parseISO(order.orderDate), 'MMM d, yyyy')}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'h-6 px-3 font-black text-[9px] uppercase tracking-widest border-2 shrink-0',
              ORDER_STATUS_STYLES[order.status] ?? ORDER_STATUS_STYLES['Draft']
            )}
          >
            {order.status}
          </Badge>
        </div>

        <div className="space-y-1 text-left">
          {order.items.slice(0, 2).map((item, i) => (
            <p key={i} className="text-[10px] font-bold text-muted-foreground truncate">
              · {item.productName} ×{item.quantity}
            </p>
          ))}
          {order.items.length > 2 && (
            <p className="text-[10px] font-black text-primary">+{order.items.length - 2} more items</p>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-dashed">
          <div className="text-left space-y-0.5">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Items / Cost</p>
            <p className="font-black text-base tracking-tight">
              {totalItems} units · <span className="text-primary">${totalCost.toFixed(2)}</span>
            </p>
          </div>
          <div className="flex gap-2">
            {order.trackingNumber && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
                onClick={(e) => { e.stopPropagation(); onTrack(e, order.trackingUrl); }}
              >
                <Truck className="mr-1.5 h-3 w-3" /> Track
              </Button>
            )}
            {canReceive && (
              <Button
                size="sm"
                className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-md shadow-primary/20"
                onClick={(e) => { e.stopPropagation(); onReceive(order); }}
              >
                <PackageOpen className="mr-1.5 h-3 w-3" /> Receive
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ─── VIEW / EDIT ORDER DIALOG ─────────────────────────────────────────────────
const ViewOrEditOrderDialog = ({
  order,
  open,
  onOpenChange,
  onSave,
  onCancelOrder,
  onTrack,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (order: Order) => void;
  onCancelOrder: (orderId: string) => void;
  onTrack: (e: React.MouseEvent, url?: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [expectedDate, setExpectedDate] = useState('');

  useEffect(() => {
    if (order) {
      setNotes(order.notes || '');
      setTrackingNumber(order.trackingNumber || '');
      setTrackingUrl(order.trackingUrl || '');
      setExpectedDate(order.expectedArrivalDate || '');
      setIsEditing(false);
    }
  }, [order]);

  if (!order) return null;

  const totalCost = order.items.reduce((acc, item) => acc + item.quantity * item.costPerUnit, 0);
  const canCancel = order.status !== 'Cancelled' && order.status !== 'Received';

  const handleSave = () => {
    onSave({
      ...order,
      notes,
      trackingNumber,
      trackingUrl,
      expectedArrivalDate: expectedDate,
    });
    setIsEditing(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden border-4 rounded-[3rem] shadow-3xl max-h-[90dvh] flex flex-col">
        <DialogHeader className="p-8 pb-0 text-left flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">Purchase Order</p>
              <DialogTitle className="text-2xl font-black uppercase tracking-tighter">{order.supplier}</DialogTitle>
              <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                #{order.id.slice(-6).toUpperCase()} · Placed {format(parseISO(order.orderDate), 'MMM d, yyyy')}
              </DialogDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'h-7 px-3 font-black text-[9px] uppercase tracking-widest border-2 shrink-0 mt-1',
                ORDER_STATUS_STYLES[order.status] ?? ORDER_STATUS_STYLES['Draft']
              )}
            >
              {order.status}
            </Badge>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-8 space-y-6">
            {/* Items */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Order Items</p>
              <div className="rounded-2xl border-2 overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/10">
                    <TableRow>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 p-4">Product</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right">Qty</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-right pr-4">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="p-4 font-bold text-sm text-slate-900">{item.productName}</TableCell>
                        <TableCell className="text-right font-black font-mono">{item.quantity}</TableCell>
                        <TableCell className="text-right pr-4 font-black font-mono text-primary">
                          ${(item.quantity * item.costPerUnit).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/10">
                      <TableCell colSpan={2} className="p-4 font-black uppercase text-[10px] tracking-widest text-right">Total</TableCell>
                      <TableCell className="text-right pr-4 font-black font-mono text-lg text-primary">${totalCost.toFixed(2)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Tracking */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 text-left">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Tracking Number</Label>
                {isEditing ? (
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    className="h-12 rounded-xl border-2 font-mono font-black text-xs"
                    placeholder="e.g., 1Z999AA10123456784"
                  />
                ) : (
                  <div className="h-12 rounded-xl border-2 border-dashed flex items-center px-4 gap-2">
                    <span className="font-mono font-black text-xs text-slate-600">{trackingNumber || '—'}</span>
                    {trackingNumber && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={(e) => onTrack(e, trackingUrl || undefined)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2 text-left">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Expected Arrival</Label>
                {isEditing ? (
                  <Input
                    type="date"
                    value={expectedDate ? expectedDate.split('T')[0] : ''}
                    onChange={(e) => setExpectedDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
                    className="h-12 rounded-xl border-2 font-black text-xs"
                  />
                ) : (
                  <div className="h-12 rounded-xl border-2 border-dashed flex items-center px-4">
                    <span className="font-black text-xs text-slate-600">
                      {expectedDate ? format(parseISO(expectedDate), 'MMM d, yyyy') : '—'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="space-y-2 text-left">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Tracking URL</Label>
                <Input
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  className="h-12 rounded-xl border-2 font-black text-xs"
                  placeholder="https://track.carrier.com/..."
                />
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2 text-left">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Notes</Label>
              {isEditing ? (
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded-2xl border-2 bg-muted/5 min-h-[80px] focus-visible:ring-primary/20"
                  placeholder="Internal notes about this order..."
                />
              ) : (
                <div className="rounded-2xl border-2 border-dashed p-4 min-h-[60px]">
                  <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap">{notes || <span className="opacity-30 font-black text-[10px] uppercase">No notes</span>}</p>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-0 border-t bg-muted/5 flex-shrink-0">
          <div className="flex flex-col gap-3 w-full">
            {isEditing ? (
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button className="flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20" onClick={handleSave}>
                  <Save className="mr-2 h-4 w-4" /> Save Changes
                </Button>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2" onClick={() => setIsEditing(true)}>
                  <Edit className="mr-2 h-4 w-4" /> Edit Order
                </Button>
                {canCancel && (
                  <Button
                    variant="destructive"
                    className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest"
                    onClick={() => { onOpenChange(false); onCancelOrder(order.id); }}
                  >
                    <XCircle className="mr-2 h-4 w-4" /> Cancel Order
                  </Button>
                )}
              </div>
            )}
            <Button variant="ghost" className="h-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── HOSPITALITY LEDGER ───────────────────────────────────────────────────────
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
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900 text-left">Guest & Item</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Timestamp</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Location</TableHead>
                                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900 text-left">Status</TableHead>
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

// ─── ORDERS TAB ───────────────────────────────────────────────────────────────
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

        const orderId = nanoid();
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

        const orderRef = doc(firestore, `tenants/${tenantId}/orders`, orderId);
        const newOrder: Order = {
            ...newOrderData,
            id: orderId,
            items: finalItems,
            status: 'Placed',
        };
        
        setDocumentNonBlocking(orderRef, JSON.parse(JSON.stringify(newOrder)), {});
        
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
                relatedOrderId: orderId,
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
        updateDocumentNonBlocking(orderRef, JSON.parse(JSON.stringify(updatedOrder)));
        toast({
            title: "Order Updated",
            description: `Order ${updatedOrder.id.slice(-6)} has been updated.`
        });
    };

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
        }).sort((a, b) => parseISO(b.orderDate).getTime() - parseISO(a.orderDate).getTime());
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
        batch.update(orderRef, JSON.parse(JSON.stringify({ status: newStatus })));
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
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
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
                        {filteredOrders.map(order => (
                            <OrderCard
                                key={order.id}
                                order={order}
                                onSelect={setSelectedOrder}
                                onTrack={openTrackingUrl}
                                onReceive={setOrderToReceive}
                            />
                        ))}
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

// ─── EMPTY STATES ─────────────────────────────────────────────────────────────
const EmptyOrdersState = ({ onAddFirstOrder }: { onAddFirstOrder: () => void }) => (
    <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
        <div className='w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner'>
            <Truck className='w-12 h-12 text-muted-foreground' />
        </div>
        <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Procurement Clear</h3>
            <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground mx-auto">
                No supply orders in the ledger. Track supplier shipments and landed costs to protect your margins.
            </p>
        </div>
        <Button size="lg" onClick={onAddFirstOrder} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">
            <PlusCircle className="mr-2 h-5 w-5" />
            Initiate First Order
        </Button>
    </div>
);

const EmptyState = ({ onAddFirstItem }: { onAddFirstItem: () => void }) => (
    <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
        <div className='w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner'>
            <Package className='w-12 h-12 text-muted-foreground' />
        </div>
        <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Inventory is Empty</h3>
            <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground mx-auto">
                Start building your asset manifest to unlock automated costing and yield tracking.
            </p>
        </div>
        <Button size="lg" onClick={onAddFirstItem} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">
            <PlusCircle className="mr-2 h-5 w-5" />
            Add First Asset
        </Button>
    </div>
);

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
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
    });
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
  };

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
    } else {
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
                    return { ...b, stock: 0 };
                }
                return b;
            });
            
            const newTotalStock = updatedBatches.reduce((acc, b) => acc + b.stock, 0);

            const updatePayload: Partial<InventoryItem> = {
                batches: updatedBatches,
                totalStock: newTotalStock,
            };
            
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
  };

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

  const handlePrevPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));
  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));

  const handleScan = useCallback((data: string) => {
    const rawData = data.trim();
    if (rawData.startsWith('clarityflow://product/')) {
        const productId = rawData.split('/').pop();
        if (productId) {
            setSearchTerm(productId);
            toast({ title: "Product Found", description: `Displaying results for scanned product.` });
        }
    } else {
        setSearchTerm(rawData);
        toast({ title: "Scanning...", description: `Searching for code: ${rawData}` });
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
          html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, () => {})
            .catch(() => {
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
                        <DropdownMenuItem onClick={() => setIsAddRefreshmentDialogOpen(true)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest py-3 text-indigo-600"><Coffee className="mr-3 h-4 w-4" />Concierge Amenity</DropdownMenuItem>
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
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
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