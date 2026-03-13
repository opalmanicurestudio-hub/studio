'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  MoreHorizontal,
  PlusCircle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Paperclip,
  Calendar as CalendarIcon,
  BookOpen,
  CreditCard,
  Trash2,
  Printer,
  Filter,
  X,
  Loader,
  Search,
  ArrowRight,
  ShieldCheck,
  Tag,
  Link as LinkIcon,
  Landmark,
  ShoppingCart,
  CalendarCheck,
  User as UserIcon,
  FileX,
  Undo2,
  Lock,
  HeartHandshake,
  ShieldAlert,
  AlertTriangle,
  FileWarning,
  Banknote,
  Info,
  DollarSign,
  Banknote as BanknoteIcon
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type Transaction } from '@/lib/financial-data';
import { type Staff, type Incident } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { format, startOfDay, endOfDay, parseISO, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { useFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking, useUser, updateDocumentNonBlocking } from '@/firebase';
import { AddTransactionDialog } from '@/components/ledger/AddTransactionDialog';
import { useToast } from '@/hooks/use-toast';
import { PrintableReport } from '@/components/ledger/PrintableReport';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { collection, doc, writeBatch, increment, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

const TransactionIcon = ({ type }: { type: Transaction['type'] }) => {
  const iconClass = "h-5 w-5";
  switch (type) {
    case 'income':
      return <TrendingUp className={cn(iconClass, "text-green-500")} />;
    case 'expense':
      return <TrendingDown className={cn(iconClass, "text-red-500")} />;
    case 'payment':
        return <BookOpen className={cn(iconClass, "text-primary")} />;
    case 'reversal':
      return <RefreshCw className={cn(iconClass, "text-slate-400")} />;
    default:
      return null;
  }
};

const ReceiptPreviewDialog = ({ url, open, onOpenChange, description }: { url: string, open: boolean, onOpenChange: (open: boolean) => void, description: string }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
            <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
                <div className="flex items-center gap-3 mb-2">
                    <Paperclip className="w-5 h-5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Digital Proof</span>
                </div>
                <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 truncate">{description}</DialogTitle>
            </DialogHeader>
            <div className="p-8 flex items-center justify-center bg-muted/20">
                <div className="relative w-full aspect-[3/4] max-h-[60vh] rounded-2xl overflow-hidden border-2 shadow-2xl bg-white flex items-center justify-center">
                    {url ? (
                        <Image src={url} alt="Receipt Attachment" fill className="object-contain" unoptimized />
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-4 opacity-20">
                            <FileX className="w-16 h-16 text-muted-foreground" />
                            <p className="font-black uppercase text-[10px] tracking-widest text-muted-foreground">Attachment Missing</p>
                        </div>
                    )}
                </div>
            </div>
            <DialogFooter className="p-8 pt-4 border-t bg-muted/5">
                <Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl" onClick={() => onOpenChange(false)}>Close Archive</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

const RefundProtocolDialog = ({ transaction, activeTill, staff, open, onOpenChange, onConfirm }: any) => {
    const [pin, setPin] = useState('');
    const [refundAmount, setRefundAmount] = useState(transaction?.amount || 0);
    const [refundTip, setRefundTip] = useState(true);
    const [tipStrategy, setTipStrategy] = useState<'clawback' | 'absorb'>('clawback');
    const [reason, setReason] = useState('');
    const [logIncident, setLogIncident] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (transaction) {
            setRefundAmount(transaction.amount);
            setRefundTip(!!transaction.tipAmount);
            setReason('');
            setLogIncident(false);
        }
    }, [transaction]);

    if (!transaction) return null;

    const isCardPayment = transaction.paymentMethod.toLowerCase().includes('card') || transaction.paymentMethod.toLowerCase().includes('visa') || transaction.paymentMethod.toLowerCase().includes('master');

    const handleAction = () => {
        const authorized = staff.find((s: any) => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
        if (!authorized) {
            toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager PIN required for revenue reversal.' });
            return;
        }
        
        if (!reason.trim()) {
            toast({ variant: 'destructive', title: 'Reason Required', description: 'A detailed justification is mandatory for audit compliance.' });
            return;
        }
        
        onConfirm({
            amount: refundAmount,
            refundTip: refundTip && (transaction.tipAmount || 0) > 0,
            tipStrategy,
            reason,
            logIncident,
            authorizerId: authorized.id
        });
        setPin('');
    };

    const tipToRefund = refundTip ? (transaction.tipAmount || 0) : 0;
    const totalOutlay = refundAmount + tipToRefund;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden bg-background">
                <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
                    <div className="flex items-center gap-3 mb-2">
                        <Undo2 className="w-5 h-5 text-destructive" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Revenue Reversal</span>
                    </div>
                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Refund Protocol</DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Initiating reversal sequence.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                    <div className="p-8 space-y-8">
                        <div className="p-6 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 text-center space-y-2 shadow-inner">
                            <p className="text-[9px] font-black uppercase text-destructive/60 tracking-widest">Reversal Value</p>
                            <p className="text-5xl font-black text-destructive tracking-tighter font-mono">${totalOutlay.toFixed(2)}</p>
                            <div className="pt-3 border-t border-destructive/10">
                                <p className="text-[10px] font-bold text-slate-600 uppercase flex items-center justify-center gap-2">
                                    {isCardPayment ? <Lock className="w-3 h-3" /> : <Banknote className="w-3 h-3" />}
                                    Method: {isCardPayment ? 'Locked to Card' : transaction.paymentMethod}
                                </p>
                            </div>
                        </div>

                        {isCardPayment && (
                            <Alert className="bg-amber-50 border-amber-200 border-2 rounded-2xl p-4">
                                <Info className="h-4 w-4 text-amber-600" />
                                <AlertDescription className="text-[10px] font-bold uppercase text-amber-700 leading-relaxed">
                                    Card payments cannot be refunded as cash. This reversal will be attributed back to the original funding source.
                                </AlertDescription>
                            </Alert>
                        )}

                        <div className="space-y-6 text-left">
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Reversal Parameters</Label>
                                <div className="p-4 rounded-2xl border-2 bg-muted/5 space-y-4 shadow-inner">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[11px] font-black uppercase text-slate-700">Refund Service Base</span>
                                        <div className="relative w-24">
                                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                                            <Input type="number" value={refundAmount} onChange={e => setRefundAmount(parseFloat(e.target.value) || 0)} className="h-8 pl-6 pr-2 rounded-lg border-2 text-right font-black font-mono text-xs" />
                                        </div>
                                    </div>
                                    {transaction.tipAmount > 0 && (
                                        <div className="pt-4 border-t border-dashed border-border/50 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <span className="text-[11px] font-black uppercase text-slate-700">Refund Gratuity (${transaction.tipAmount.toFixed(2)})</span>
                                                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">Return tip to guest</p>
                                                </div>
                                                <Switch checked={refundTip} onCheckedChange={setRefundTip} />
                                            </div>
                                            <AnimatePresence>
                                                {refundTip && (
                                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3 pt-2">
                                                        <Label className="text-[9px] font-black uppercase tracking-widest text-primary ml-1">Tip Payout Strategy</Label>
                                                        <RadioGroup value={tipStrategy} onValueChange={(v: any) => setTipStrategy(v)} className="grid grid-cols-2 gap-2">
                                                            <label htmlFor="strategy-clawback" className="cursor-pointer">
                                                                <div className={cn("p-2 rounded-xl border-2 text-center transition-all", tipStrategy === 'clawback' ? "border-primary bg-primary/5 shadow-sm text-primary" : "border-border bg-white text-slate-400")}>
                                                                    <span className="text-[9px] font-black uppercase">Clawback</span>
                                                                    <RadioGroupItem value="clawback" id="strategy-clawback" className="sr-only" />
                                                                </div>
                                                            </label>
                                                            <label htmlFor="strategy-absorb" className="cursor-pointer">
                                                                <div className={cn("p-2 rounded-xl border-2 text-center transition-all", tipStrategy === 'absorb' ? "border-primary bg-primary/5 shadow-sm text-primary" : "border-border bg-white text-slate-400")}>
                                                                    <span className="text-[9px] font-black uppercase">Absorb</span>
                                                                    <RadioGroupItem value="absorb" id="strategy-absorb" className="sr-only" />
                                                                </div>
                                                            </label>
                                                        </RadioGroup>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 pt-4 border-t border-dashed">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Justification Required</Label>
                                <Textarea 
                                    placeholder="Provide detailed reasoning for this revenue reversal..." 
                                    value={reason}
                                    onChange={e => setReason(e.target.value)}
                                    className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20 font-medium"
                                />
                            </div>

                            <div className="flex items-center justify-between p-5 rounded-2xl border-2 border-dashed bg-muted/5 shadow-inner">
                                <div className="space-y-0.5 text-left">
                                    <Label className="text-xs font-black uppercase tracking-tight flex items-center gap-2"><FileWarning className="w-4 h-4 text-amber-600" /> Log as Incident</Label>
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Record this event in the guest dossier</p>
                                </div>
                                <Switch checked={logIncident} onCheckedChange={setLogIncident} />
                            </div>

                            <div className="space-y-4 pt-4 border-t border-dashed">
                                <div className="flex items-center gap-3 px-1">
                                    <div className="p-2 bg-muted rounded-xl"><Lock className="w-4 h-4 text-slate-400" /></div>
                                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Manager PIN Authorization</Label>
                                </div>
                                <Input 
                                    type="password" 
                                    maxLength={4} 
                                    value={pin} 
                                    onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                                    className="h-16 text-center text-4xl font-black tracking-[0.5em] rounded-2xl border-4 focus-visible:ring-primary/20 shadow-inner bg-muted/5"
                                    placeholder="••••"
                                />
                            </div>
                        </div>
                    </div>
                </ScrollArea>
                <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3">
                    <Button onClick={handleAction} disabled={pin.length < 4 || !reason.trim()} className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-destructive/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Authorize Reversal</Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full font-bold uppercase text-[10px] tracking-widest text-slate-400">Abort Reversal</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const TransactionDossierSheet = ({ transaction, staff, open, onOpenChange, onRevert }: { transaction: Transaction | null, staff: Staff[], open: boolean, onOpenChange: (open: boolean) => void, onRevert: (t: Transaction) => void }) => {
    if (!transaction) return null;
    const staffMember = staff.find(s => s.id === transaction.staffId);
    
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col border-l-0 sm:border-l bg-background overflow-hidden">
                <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
                    <div className="flex items-center gap-3 mb-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Audit Intelligence</span>
                    </div>
                    <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Record Dossier</SheetTitle>
                    <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Registry ID: {transaction.id.slice(-8).toUpperCase()}</SheetDescription>
                </SheetHeader>

                <ScrollArea className="flex-1">
                    <div className="p-8 space-y-10">
                        <div className="p-8 rounded-[2.5rem] bg-muted/10 border-4 border-border/50 text-center space-y-4 shadow-inner relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-6 opacity-5"><DollarSign className="w-20 h-20 text-slate-900" /></div>
                            <div className="space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground opacity-60">Accounting Entry</p>
                                <p className={cn("text-5xl font-black font-mono tracking-tighter", transaction.type === 'income' ? 'text-green-600' : 'text-destructive')}>
                                    {transaction.type === 'income' ? '+' : '-'}${transaction.amount.toFixed(2)}
                                </p>
                            </div>
                            <div className="flex justify-center gap-2">
                                <Badge variant="outline" className="font-black uppercase text-[9px] h-6 px-3 border-2">{transaction.type}</Badge>
                                <Badge className="bg-primary text-white border-none font-black text-[9px] h-6 px-3 uppercase">{transaction.category}</Badge>
                            </div>
                        </div>

                        <div className="space-y-6 text-left">
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Entity Reference</Label>
                                <p className="text-xl font-black uppercase tracking-tight text-slate-900">{transaction.description}</p>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-tight">{transaction.clientOrVendor}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-6 pt-4 border-t border-dashed">
                                <div className="space-y-1">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Timestamp</p>
                                    <p className="font-black text-sm uppercase tracking-tight">{format(safeDate(transaction.date), 'MMMM d, yyyy')}</p>
                                    <p className="text-[10px] font-bold text-primary uppercase tracking-widest">{format(safeDate(transaction.date), 'h:mm a')}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Settlement</p>
                                    <p className="font-black text-sm uppercase tracking-tight">{transaction.paymentMethod}</p>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{transaction.context} Account</p>
                                </div>
                            </div>

                            {staffMember && (
                                <div className="pt-6 border-t border-dashed space-y-3">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Authorized By</p>
                                    <div className="flex items-center gap-3 p-3 rounded-2xl border-2 bg-white shadow-sm">
                                        <Avatar className="h-10 w-10 border shadow-sm rounded-xl">
                                            <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                                            <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(staffMember.name || 'S').charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="font-black text-sm uppercase tracking-tight truncate">{staffMember.name}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">{staffMember.role}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(transaction.relatedOrderId || transaction.relatedBillInstanceId || transaction.appointmentId) && (
                                <div className="pt-6 border-t border-dashed space-y-4">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Protocol Linkages</p>
                                    <div className="grid gap-2">
                                        {transaction.relatedOrderId && (
                                            <Button variant="outline" asChild className="h-12 rounded-xl border-2 justify-start font-black uppercase text-[10px] tracking-widest bg-white">
                                                <Link href="/inventory">
                                                    <ShoppingCart className="mr-3 h-4 w-4 text-primary opacity-40" />
                                                    View Purchase Order
                                                </Link>
                                            </Button>
                                        )}
                                        {transaction.appointmentId && (
                                            <Button variant="outline" asChild className="h-12 rounded-xl border-2 justify-start font-black uppercase text-[10px] tracking-widest bg-white">
                                                <Link href="/planner">
                                                    <CalendarCheck className="mr-3 h-4 w-4 text-primary opacity-40" />
                                                    Examine Session
                                                </Link>
                                            </Button>
                                        )}
                                        {transaction.relatedBillInstanceId && (
                                            <Button variant="outline" asChild className="h-12 rounded-xl border-2 justify-start font-black uppercase text-[10px] tracking-widest bg-white">
                                                <Link href="/bills">
                                                    <Landmark className="mr-3 h-4 w-4 text-primary opacity-40" />
                                                    View Bill Context
                                                </Link>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </ScrollArea>

                <SheetFooter className="p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
                    <div className="flex flex-col gap-3 w-full">
                        <Button 
                            variant="destructive" 
                            className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-destructive/20"
                            disabled={transaction.type === 'reversal'}
                            onClick={() => onRevert(transaction)}
                        >
                            <RefreshCw className="mr-2 h-4 w-4" /> 
                            {transaction.type === 'reversal' ? 'Already Reverted' : 'Revert Protocol Entry'}
                        </Button>
                        <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-widest border-2 bg-white">Close Archive</Button>
                    </div>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
};

const TransactionFilters = ({ 
    transactions,
    date, 
    setDate,
    periodPreset,
    setPeriodPreset,
    searchTerm,
    setSearchTerm,
    contextFilter,
    setContextFilter,
    categoryFilter,
    setCategoryFilter,
    financialSummary,
}: { 
    transactions: Transaction[];
    date: DateRange | undefined;
    setDate: (date: DateRange | undefined) => void;
    periodPreset: string;
    setPeriodPreset: (preset: string) => void;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    contextFilter: 'all' | 'Business' | 'Personal';
    setContextFilter: (context: 'all' | 'Business' | 'Personal') => void;
    categoryFilter: string;
    setCategoryFilter: (category: string) => void;
    financialSummary: { revenue: number, cogs: number, grossProfit: number, operatingExpenses: number, net: number };
 }) => {
    
    const categories = useMemo(() => {
        if (!transactions) return [];
        const allCategories = transactions.map(t => t.category);
        return [...new Set(allCategories)];
    }, [transactions]);

  return (
    <Card className="h-fit border-2 shadow-sm rounded-3xl overflow-hidden">
      <CardHeader className="hidden md:block border-b bg-muted/5">
        <CardTitle className="text-sm font-black uppercase tracking-widest">Ledger Filters</CardTitle>
        <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Filter studio cash flow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6 text-left">
        <div className="space-y-4">
            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Analyze Period</Label>
                <Select value={periodPreset} onValueChange={setPeriodPreset}>
                    <SelectTrigger className="h-12 rounded-2xl border-2 bg-background font-black uppercase text-[10px] tracking-widest shadow-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-2 shadow-2xl">
                        <SelectItem value="today" className="font-bold">TODAY</SelectItem>
                        <SelectItem value="7days" className="font-bold">LAST 7 DAYS</SelectItem>
                        <SelectItem value="30days" className="font-bold">LAST 30 DAYS</SelectItem>
                        <SelectItem value="thisMonth" className="font-bold">THIS MONTH</SelectItem>
                        <SelectItem value="lastMonth" className="font-bold">LAST MONTH</SelectItem>
                        <SelectItem value="custom" className="font-bold">CUSTOM RANGE...</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <AnimatePresence>
                {periodPreset === 'custom' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="grid grid-cols-1 gap-3 pt-2">
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-2">From</Label>
                                <input 
                                    type="date" 
                                    value={date?.from ? format(date.from, 'yyyy-MM-dd') : ''}
                                    onChange={(e) => {
                                        const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                        setDate({ from: d || date?.from, to: date?.to });
                                    }}
                                    className="w-full h-10 rounded-xl border-2 bg-background px-3 font-bold text-xs outline-none focus:border-primary transition-all shadow-inner"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-2">To</Label>
                                <input 
                                    type="date" 
                                    value={date?.to ? format(date.to, 'yyyy-MM-dd') : ''}
                                    onChange={(e) => {
                                        const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined;
                                        setDate({ from: date?.from, to: d || date?.to });
                                    }}
                                    className="w-full h-10 rounded-xl border-2 bg-background px-3 font-bold text-xs outline-none focus:border-primary transition-all shadow-inner"
                                />
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>

        <div className="space-y-4">
            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Search Records</Label>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Description or entity..." className="pl-9 h-12 rounded-2xl border-2 focus-visible:ring-primary/20" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
            </div>
            <RadioGroup value={contextFilter} onValueChange={(v: any) => setContextFilter(v)} className="grid grid-cols-3 gap-2">
                <div>
                    <RadioGroupItem value="all" id="all" className="peer sr-only" />
                    <Label htmlFor="all" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">All</Label>
                </div>
                <div>
                    <RadioGroupItem value="Business" id="business" className="peer sr-only" />
                    <Label htmlFor="business" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">Business</Label>
                </div>
                <div>
                    <RadioGroupItem value="Personal" id="personal" className="peer sr-only" />
                    <Label htmlFor="personal" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">Personal</Label>
                </div>
            </RadioGroup>
            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-12 rounded-2xl border-2 focus:ring-primary/20">
                        <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-2 shadow-2xl">
                        <SelectItem value="all" className="font-bold">All Categories</SelectItem>
                        {categories.map(cat => <SelectItem key={cat} value={cat} className="font-bold">{cat}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </div>

        <Separator />

        <div className='p-5 rounded-[2rem] bg-primary/[0.03] border-2 border-primary/10 space-y-4 text-left'>
            <p className="text-[10px] font-black uppercase tracking-widest text-primary text-center">Period Performance</p>
            <div className='space-y-2.5 text-xs'>
                <div className='flex justify-between font-bold'><span>Total Revenue:</span><span className='font-mono text-green-600'>${financialSummary.revenue.toFixed(2)}</span></div>
                <div className='flex justify-between font-bold'><span>COGS:</span><span className='font-mono text-destructive'>-${financialSummary.cogs.toFixed(2)}</span></div>
                <div className='flex justify-between border-t border-primary/10 pt-2 font-black'><span>Gross Profit:</span><span className="font-mono text-slate-900">${financialSummary.grossProfit.toFixed(2)}</span></div>
                <div className='flex justify-between font-bold'><span>Op. Expenses:</span><span className='font-mono text-destructive'>-${financialSummary.operatingExpenses.toFixed(2)}</span></div>
                <div className='flex justify-between border-t-4 border-primary/20 pt-3 mt-3'>
                    <span className="font-black uppercase text-[11px] text-primary">Net Income</span>
                    <span className={cn('font-black text-xl tracking-tighter font-mono', financialSummary.net >= 0 ? 'text-primary' : 'text-destructive')}>
                        ${financialSummary.net.toFixed(2)}
                    </span>
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  );
};

const TransactionRow = ({ transaction, staffMember, onRevertClick, onPreviewReceipt, onViewDetails, onRefundClick }: { transaction: Transaction, staffMember?: Staff, onRevertClick: (transaction: Transaction) => void, onPreviewReceipt: (t: Transaction) => void, onViewDetails: (t: Transaction) => void, onRefundClick: (t: Transaction) => void }) => {
  return (
    <TableRow className="group hover:bg-primary/[0.02] cursor-pointer" onClick={() => onViewDetails(transaction)}>
      <TableCell>
        <div className="flex items-center gap-4 py-1">
          <div className={cn("p-2 rounded-full", transaction.type === 'income' ? 'bg-green-500/10' : transaction.type === 'expense' ? 'bg-destructive/10' : 'bg-primary/10')}>
            <TransactionIcon type={transaction.type} />
          </div>
          <div className='flex flex-col min-w-0 text-left'>
            <span className="font-black uppercase tracking-tight text-xs md:text-sm text-slate-900 truncate">{transaction.description}</span>
            <span className='text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-60 truncate'>{transaction.clientOrVendor}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-[10px] font-black uppercase text-muted-foreground opacity-70">{format(safeDate(transaction.date), 'MMM d, p')}</TableCell>
      <TableCell>
        {staffMember ? (
            <div className="flex items-center gap-2">
                <Avatar className="h-7 w-7 border-2 shadow-sm rounded-xl">
                    <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-black uppercase">{staffMember.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="text-[10px] font-black uppercase tracking-tight text-slate-700">{staffMember.name.split(' ')[0]}</span>
            </div>
        ) : <span className="text-[9px] font-black uppercase text-muted-foreground italic opacity-40">System</span>}
      </TableCell>
      <TableCell>
        <Badge
          variant={transaction.context === 'Business' ? 'secondary' : 'outline'}
          className={cn("text-[9px] h-5 px-2 font-black uppercase tracking-widest border-none", {
            'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300': transaction.context === 'Business',
            'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300': transaction.context === 'Personal'
          })}
        >
          {transaction.context}
        </Badge>
      </TableCell>
      <TableCell className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left">
          <div className="flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5 opacity-40"/>
            <span>{transaction.paymentMethod}</span>
          </div>
      </TableCell>
      <TableCell className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-60 text-left">{transaction.category}</TableCell>
      <TableCell className="text-right">
        <div className='flex items-center justify-end gap-3'>
            {transaction.hasReceipt && (
                <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 rounded-full hover:bg-primary/10 group/proof" 
                    onClick={(e) => { e.stopPropagation(); onPreviewReceipt(transaction); }}
                >
                    <Paperclip className="h-4 w-4 text-primary/40 group-hover/proof:text-primary transition-colors" />
                </Button>
            )}
            <span className={cn('font-mono text-sm md:text-base font-black tracking-tighter', {
                'text-green-600': transaction.type === 'income',
                'text-destructive': transaction.type === 'expense' || transaction.type === 'payment',
                'text-slate-400': transaction.type === 'reversal',
            })}>
                {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : transaction.type === 'reversal' ? '' : '+'}${transaction.amount.toFixed(2)}
            </span>
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
            {transaction.type === 'income' && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRefundClick(transaction); }} className="font-bold uppercase text-[10px] tracking-widest text-destructive rounded-xl h-10 px-3">
                    <Undo2 className="w-3.5 h-3.5 mr-2" /> Protocol Refund
                </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRevertClick(transaction); }} disabled={transaction.type === 'reversal'} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
                <RefreshCw className="w-3.5 h-3.5 mr-2" /> Revert Entry
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const TransactionCard = ({ transaction, staffMember, onRevertClick, onPreviewReceipt, onViewDetails, onRefundClick }: { transaction: Transaction, staffMember?: Staff, onRevertClick: (transaction: Transaction) => void, onPreviewReceipt: (t: Transaction) => void, onViewDetails: (t: Transaction) => void, onRefundClick: (t: Transaction) => void }) => {
    return (
        <Card className="border-2 shadow-sm rounded-3xl overflow-hidden group cursor-pointer" onClick={() => onViewDetails(transaction)}>
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-4">
                    <div className={cn("p-2.5 rounded-2xl shadow-inner", {
                        'bg-green-500/10': transaction.type === 'income',
                        'bg-destructive/10': transaction.type === 'expense' || transaction.type === 'payment',
                        'bg-muted': transaction.type === 'reversal'
                    })}>
                        <TransactionIcon type={transaction.type} />
                    </div>
                    <div className="flex-1 space-y-1 min-w-0 text-left">
                        <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{transaction.description}</p>
                        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-60">{transaction.clientOrVendor} &middot; {format(safeDate(transaction.date), 'MMM d, p')}</p>
                        {staffMember && (
                            <div className="flex items-center gap-2 mt-2">
                                <Avatar className="h-6 w-6 border rounded-xl shadow-sm">
                                    <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(staffMember.name || 'S').charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <span className="text-[10px] font-black uppercase text-primary tracking-tight">{staffMember.name}</span>
                            </div>
                        )}
                    </div>
                    <div className='text-right'>
                        <p className={cn('font-black font-mono text-lg tracking-tighter', {
                            'text-green-600': transaction.type === 'income',
                            'text-destructive': transaction.type === 'expense' || transaction.type === 'payment',
                            'text-slate-400': transaction.type === 'reversal',
                        })}>
                           {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : transaction.type === 'reversal' ? '' : '+'}${transaction.amount.toFixed(2)}
                        </p>
                        {transaction.hasReceipt && (
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 rounded-full hover:bg-primary/10 mt-1" 
                                onClick={(e) => { e.stopPropagation(); onPreviewReceipt(transaction); }}
                            >
                                <Paperclip className="h-4 w-4 text-primary opacity-40" />
                            </Button>
                        )}
                    </div>
                </div>
                 <div className="flex items-center justify-between pt-4 border-t border-dashed mt-2">
                    <div className='flex items-center gap-2'>
                        <Badge
                            variant="secondary"
                            className={cn("text-[9px] h-5 px-2 font-black uppercase tracking-widest border-none", {
                                'bg-indigo-100 text-indigo-800': transaction.context === 'Business',
                                'bg-purple-100 text-purple-800': transaction.context === 'Personal'
                            })}
                            >
                            {transaction.context}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-5 px-2 uppercase font-black tracking-widest text-muted-foreground/60 border-2">{transaction.category}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="text-[9px] text-muted-foreground font-black uppercase tracking-widest opacity-50 flex items-center gap-1.5">
                            <CreditCard className="w-3 h-3"/> {transaction.paymentMethod}
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button aria-haspopup="true" size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-full group-hover:bg-primary/10" onClick={e => e.stopPropagation()}>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
                                {transaction.type === 'income' && (
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRefundClick(transaction); }} className="font-bold uppercase text-[10px] tracking-widest text-destructive rounded-xl h-10 px-3">
                                        <Undo2 className="w-3.5 h-3.5 mr-2" /> Protocol Refund
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRevertClick(transaction); }} disabled={transaction.type === 'reversal'} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
                                    <RefreshCw className="w-3.5 h-3.5 mr-2" /> Revert Entry
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default function LedgerPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement>(null);

  const { transactions, staff, tillSessions, clients, isLoading: areTransactionsLoading } = useInventory();

  const [periodPreset, setPeriodPreset] = useState('30days');
  const [date, setDate] = React.useState<DateRange | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | 'Business' | 'Personal'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAddTxnOpen, setIsAddTxnOpen] = useState(false);
  const [transactionToRevert, setTransactionToRevert] = useState<Transaction | null>(null);
  const [previewTransaction, setPreviewTransaction] = useState<Transaction | null>(null);
  const [selectedTransactionForDossier, setSelectedTransactionForDossier] = useState<Transaction | null>(null);
  
  const [transactionToRefund, setTransactionToRefund] = useState<Transaction | null>(null);

  useEffect(() => {
    const now = new Date();
    switch (periodPreset) {
        case 'today':
            setDate({ from: startOfDay(now), to: endOfDay(now) });
            break;
        case '7days':
            setDate({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) });
            break;
        case '30days':
            setDate({ from: startOfDay(subDays(now, 29)), to: endOfDay(now) });
            break;
        case 'thisMonth':
            setDate({ from: startOfMonth(now), to: endOfMonth(now) });
            break;
        case 'lastMonth':
            const lastMonth = subMonths(now, 1);
            setDate({ from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) });
            break;
        case 'custom':
            // Manual
            break;
    }
  }, [periodPreset]);

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];

    return transactions
        .filter(t => {
            const transactionDate = safeDate(t.date);
            const from = date?.from ? startOfDay(date.from) : null;
            const to = date?.to ? endOfDay(date.to) : null;

            if (from && transactionDate < from) return false;
            if (to && transactionDate > to) return false;
            if (searchTerm && !(t.description.toLowerCase().includes(searchTerm.toLowerCase()) || t.clientOrVendor.toLowerCase().includes(searchTerm.toLowerCase()))) return false;
            if (contextFilter !== 'all' && t.context !== contextFilter) return false;
            if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;

            return true;
        })
        .sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());
  }, [transactions, date, searchTerm, contextFilter, categoryFilter]);
  
  const financialSummary = useMemo(() => {
    const cogsCategories = ['spoilage', 'supplies', 'Cost of Goods Sold', 'Spoilage'];
    
    const revenue = filteredTransactions
      .filter(t => t.type === 'income')
      .reduce((acc, t) => acc + t.amount, 0);

    const cogs = filteredTransactions
      .filter(t => t.type === 'expense' && cogsCategories.some(c => t.category.toLowerCase().includes(c.toLowerCase())))
      .reduce((acc, t) => acc + t.amount, 0);

    const operatingExpenses = filteredTransactions
      .filter(t => t.type === 'expense' && !cogsCategories.some(c => t.category.toLowerCase().includes(c.toLowerCase())))
      .reduce((acc, t) => acc + t.amount, 0);

    const grossProfit = revenue - cogs;
    const net = grossProfit - operatingExpenses;

    return { revenue, cogs, grossProfit, operatingExpenses, net };
  }, [filteredTransactions]);

  const handleAddTransaction = (data: Omit<Transaction, 'id'>) => {
    if (!firestore || !tenantId) return;
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
    addDocumentNonBlocking(transactionsRef, data);
    setIsAddTxnOpen(false);
  }
  
  const handleRevertTransaction = (target?: Transaction) => {
    const tToRevert = target || transactionToRevert;
    if (!tToRevert || !firestore || !tenantId) return;
    
    if (tToRevert.type === 'reversal' || tToRevert.reversalOf) {
        toast({ variant: 'destructive', title: "Cannot revert a reversal."});
        setTransactionToRevert(null);
        return;
    }

    const reversalTransaction: Omit<Transaction, 'id'> = {
      ...tToRevert,
      date: new Date().toISOString(),
      description: `Reversal of: ${tToRevert.description}`,
      type: 'reversal',
      reversalOf: tToRevert.id,
    };
    handleAddTransaction(reversalTransaction);
    toast({ title: 'Transaction Reverted', description: 'A reversal transaction has been created.' });
    setTransactionToRevert(null);
    setSelectedTransactionForDossier(null);
  }

  const handleRefundConfirm = async (data: any) => {
    if (!transactionToRefund || !firestore || !tenantId) return;
    const activeTill = tillSessions?.find(s => s.status === 'open');
    const isCash = transactionToRefund.paymentMethod.toLowerCase() === 'cash';
    
    if (isCash && !activeTill) {
        toast({ variant: 'destructive', title: 'Till Required', description: 'Cannot process cash refund without an active till session.' });
        return;
    }

    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    const refundTotal = data.amount + (data.refundTip ? (transactionToRefund.tipAmount || 0) : 0);

    // 1. Create Reversal Transaction
    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
    batch.set(txnRef, {
        id: txnRef.id,
        date: now,
        description: `Refund for: ${transactionToRefund.description}`,
        clientOrVendor: transactionToRefund.clientOrVendor,
        clientId: transactionToRefund.clientId,
        type: 'reversal',
        context: transactionToRefund.context,
        category: 'Refunds',
        amount: refundTotal,
        paymentMethod: transactionToRefund.paymentMethod,
        reversalOf: transactionToRefund.id,
        hasReceipt: false,
        notes: `Refund Reason: ${data.reason}`
    });

    // 2. Update Till Session (If Cash)
    if (isCash && activeTill) {
        const updates: any = {
            expectedCash: increment(-refundTotal),
            totalCashRefunds: increment(refundTotal)
        };
        
        if (data.refundTip && data.tipStrategy === 'clawback' && transactionToRefund.staffId) {
            updates[`cashTipsByStaff.${transactionToRefund.staffId}`] = increment(-(transactionToRefund.tipAmount || 0));
            updates.totalCashTips = increment(-(transactionToRefund.tipAmount || 0));
        }
        
        batch.update(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), updates);
    }

    // 3. Optional Incident Report
    if (data.logIncident && transactionToRefund.clientId) {
        const incidentId = nanoid();
        const clientRef = doc(firestore, `tenants/${tenantId}/clients`, transactionToRefund.clientId);
        const incident: Incident = {
            id: incidentId,
            date: now,
            type: 'Refund Incident',
            severity: 'Moderate',
            description: `Automatic incident filed during refund process. Original Transaction: ${transactionToRefund.id}. Reason: ${data.reason}`,
            actionsTaken: `Revenue reversed: $${refundTotal.toFixed(2)} via ${transactionToRefund.paymentMethod}.`
        };
        batch.update(clientRef, {
            'intel.incidents': arrayUnion(incident),
            'intel.hasIncidents': true
        });
    }

    try {
        await batch.commit();
        toast({ title: "Refund Authorized", description: `Record reversal of $${refundTotal.toFixed(2)} synchronized.` });
        setTransactionToRefund(null);
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: "Process Error" });
    }
  };
  
  const handlePrint = () => {
    window.print();
  };
  
  const isLoading = areTransactionsLoading;

  return (
    <>
    <div className="no-print flex min-h-screen w-full flex-col overflow-x-hidden bg-background">
      <AppHeader title="Studio Ledger" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
            <div className="space-y-1 text-left">
                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">The Ledger</h1>
                <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
                    Official financial audit trail
                </p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
                <Button variant="outline" onClick={handlePrint} className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm"><Printer className='mr-2 h-4 w-4' /> Print Log</Button>
                <Button onClick={() => setIsAddTxnOpen(true)} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20"><PlusCircle className='mr-2 h-4 w-4' /> New Entry</Button>
            </div>
        </div>

        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8 items-start">
          <div className="md:col-span-1 lg:col-span-1">
            {isMobile ? (
                <Accordion type="single" collapsible className="w-full mb-6">
                    <AccordionItem value="filters" className="border-none">
                        <AccordionTrigger className="p-5 bg-primary/5 rounded-[2rem] border-2 border-primary/10 hover:no-underline shadow-sm">
                            <div className="flex items-center gap-3">
                                <Filter className="w-5 h-5 text-primary" />
                                <span className="font-black uppercase text-xs tracking-widest text-primary">Summary & Filters</span>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-6">
                            <TransactionFilters 
                                transactions={transactions || []}
                                date={date}
                                setDate={setDate}
                                periodPreset={periodPreset}
                                setPeriodPreset={setPeriodPreset}
                                searchTerm={searchTerm}
                                setSearchTerm={setSearchTerm}
                                contextFilter={contextFilter}
                                setContextFilter={setContextFilter}
                                categoryFilter={categoryFilter}
                                setCategoryFilter={setCategoryFilter}
                                financialSummary={financialSummary}
                            />
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            ) : (
                <TransactionFilters 
                    transactions={transactions || []}
                    date={date}
                    setDate={setDate}
                    periodPreset={periodPreset}
                    setPeriodPreset={setPeriodPreset}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    contextFilter={contextFilter}
                    setContextFilter={setContextFilter}
                    categoryFilter={categoryFilter}
                    setCategoryFilter={setCategoryFilter}
                    financialSummary={financialSummary}
                />
            )}
          </div>
          
          <div className="md:col-span-2 lg:col-span-3 space-y-6 min-w-0 text-left">
            <Card className="hidden md:block border-2 shadow-2xl rounded-[2.5rem] overflow-hidden">
              <CardContent className='p-0 overflow-x-auto'>
                <Table>
                  <TableHeader className="bg-muted/30 border-b-2">
                    <TableRow>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] p-6 text-slate-900">Description & Entity</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Timestamp</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Provider</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Context</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Account</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Category</TableHead>
                      <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-primary pr-10">Amount</TableHead>
                      <TableHead><span className='sr-only'>Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                        <TableRow>
                            <TableCell colSpan={8} className="h-64 text-center">
                                <div className="flex flex-col items-center gap-4">
                                    <Loader className="w-10 h-10 animate-spin text-primary" />
                                    <p className="font-black uppercase text-[10px] tracking-widest text-primary opacity-60">Synchronizing Ledger...</p>
                                </div>
                            </TableCell>
                        </TableRow>
                    )}
                    {!isLoading && filteredTransactions.map((transaction) => (
                      <TransactionRow 
                        key={transaction.id} 
                        transaction={transaction} 
                        staffMember={staff.find(s => s.id === transaction.staffId)}
                        onRevertClick={() => setTransactionToRevert(transaction)} 
                        onPreviewReceipt={(t) => setPreviewTransaction(t)}
                        onViewDetails={(t) => setSelectedTransactionForDossier(t)}
                        onRefundClick={setTransactionToRefund}
                      />
                    ))}
                     {!isLoading && filteredTransactions.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={8} className="h-64 text-center">
                                <div className="space-y-2 opacity-30">
                                    <BookOpen className="w-12 h-12 mx-auto" />
                                    <p className="uppercase font-black tracking-widest text-xs">No records found for this period</p>
                                </div>
                            </TableCell>
                        </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="md:hidden space-y-4">
                 {isLoading && (
                    <div className="flex flex-col items-center justify-center py-24">
                        <Loader className="w-10 h-10 animate-spin text-primary mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary">Syncing Ledger...</p>
                    </div>
                 )}
                 {!isLoading && filteredTransactions.length > 0 ? (
                    <div className="grid gap-4">
                        {filteredTransactions.map((transaction) => (
                            <TransactionCard 
                                key={transaction.id} 
                                transaction={transaction} 
                                staffMember={staff.find(s => s.id === transaction.staffId)}
                                onRevertClick={() => setTransactionToRevert(transaction)} 
                                onPreviewReceipt={(t) => setPreviewTransaction(t)}
                                onViewDetails={(t) => setSelectedTransactionForDossier(t)}
                                onRefundClick={setTransactionToRefund}
                            />
                        ))}
                    </div>
                 ) : !isLoading && (
                    <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                        <BookOpen className="w-16 h-16" />
                        <p className="text-sm font-black uppercase tracking-widest">No entries found</p>
                    </div>
                 )}
            </div>
          </div>
        </div>
      </main>
    </div>

    <div className="print-only">
        <PrintableReport 
            ref={reportRef} 
            transactions={filteredTransactions} 
            staff={staff || []}
            financialSummary={financialSummary} 
            dateRange={date} 
        />
    </div>

     <style jsx global>{`
      .print-only {
        display: none;
      }
      @media print {
        .no-print {
          display: none;
        }
        .print-only {
          display: block;
        }
      }
    `}</style>

    <AddTransactionDialog 
        open={isAddTxnOpen}
        onOpenChange={setIsAddTxnOpen}
        staff={staff || []}
        onConfirm={handleAddTransaction}
    />
    
    <AlertDialog open={!!transactionToRevert} onOpenChange={() => setTransactionToRevert(null)}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
            <AlertDialogHeader className="p-6 pb-0">
            <AlertDialogTitle className="font-black uppercase tracking-tighter text-2xl">Confirm Reversal</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed text-left uppercase tracking-tight">
                You are about to create an audit-trail reversal for &quot;{transactionToRevert?.description}&quot;. This will permanently record an opposite entry to zero-out this balance.
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3 text-left">
                <Button onClick={() => handleRevertTransaction()} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">Yes, Revert Entry</Button>
                <AlertDialogCancel onClick={() => setTransactionToRevert(null)} className="w-full h-12 rounded-xl font-bold uppercase text-[9px] md:text-[10px] tracking-widest border-none bg-transparent">Cancel</AlertDialogCancel>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>

    {previewTransaction && (
        <ReceiptPreviewDialog 
            open={!!previewTransaction} 
            onOpenChange={() => setPreviewTransaction(null)} 
            url={previewTransaction.receiptUrl || ''} 
            description={previewTransaction.description} 
        />
    )}

    <TransactionDossierSheet 
        open={!!selectedTransactionForDossier} 
        onOpenChange={() => setSelectedTransactionForDossier(null)} 
        transaction={selectedTransactionForDossier} 
        staff={staff}
        onRevert={handleRevertTransaction}
    />

    <RefundProtocolDialog 
        open={!!transactionToRefund}
        onOpenChange={(v: any) => !v && setTransactionToRefund(null)}
        transaction={transactionToRefund}
        staff={staff}
        onConfirm={handleRefundConfirm}
    />
    </>
  );
}
