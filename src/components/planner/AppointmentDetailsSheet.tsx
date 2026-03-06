'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds } from 'date-fns';
import {
  Award,
  MoreHorizontal,
  DollarSign,
  Clock,
  FileText,
  FlaskConical,
  Edit,
  Trash2,
  CheckCircle,
  TrendingUp,
  Mail,
  Phone,
  User as UserIcon,
  Calendar as CalendarIcon,
  Users,
  Play,
  Square,
  Repeat,
  Link as LinkIcon,
  MapPin,
  PlusCircle,
  XCircle,
  ShieldCheck,
  Ban,
  Wallet,
  KeyRound,
  Fingerprint,
  ShieldAlert,
  Loader,
  Check,
  Workflow,
  Zap,
  Sparkles,
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '../ui/separator';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, type Staff } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc, writeBatch, arrayUnion, increment, collection } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

export const AppointmentDetailsSheet: React.FC<any> = ({
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
  onOverride,
  onWaiveFee,
}) => {
  const isMobile = useIsMobile();
  const { inventory, services: allServices, staff } = useInventory();
  const { role, selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const { firestore } = useFirebase();
  
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);
  const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment?.status === 'servicing' && appointment.actualStartTime) {
      const startTime = safeDate(appointment.actualStartTime);
      const update = () => {
        const diff = differenceInSeconds(new Date(), startTime);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        setElapsedTime(h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`);
        setIsRunningOver(Math.floor(diff / 60) > (service?.duration || 0));
      };
      update(); timer = setInterval(update, 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment?.status, appointment?.actualStartTime, service?.duration]);

  const financialData = useMemo(() => {
    if (!appointment || !service) return null;
    const isCompleted = appointment.status === 'completed';
    const addOns = (appointment.addOnIds || []).map(id => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
    const allServicesInApt = [service, ...addOns];
    const assignedStaffMember = staff.find(s => s.id === appointment.staffId);

    const productCost = allServicesInApt.flatMap(s => s?.products || []).reduce((acc: number, p: any) => {
      const product = inventory.find(i => i.id === p.id);
      if (!product) return acc;
      let costPerUse = (product.costingMethod === 'size' && product.size) ? (product.costPerUnit || 0) / product.size : (product.estimatedUses ? (product.costPerUnit || 0) / product.estimatedUses : (product.costPerUnit || 0));
      return acc + (costPerUse * (p.quantityUsed || 1));
    }, 0);

    const start = safeDate(appointment.actualStartTime || appointment.startTime);
    const end = safeDate(appointment.actualEndTime || appointment.endTime);
    const actualDuration = appointment.actualEndTime ? differenceInMinutes(end, start) : allServicesInApt.reduce((acc, s) => acc + (s?.duration || 0), 0);
    const timeCost = ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const breakEven = timeCost + productCost;
    const revenue = isCompleted ? transactions.filter(t => t.appointmentId === appointment.id && t.category === 'Service Revenue').reduce((acc, t) => acc + t.amount, 0) : allServicesInApt.reduce((acc, s) => acc + (service.pricingTiers?.find(t => t.tierId === assignedStaffMember?.pricingTierId)?.price || s.price), 0);

    return { revenue, breakEven, profit: revenue - breakEven };
  }, [appointment, service, tmhr, inventory, transactions, allServices, staff]);

  if (!client || !service || !appointment) return null;

  const handleCopyCheckInLink = () => {
    if (appointment.checkInToken) {
      navigator.clipboard.writeText(`${window.location.origin}/check-in/${appointment.checkInToken}`);
      toast({ title: "Link Copied" });
    }
  };

  const handleUpdateAddOns = async (newAddOns: Service[]) => {
    if (!firestore || !tenantId || !appointment) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
    const newIds = newAddOns.map(s => s.id);
    updateDocumentNonBlocking(appointmentRef, { addOnIds: newIds });
    toast({ title: "Appointment Updated", description: "Extra parts added to the session." });
  };

  const currentAddOns = (appointment.addOnIds || []).map(id => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
  const ticketId = appointment.id.slice(-6).toUpperCase();

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn(isMobile ? "h-[95vh] rounded-t-[3rem]" : "sm:max-w-xl", "flex flex-col p-0 border-none bg-background shadow-2xl")}>
        <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Session Dossier</span>
          </div>
          <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Session Summary</SheetTitle>
          <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60">ID: {ticketId}</SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="flex-1">
          <div className="p-8 space-y-10 pb-32">
            {appointment.status === 'confirmed' && (
              <Button onClick={() => onStartService(appointment.id)} className="w-full h-16 rounded-[2rem] text-lg font-black uppercase shadow-2xl shadow-primary/20" size="lg">
                <Play className="mr-3 h-6 w-6" /> Start Session
              </Button>
            )}
            
            {appointment.status === 'servicing' && (
              <div className="space-y-4">
                <Button onClick={() => onFinishService(appointment)} className="w-full h-16 rounded-[2rem] text-lg font-black uppercase shadow-2xl shadow-primary/20" size="lg">
                    <Square className="mr-3 h-6 w-6" /> Finish Service
                </Button>
                {elapsedTime && (
                  <div className={cn("p-6 rounded-[2rem] border-4 text-center transition-all", isRunningOver ? "bg-destructive/5 border-destructive animate-pulse" : "bg-primary/5 border-primary/20")}>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-2">Live Session Time</p>
                    <p className={cn("text-5xl font-black font-mono tracking-tighter", isRunningOver ? "text-destructive" : "text-primary")}>{elapsedTime}</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-8">
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6">
                    <Avatar className="w-24 h-24 border-4 border-background shadow-2xl rounded-[2.5rem]">
                        <AvatarImage src={client.avatarUrl} className="object-cover" />
                        <AvatarFallback className="text-2xl font-black bg-primary/10 text-primary">{client.name.substring(0,2)}</AvatarFallback>
                    </Avatar>
                    <div className="space-y-2 flex-1 min-w-0">
                        <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 truncate">{client.name}</h2>
                        <div className="flex flex-wrap justify-center sm:justify-start gap-3">
                            <Badge variant="outline" className="h-6 px-3 rounded-full font-black uppercase text-[9px] tracking-widest border-2"><UserIcon className="w-3 h-3 mr-1.5 opacity-40"/> Guest Account</Badge>
                            {client.activeMembershipId && <Badge className="h-6 px-3 rounded-full font-black uppercase text-[9px] tracking-widest bg-indigo-600 text-white border-none shadow-md"><Award className="w-3 h-3 mr-1.5" /> Studio Member</Badge>}
                        </div>
                    </div>
                </div>

                {client.outstandingBalance && client.outstandingBalance > 0 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-4 rounded-[2rem] p-6 shadow-xl shadow-destructive/5">
                            <Wallet className="h-6 w-6" />
                            <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Accounting Alert</AlertTitle>
                            <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase">
                                Client has an outstanding balance of <strong>${client.outstandingBalance.toFixed(2)}</strong>. Settle at checkout.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Button variant="outline" className="h-12 rounded-2xl border-2 font-bold justify-start" asChild><Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-4 w-4" /> Client Profile</Link></Button>
                    <Button variant="outline" className="h-12 rounded-2xl border-2 font-bold justify-start" onClick={handleCopyCheckInLink}><LinkIcon className="mr-2 h-4 w-4" /> Copy Link</Button>
                </div>
            </div>

            <Separator className="bg-muted/50" />

            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground opacity-60">Treatment Details</h3>
                    <Button variant="ghost" size="sm" onClick={() => setIsAddOnSelectorOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                        <PlusCircle className="w-3 h-3 mr-1.5" />
                        Add Part
                    </Button>
                </div>
                <Card className="rounded-[2.5rem] border-2 bg-muted/5 shadow-inner overflow-hidden">
                    <CardContent className="p-6 space-y-6">
                        <div className="flex justify-between items-start gap-4">
                            <div className="space-y-1">
                                <p className="font-black text-xl uppercase tracking-tight text-slate-900 leading-tight">{service.name}</p>
                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                    <Clock className="w-3 h-3" /> {service.duration}m duration
                                </div>
                            </div>
                            <p className="text-2xl font-black text-primary tracking-tighter font-mono">${financialData?.revenue.toFixed(2)}</p>
                        </div>
                        {(appointment.addOnIds || []).length > 0 && (
                            <div className="space-y-2 pt-4 border-t border-dashed">
                                <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Add-ons Applied</p>
                                {(appointment.addOnIds || []).map(id => {
                                    const s = allServices.find(svc => svc.id === id);
                                    return s ? <div key={id} className="flex justify-between text-sm font-bold uppercase tracking-tight text-slate-600"><span>+ {s.name}</span><span>${s.price.toFixed(2)}</span></div> : null;
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {isOwnerOrAdmin && financialData && (
                <div className="space-y-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground opacity-60">Yield Analysis</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-5 rounded-[2rem] bg-primary/5 border-2 border-primary/10 space-y-1">
                            <p className="text-[9px] font-black uppercase tracking-widest text-primary opacity-60">Gross Yield</p>
                            <p className="text-2xl font-black font-mono tracking-tighter text-primary">${financialData.revenue.toFixed(2)}</p>
                        </div>
                        <div className="p-5 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 space-y-1 text-right">
                            <p className="text-[9px] font-black uppercase tracking-widest text-destructive opacity-60">Est. COGS</p>
                            <p className="text-2xl font-black font-mono tracking-tighter text-destructive">${financialData.breakEven.toFixed(2)}</p>
                        </div>
                        <div className={cn("col-span-2 p-6 rounded-[2rem] border-4 flex justify-between items-center", financialData.profit >= 0 ? "bg-green-500/5 border-green-500/20 text-green-700" : "bg-destructive/5 border-destructive/20 text-destructive")}>
                            <div className="space-y-0.5 text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Net Transaction Profit</p>
                                <p className="text-3xl font-black tracking-tighter font-mono">${financialData.profit.toFixed(2)}</p>
                            </div>
                            <div className="p-3 bg-white rounded-2xl shadow-inner"><TrendingUp className="w-6 h-6" /></div>
                        </div>
                    </div>
                </div>
            )}

            <div className="space-y-6">
                <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground opacity-60">Health & Intel</h3>
                <div className="space-y-3">
                    {client.medicalNotes && <Alert variant="destructive" className="border-2 rounded-2xl bg-red-500/5"><ShieldAlert className="h-4 w-4" /><AlertTitle className="text-[10px] font-black uppercase">Medical Alert</AlertTitle><AlertDescription className="text-xs font-bold opacity-80">{client.medicalNotes}</AlertDescription></Alert>}
                    {client.allergyNotes && <Alert variant="destructive" className="border-2 rounded-2xl bg-amber-500/5 text-amber-700 border-amber-200"><AlertTriangle className="h-4 w-4" /><AlertTitle className="text-[10px] font-black uppercase">Allergy Warning</AlertTitle><AlertDescription className="text-xs font-bold opacity-80">{client.allergyNotes}</AlertDescription></Alert>}
                    <Card className="rounded-[2rem] border-2 bg-muted/5">
                        <CardHeader className="p-5 pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> Discovery Notes</CardTitle></CardHeader>
                        <CardContent className="p-5 pt-0"><p className="text-xs font-medium text-slate-600 leading-relaxed italic">"{client.notes?.general || 'No session notes provided.'}"</p></CardContent>
                    </Card>
                </div>
            </div>
          </div>
        </ScrollArea>
        <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
          <div className="grid grid-cols-2 gap-4 w-full">
            <Button variant="outline" className="h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2" onClick={() => { onOpenChange(false); setTimeout(() => onEdit(appointment), 150); }}>Edit Dossier</Button>
            <Button variant="ghost" className="h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest text-destructive hover:bg-destructive/5" onClick={() => { onOpenChange(false); onDelete(appointment.id); }}>Delete Permanently</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <SelectAddOnsDialog 
        open={isAddOnSelectorOpen} 
        onOpenChange={setIsAddOnSelectorOpen} 
        allAddOns={allServices.filter(s => s.type === 'addon')} 
        initialSelected={currentAddOns} 
        onSelect={handleUpdateAddOns} 
    />
    </>
  );
};
