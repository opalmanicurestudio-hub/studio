'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds } from 'date-fns';
import {
  ShieldPlus,
  AlertTriangle,
  Ear,
  Award,
  MoreHorizontal,
  DollarSign,
  Clock,
  Briefcase,
  FileText,
  FlaskConical,
  Edit,
  Trash2,
  CheckCircle,
  Printer,
  TrendingUp,
  Mail,
  Phone,
  MessageSquare,
  Send,
  User as UserIcon,
  Book,
  Calendar,
  FileText as TicketIcon,
  Users,
  Play,
  Square,
  Repeat,
  Link as LinkIcon,
  Building,
  HardHat,
  MapPin,
  PlusCircle,
  XCircle,
  ShieldCheck,
  Ban,
  Wallet,
  KeyRound,
  Fingerprint,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, Resource, type Transaction, getServicePrice, Staff } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import Image from 'next/image';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

interface WaiveFeeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    feeAmount: number;
    staff: Staff[];
    onConfirm: (staffMember: Staff, reason: string) => void;
}

const WaiveFeeDialog = ({ open, onOpenChange, feeAmount, staff, onConfirm }: WaiveFeeDialogProps) => {
    const [pin, setPin] = useState('');
    const [reason, setReason] = useState('');
    const { toast } = useToast();

    const handleConfirm = () => {
        // SECURITY: Strictly check for admin role
        const authorizedStaff = staff.find(s => s.pin === pin && s.role === 'admin');
        if (!authorizedStaff) {
            toast({ 
                variant: 'destructive', 
                title: 'Unauthorized', 
                description: 'Invalid PIN or insufficient permissions. Admin authorization required.' 
            });
            return;
        }
        if (!reason.trim()) {
            toast({ variant: 'destructive', title: 'Reason Required' });
            return;
        }
        onConfirm(authorizedStaff, reason);
        setPin('');
        setReason('');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                        Waive Cancellation Fee
                    </DialogTitle>
                    <DialogDescription>Authorize the waiver of ${feeAmount.toFixed(2)} with a manager PIN.</DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label className="text-center block font-black uppercase text-[10px] tracking-widest text-muted-foreground">Admin/Owner PIN</Label>
                        <div className="flex justify-center">
                            <Input 
                                type="password" 
                                maxLength={4} 
                                className="text-center text-3xl font-black h-14 w-48 tracking-[0.5em] bg-muted/50 border-2" 
                                value={pin} 
                                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="waive-reason">Reason for Waiver</Label>
                        <Textarea id="waive-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Provide reasoning..." />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()}>Waive Fee</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

interface AppointmentDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  client: Client | null;
  service: Service | null;
  tmhr: number;
  transactions: Transaction[];
  onStartService: (id: string) => void;
  onFinishService: (apt: Appointment) => void;
  onEdit: (apt: Appointment) => void;
  onDelete: (id: string) => void;
  onCancel: (id: string) => void;
  onReschedule: (apt: Appointment) => void;
  onRebook: (apt: Appointment) => void;
  onBookNewForClient: (clientId: string) => void;
  onPrintTicket: (data: any) => void;
  onOverride: () => void;
  onWaiveFee: (id: string, authorizer: Staff, reason: string) => void;
}

export const AppointmentDetailsSheet: React.FC<AppointmentDetailsSheetProps> = ({
  open,
  onOpenChange,
  appointment,
  client,
  service,
  tmhr,
  transactions,
  onStartService,
  onFinishService,
  onEdit,
  onDelete,
  onCancel,
  onReschedule,
  onRebook,
  onBookNewForClient,
  onPrintTicket,
  onOverride,
  onWaiveFee,
}) => {
  const isMobile = useIsMobile();
  const { inventory, services: allServices, resources, staff } = useInventory();
  const { role, user } = useTenant();
  const { toast } = useToast();
  const [isWaiveDialogOpen, setIsWaiveDialogOpen] = useState(false);
  
  const canPerformAdminActions = role === 'owner' || role === 'admin' || role === 'staff';
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment?.status === 'servicing' && appointment.actualStartTime) {
      const startTime = typeof appointment.actualStartTime === 'string' ? parseISO(appointment.actualStartTime) : appointment.actualStartTime;
      const interval = setInterval(() => {
        const now = new Date();
        const diffInSeconds = differenceInSeconds(now, startTime);
        const hours = Math.floor(diffInSeconds / 3600);
        const minutes = Math.floor((diffInSeconds % 3600) / 60);
        const seconds = diffInSeconds % 60;
        setElapsedTime(hours > 0 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
        setIsRunningOver(Math.floor(diffInSeconds / 60) > (service?.duration || 0));
      }, 1000);
      timer = interval;
    } else {
      setElapsedTime(null);
      setIsRunningOver(false);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment?.status, appointment?.actualStartTime, service?.duration]);

  const handleCopyCheckInLink = () => {
    if (appointment?.checkInToken) {
      const link = `${window.location.origin}/check-in/${appointment.checkInToken}`;
      navigator.clipboard.writeText(link);
      toast({
        title: "Link Copied",
        description: "The check-in link has been copied to your clipboard.",
      });
    }
  };

  const financialData = useMemo(() => {
    if (!appointment || !service) return null;
    const isCompleted = appointment.status === 'completed';
    const addOns = (appointment.addOnIds || []).map(id => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
    const allServicesInApt = [service, ...addOns];
    const assignedStaffMember = staff.find(s => s.id === appointment.staffId);

    const formulaForCosting = (isCompleted && appointment.checkoutState?.formula) 
        ? appointment.checkoutState.formula 
        : allServicesInApt.flatMap(s => s?.products || []).map(p => ({ id: p.id, quantityUsed: p.quantityUsed }));

    const productCost = formulaForCosting.reduce((acc: number, p: any) => {
      const product = inventory.find(i => i.id === p.id);
      if (!product) return acc;
      const quantity = p.quantityUsed || 1;
      let costPerUse = 0;
      if (product.costingMethod === 'size' && product.size && product.size > 0) costPerUse = (product.costPerUnit || 0) / product.size;
      else if (product.costingMethod === 'uses' && product.estimatedUses && product.estimatedUses > 0) costPerUse = (product.costPerUnit || 0) / product.estimatedUses;
      else costPerUse = product.costPerUnit || 0;
      return acc + (costPerUse * quantity);
    }, 0);

    const actualDuration = appointment.actualEndTime && appointment.actualStartTime
        ? differenceInMinutes(new Date(appointment.actualEndTime), new Date(appointment.actualStartTime))
        : allServicesInApt.reduce((acc, s) => acc + (s?.duration || 0), 0);
    
    const timeCost = ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const breakEven = timeCost + productCost;
    
    const revenue = isCompleted 
        ? transactions.filter(t => t.appointmentId === appointment.id && t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0) 
        : allServicesInApt.reduce((acc, s) => acc + getServicePrice(s, assignedStaffMember), 0);

    return { revenue, breakEven, profit: revenue - breakEven, timeCost, productCost };
  }, [appointment, service, tmhr, inventory, transactions, allServices, staff]);

  if (!appointment || !client || !service) return null;

  const ticketId = appointment.id.slice(-6).toUpperCase();

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[90vh]" : "sm:max-w-md", "flex flex-col p-0")}>
        <SheetHeader className="p-6 pb-0">
          <SheetTitle>Appointment Details</SheetTitle>
          <SheetDescription>A full breakdown of this appointment.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {appointment.isPotentialAlias && (
                <div className="mb-6 p-4 rounded-xl border-4 border-destructive bg-destructive/10 text-destructive animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-destructive rounded-full">
                            <Fingerprint className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h3 className="font-black uppercase tracking-tighter text-sm">Identity Match Warning</h3>
                            <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">Potential Restricted Profile</p>
                        </div>
                    </div>
                    <Alert variant="destructive" className="bg-white border-destructive text-destructive mt-3 shadow-xl">
                        <ShieldAlert className="h-4 w-4" />
                        <AlertTitle className="text-xs font-black uppercase">Verify Physical ID</AlertTitle>
                        <AlertDescription className="text-xs space-y-3">
                            <p>This guest's name matches a restricted profile (Banned or Owed Balance) under a different email/phone.</p>
                            <div className="flex gap-2">
                                <Button variant="destructive" size="sm" className="h-8 font-black text-[10px] flex-1">Merge & Enforce</Button>
                                <Button variant="outline" size="sm" className="h-8 font-bold text-[10px] flex-1">Not a Match</Button>
                            </div>
                        </AlertDescription>
                    </Alert>
                </div>
            )}

            {appointment.status === 'confirmed' && (
              <Button onClick={() => onStartService(appointment.id)} className="w-full h-12" size="lg">
                <Play className="mr-2 h-4 w-4" /> Start Service
              </Button>
            )}
            {appointment.status === 'servicing' && (
              <div className="space-y-3">
                <Button onClick={() => onFinishService(appointment)} className="w-full h-12" size="lg" variant="default">
                  <Square className="mr-2 h-4 w-4" /> Finish Service
                </Button>
                {elapsedTime && (
                  <div className={cn("p-4 rounded-xl border-2 text-center transition-all", isRunningOver ? "bg-destructive/10 border-destructive text-destructive animate-pulse" : "bg-primary/5 border-primary/20 text-primary")}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1">Service Time Elapsed</p>
                    <p className="text-4xl font-black font-mono">{elapsedTime}</p>
                    {isRunningOver && <p className="text-[10px] font-bold mt-1 uppercase">Exceeding scheduled time</p>}
                  </div>
                )}
              </div>
            )}

            {appointment.status === 'cancelled' && (
                <Alert className={cn(appointment.checkInStatus === 'auto_cancelled' ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-muted")}>
                    {appointment.checkInStatus === 'auto_cancelled' ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                    <AlertTitle>{appointment.checkInStatus === 'auto_cancelled' ? 'Auto-Cancelled (Late)' : 'Manual Cancellation'}</AlertTitle>
                    <AlertDescription className="space-y-3">
                        <p className="text-xs">Reason: {appointment.cancellationReason?.replace('_', ' ') || 'None provided.'}</p>
                        {appointment.cancellationFeeApplied && !appointment.cancellationFeeWaived && (
                            <div className="p-3 bg-background rounded-lg border flex justify-between items-center">
                                <div>
                                    <p className="text-[10px] font-black uppercase text-muted-foreground">Cancellation Fee</p>
                                    <p className="font-bold text-base text-destructive">${appointment.cancellationFeeApplied.toFixed(2)}</p>
                                </div>
                                {canPerformAdminActions && (
                                    <Button variant="outline" size="sm" onClick={() => setIsWaiveDialogOpen(true)} className="h-8">Waive Fee</Button>
                                )}
                            </div>
                        )}
                        {appointment.cancellationFeeWaived && (
                            <div className="p-3 border rounded-lg bg-green-50 text-green-800">
                                <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">Fee Absorbed</Badge>
                                <p className="text-[10px] mt-2 italic">"{appointment.waivedReason}" — Authorizer PIN applied.</p>
                            </div>
                        )}
                        {appointment.checkInStatus === 'auto_cancelled' && canPerformAdminActions && (
                            <Button variant="outline" size="sm" onClick={onOverride} className="w-full h-9 font-bold bg-white text-destructive border-destructive hover:bg-destructive hover:text-white transition-all">
                                Override & Restore
                            </Button>
                        )}
                    </AlertDescription>
                </Alert>
            )}

            {client.outstandingBalance && client.outstandingBalance > 0 && (
                <Alert className="border-destructive/20 bg-destructive/5">
                    <Wallet className="h-4 w-4 text-destructive" />
                    <AlertTitle className="text-xs font-black uppercase text-destructive">Owes Balance</AlertTitle>
                    <AlertDescription className="text-xs">
                        This client has an outstanding balance of <strong>${client.outstandingBalance.toFixed(2)}</strong>.
                    </AlertDescription>
                </Alert>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-xl tracking-tight">{client.name}</h3>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1.5 uppercase tracking-wider">
                      <TicketIcon className="w-3 h-3" />
                      Ticket ID: {ticketId}
                    </p>
                    {appointment.status === 'ready_for_checkout' && <Badge className="bg-orange-500 hover:bg-orange-600">Checkout Ready</Badge>}
                    {appointment.status === 'cancelled' && <Badge variant="destructive">Cancelled</Badge>}
                  </div>
                </div>
              </div>
              {isOwnerOrAdmin || role === 'staff' ? (
                <div className="text-muted-foreground text-sm space-y-1.5 pt-2">
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4" /> {client.email}</div>
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4" /> {client.phone}</div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic pt-2">Contact info restricted by business owner.</p>
              )}
              <div className="text-muted-foreground text-sm pt-4 space-y-3">
                <div>
                  <p className='font-bold text-foreground text-base'>{service.name}</p>
                  {(appointment.addOnIds || []).map(id => {
                    const addon = allServices.find(s => s.id === id);
                    return addon ? <p key={addon.id} className="text-sm pl-4 text-muted-foreground/80 font-medium">+ {addon.name}</p> : null;
                  })}
                </div>
                <div className='flex flex-col p-3 rounded-lg border bg-muted/30'>
                  <span className='font-bold text-foreground'>{format(new Date(appointment.startTime), 'EEEE, MMM d, yyyy')}</span>
                  <span className="text-xs">{format(new Date(appointment.startTime), 'h:mm a')} - {format(new Date(appointment.endTime), 'h:mm a')}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
                <Button variant="outline" className="w-full justify-start h-11" onClick={handleCopyCheckInLink}>
                    <LinkIcon className="mr-2 h-4 w-4" /> Copy Check-in Link
                </Button>
                <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-start h-11">
                    <MoreHorizontal className="mr-2 h-4 w-4" /> More Actions
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuItem asChild><Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-4 w-4"/>View Client Profile</Link></DropdownMenuItem>
                    {canPerformAdminActions && (
                    <>
                        <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onEdit(appointment), 150); }}><Edit className="mr-2 h-4 w-4"/>Edit Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onReschedule(appointment), 150); }} disabled={appointment.status === 'completed' || appointment.status === 'cancelled'}><Calendar className="mr-2 h-4 w-4"/>Reschedule</DropdownMenuItem>
                    </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onRebook(appointment), 150); }}><Repeat className="mr-2 h-4 w-4"/>Rebook Service</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { onOpenChange(false); setTimeout(() => onBookNewForClient(client.id), 150); }}><PlusCircle className="mr-2 h-4 w-4"/>Book New</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onPrintTicket({ appointment, client, service })}><Printer className="mr-2 h-4 w-4"/>Print Ticket</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {canPerformAdminActions && (
                        <>
                            <DropdownMenuItem onClick={() => { onOpenChange(false); onCancel(appointment.id); }} disabled={appointment.status === 'completed' || appointment.status === 'cancelled'}>
                                <XCircle className="mr-2 h-4 w-4" /> Cancel Appointment
                            </DropdownMenuItem>
                            {isOwnerOrAdmin && (
                                <DropdownMenuItem className="text-destructive" onClick={() => { onOpenChange(false); onDelete(appointment.id); }}>
                                    <Trash2 className="mr-2 h-4 w-4"/>Delete Permanently
                                </DropdownMenuItem>
                            )}
                        </>
                    )}
                </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <Separator />

            {isOwnerOrAdmin && financialData && (
              <div className="space-y-4">
                <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2"><DollarSign className="w-3 h-3"/> Financial Performance</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border-2 p-3 bg-muted/20">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Revenue</p>
                    <p className="font-black text-xl text-primary">${financialData.revenue.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border-2 p-3 bg-muted/20">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Est. Cost</p>
                    <p className="font-black text-xl text-destructive">${financialData.breakEven.toFixed(2)}</p>
                  </div>
                  <div className={cn("rounded-xl border-2 p-3 col-span-2 flex justify-between items-center", financialData.profit >= 0 ? "bg-green-500/5 border-green-500/20" : "bg-destructive/5 border-destructive/20")}>
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Actual Net Profit</p>
                    <p className={cn("font-black text-2xl", financialData.profit >= 0 ? "text-green-600" : "text-destructive")}>${financialData.profit.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2"><FlaskConical className="w-3 h-3"/> Service Intel</h4>
              {(client.customFormulas && client.customFormulas.length > 0) && (
                <div className='p-3 rounded-xl border-2 bg-blue-500/5 border-blue-500/10 space-y-2'>
                  <p className='font-black text-[10px] uppercase text-blue-600'>Formula: {client.customFormulas[0].name}</p>
                  {client.customFormulas[0].items.map((item, idx) => (
                    <div key={idx} className='text-xs flex justify-between'>
                      <span className='font-bold'>{item.productName}</span>
                      <span className='font-mono'>{item.quantityUsed}{item.unit}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {client.medicalNotes && <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 text-red-700 text-xs font-bold border border-red-500/10"><ShieldPlus className="w-4 h-4 shrink-0"/><p>{client.medicalNotes}</p></div>}
                {client.allergyNotes && <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 text-amber-700 text-xs font-bold border border-amber-500/10"><AlertTriangle className="h-4 w-4 shrink-0"/><p>{client.allergyNotes}</p></div>}
                {client.sensoryNeeds && <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-500/5 text-blue-700 text-xs font-bold border border-blue-500/10"><Ear className="w-4 h-4 shrink-0"/><p>{client.sensoryNeeds}</p></div>}
              </div>
            </div>
          </div>
        </ScrollArea>
        <SheetFooter className="p-6 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <WaiveFeeDialog 
        open={isWaiveDialogOpen} 
        onOpenChange={setIsWaiveDialogOpen} 
        feeAmount={appointment.cancellationFeeApplied || 0} 
        staff={staff}
        onConfirm={(authorizer, reason) => {
            onWaiveFee(appointment.id, authorizer, reason);
            setIsWaiveDialogOpen(false);
        }}
    />
    </>
  );
};
