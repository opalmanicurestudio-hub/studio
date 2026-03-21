
'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds } from 'date-fns';
import {
  Award,
  DollarSign,
  Clock,
  FileText,
  Edit,
  Trash2,
  Mail,
  Phone,
  User as UserIcon,
  Play,
  Square,
  Link as LinkIcon,
  MapPin,
  PlusCircle,
  ShieldCheck,
  Ban,
  Wallet,
  ShieldAlert,
  Sparkles,
  Loader,
  Users,
  AlertTriangle,
  Undo2,
  FileSignature,
  CheckCircle2,
  ArrowRight,
  MessageSquare,
  Ear,
  Unlock,
  Scale,
  FileImage,
  ImageIcon
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
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn, safeNumber } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, type Staff, AppointmentCheckoutState, ConsentForm } from '@/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useFirebase, updateDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, increment, writeBatch, deleteField } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { AddAndConfigurePartsDialog } from './AddAndConfigurePartsDialog';
import { formatPhoneNumber } from 'react-phone-number-input';
import { nanoid } from 'nanoid';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import Image from 'next/image';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

export const AppointmentDetailsSheet: React.FC<any> = ({
  open,
  onOpenChange,
  appointment: initialAppointment,
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
  const [mounted, setMounted] = useState(false);
  const { inventory, services: allServices, staff, appointments: allAppointments, consentForms } = useInventory();
  const { role, selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const { firestore } = useFirebase();

  useEffect(() => {
    setMounted(true);
  }, []);

  const [isAddAndConfigureOpen, setIsAddAndConfigureOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);

  const appointment = useMemo(() => {
    if (!initialAppointment || !allAppointments) return initialAppointment;
    return allAppointments.find((a: any) => a.id === initialAppointment.id) || initialAppointment;
  }, [initialAppointment, allAppointments]);

  const currentAddOns = useMemo(() => {
    if (!appointment?.addOnIds || !allServices) return [];
    return appointment.addOnIds
      .map((id: string) => allServices.find(s => s.id === id))
      .filter((s): s is Service => !!s);
  }, [appointment?.addOnIds, allServices]);

  const signedConsentsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !client?.id) return null;
    return collection(firestore, `tenants/${tenantId}/clients/${client.id}/signedConsents`);
  }, [firestore, tenantId, client?.id]);

  const { data: signedConsents } = useCollection<any>(signedConsentsQuery);

  const complianceInfo = useMemo(() => {
    if (!service || !consentForms) return { requiredForms: [], pendingForms: [], allCertified: true };
    const requiredIds = service.requiredFormIds || [];
    const requiredForms = consentForms.filter(f => requiredIds.includes(f.id));
    const pendingForms = requiredForms.filter(rf => !signedConsents?.some(sc => sc.formId === rf.id));
    return {
      requiredForms,
      pendingForms,
      allCertified: pendingForms.length === 0
    };
  }, [service, consentForms, signedConsents]);

  const financialData = useMemo(() => {
    if (!appointment || !service) return null;
    const isCompleted = appointment.status === 'completed';
    const addOns = (appointment.addOnIds || [])
      .map((id: string) => allServices.find((s) => s.id === id))
      .filter((s): s is Service => !!s);
    const allServicesInApt = [service, ...addOns];
    const assignedStaffMember = staff.find((s) => s.id === appointment.staffId);

    const productCost = allServicesInApt
      .flatMap((s) => s?.products || [])
      .reduce((acc: number, p: any) => {
        const product = inventory.find((i) => i.id === p.id);
        if (!product) return acc;
        let costPerBaseUnit = 0;
        if (product.costingMethod === 'size' && product.size) {
          costPerBaseUnit = (product.costPerUnit || 0) / product.size;
        } else if (product.costingMethod === 'uses' && product.estimatedUses) {
          costPerBaseUnit = (product.costPerUnit || 0) / product.estimatedUses;
        } else {
          costPerBaseUnit = product.costPerUnit || 0;
        }
        return acc + costPerBaseUnit * (p.quantityUsed || 1);
      }, 0);

    const start = safeDate(appointment.actualStartTime || appointment.startTime);
    const end = safeDate(appointment.actualEndTime || appointment.endTime);
    const actualDuration = appointment.actualEndTime
      ? differenceInMinutes(end, start)
      : allServicesInApt.reduce((acc, s) => acc + (s?.duration || 0), 0);
    const timeCost =
      ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const breakEven = timeCost + productCost;
    const baseRevenue = allServicesInApt.reduce(
        (acc, s) =>
          acc +
          (s.serviceTiers?.find((t) => t.tierId === assignedStaffMember?.pricingTierId)?.price ||
            s.price),
        0
      );
    
    const deferredFee = safeNumber(appointment.checkoutState?.additionalCharge);
    const revenue = isCompleted
      ? transactions
        .filter((t: any) => t.appointmentId === appointment.id && t.category === 'Service Revenue')
        .reduce((acc: any, t: any) => acc + t.amount, 0)
      : baseRevenue;

    return { revenue, breakEven, profit: revenue - breakEven, deferredFee };
  }, [appointment, service, tmhr, inventory, transactions, allServices, staff]);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment?.status === 'servicing' && appointment.actualStartTime) {
      const startTime = safeDate(appointment.actualStartTime);
      const update = () => {
        const diff = differenceInSeconds(new Date(), startTime);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        setElapsedTime(
          h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${m}:${String(s).padStart(2, '0')}`
        );
        setIsRunningOver(Math.floor(diff / 60) > (service?.duration || 0));
      };
      update();
      timer = setInterval(update, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [appointment?.status, appointment?.actualStartTime, service?.duration]);

  const handleAddAndConfigureConfirm = (selectedAddOns: Service[], configs: any) => {
    if (!firestore || !tenantId || !appointment) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
    const currentCheckoutState = appointment.checkoutState || {};
    const newStaffOverrides = { ...(currentCheckoutState.serviceStaffOverrides || {}) };
    const newConcurrentIds = [...(currentCheckoutState.concurrentServiceIds || [])];
    selectedAddOns.forEach((s) => {
      const config = configs[s.id];
      if (config) {
        newStaffOverrides[s.id] = config.staffId;
        if (config.isConcurrent) newConcurrentIds.push(s.id);
      }
    });
    updateDocumentNonBlocking(appointmentRef, {
      addOnIds: selectedAddOns.map(s => s.id),
      checkoutState: { ...currentCheckoutState, serviceStaffOverrides: newStaffOverrides, concurrentServiceIds: Array.from(new Set(newConcurrentIds)) },
    });
    setIsAddAndConfigureOpen(false);
  };

  const handleCopyLink = useCallback(() => {
    if (appointment?.checkInToken) {
      const link = `${window.location.origin}/check-in/${appointment.checkInToken}`;
      navigator.clipboard.writeText(link);
      toast({ title: 'Link Copied', description: 'Guest portal URL is on your clipboard.' });
    }
  }, [appointment?.checkInToken, toast]);

  if (!mounted || !open || !appointment || !client || !service) return null;

  const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
  const ticketId = appointment.id.slice(-6).toUpperCase();
  const mainStaffId = appointment.checkoutState?.serviceStaffOverrides?.[service.id] || appointment.staffId;
  const mainStaffMember = staff.find((s: Staff) => s.id === mainStaffId);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className={cn(isMobile ? 'h-[92dvh] rounded-t-[2.5rem]' : 'sm:max-w-xl', 'flex flex-col p-0 border-none bg-background shadow-2xl overflow-hidden')}>
          <SheetHeader className={cn("border-b bg-muted/5 flex-shrink-0 text-left", isMobile ? "p-5" : "p-8 pb-6")}>
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-[10px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Session Dossier</span>
            </div>
            <SheetTitle className={cn("font-black uppercase tracking-tighter text-slate-900 leading-none", isMobile ? "text-xl" : "text-3xl")}>Session Summary</SheetTitle>
            <SheetDescription className="text-[9px] sm:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">ID: {ticketId}</SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className={cn("space-y-8 pb-32", isMobile ? "p-5" : "p-8")}>
              {appointment.status === 'confirmed' && (
                <div className="flex justify-center">
                  <Button onClick={() => onStartService(appointment.id)} className={cn("w-full max-w-xs rounded-[1.5rem] md:rounded-[2rem] font-black uppercase shadow-2xl shadow-primary/20 transition-all active:scale-95", isMobile ? "h-12 text-sm" : "h-16 text-lg")} size="lg"><Play className="mr-3 h-5 w-5" /> Start Session</Button>
                </div>
              )}

              {appointment.status === 'servicing' && (
                <div className="space-y-4">
                  <div className="flex justify-center"><Button onClick={() => onFinishService(appointment)} className={cn("w-full max-w-xs rounded-[1.5rem] md:rounded-[2rem] font-black uppercase shadow-2xl shadow-primary/20 transition-all active:scale-95", isMobile ? "h-12 text-sm" : "h-16 text-lg")} size="lg"><Square className="mr-3 h-5 w-5" /> Finish Service</Button></div>
                  {elapsedTime && (<div className={cn('rounded-[1.5rem] md:rounded-[2rem] border-4 text-center transition-all', isMobile ? "p-4" : "p-6", isRunningOver ? 'bg-destructive/5 border-destructive animate-pulse' : 'bg-primary/5 border-primary/20')}><p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary mb-1">Live Session Time</p><p className={cn('font-black font-mono tracking-tighter', isMobile ? "text-3xl" : "text-5xl", isRunningOver ? 'text-destructive' : 'text-primary')}>{elapsedTime}</p></div>)}
                </div>
              )}

              <div className="space-y-6 text-left">
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6">
                  <Avatar className={cn("border-4 border-background shadow-xl rounded-[1.5rem] md:rounded-[2.5rem]", isMobile ? "w-16 h-16" : "w-24 h-24")}><AvatarImage src={client.avatarUrl} className="object-cover" /><AvatarFallback className="text-xl font-black bg-primary/10 text-primary">{(client?.name || 'G').substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                  <div className="space-y-1.5 flex-1 min-w-0 text-left">
                    <h2 className={cn("font-black uppercase tracking-tighter text-slate-900 truncate", isMobile ? "text-lg" : "text-3xl")}>{client.name}</h2>
                    <div className="flex flex-wrap justify-center sm:justify-start gap-2 text-left">
                      <Badge variant="outline" className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest border-2"><UserIcon className="w-2.5 h-2.5 mr-1 opacity-40" /> Guest</Badge>
                      {client.activeMembershipId && <Badge className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest bg-indigo-600 text-white border-none shadow-md"><Award className="w-2.5 h-2.5 mr-1" /> Member</Badge>}
                    </div>
                    {isOwnerOrAdminUser && (
                      <div className="flex flex-col gap-1 pt-2 text-left">
                        {client.email && <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate flex items-center justify-center sm:justify-start gap-2"><Mail className="w-3 h-3 opacity-40" /> {client.email}</p>}
                        {client.phone && <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest truncate flex items-center justify-center sm:justify-start gap-2"><Phone className="w-3 h-3 opacity-40" /> {formatPhoneNumber(client.phone)}</p>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-dashed text-left">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Compliance & Digital Intake</h3>
                  <div className="p-4 rounded-2xl bg-muted/10 border-2 space-y-4 shadow-inner">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase text-muted-foreground">Certified Status</span>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-[8px] font-black uppercase h-5 px-2 border-none shadow-sm text-white", 
                          complianceInfo.allCertified ? "bg-green-500" : "bg-amber-500"
                        )}
                      >
                        {complianceInfo.allCertified ? <><CheckCircle2 className="w-2 h-2 mr-1" /> Protocol Certified</> : <><Clock className="w-2 h-2 mr-1" /> Signature Pending</>}
                      </Badge>
                    </div>
                    {complianceInfo.pendingForms.length > 0 && (
                      <div className="space-y-2">
                        {complianceInfo.pendingForms.map(f => (
                          <div key={f.id} className="flex items-center justify-between text-[10px] font-bold uppercase text-amber-700 bg-amber-50/50 p-2 rounded-lg border border-amber-200">
                            <span className="flex items-center gap-2 truncate text-left"><FileSignature className="w-3 h-3 opacity-40" /> {f.title}</span>
                            <span className="shrink-0 ml-4">Required</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5 border border-primary/10" onClick={handleCopyLink}>
                      <LinkIcon className="w-3 h-3 mr-2" /> Dispatch Guest Link
                    </Button>
                  </div>
                </div>

                {appointment.inspirationPhotoUrl && (
                    <div className="space-y-4 pt-4 border-t border-dashed text-left">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Inspiration & Target</h3>
                        <div className="relative aspect-video w-full rounded-[2rem] overflow-hidden border-2 border-primary/10 bg-muted/5 group shadow-inner">
                            <Image src={appointment.inspirationPhotoUrl} alt="Inspiration" fill className="object-cover" />
                            <div className="absolute top-4 right-4">
                                <Badge className="bg-primary/90 backdrop-blur-md text-white border-none font-black text-[8px] uppercase h-6 px-3 shadow-xl">Guest Choice</Badge>
                            </div>
                        </div>
                    </div>
                )}

                {financialData && financialData.deferredFee > 0 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        <Alert className="border-2 border-primary/20 bg-primary/[0.01] rounded-2xl p-5 shadow-sm text-left">
                            <Scale className="h-5 w-5 text-primary" />
                            <AlertTitle className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 text-primary">Deferred Protocol Fee</AlertTitle>
                            <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase text-left">
                                This session includes a deferred rescheduling recovery of <strong>${financialData.deferredFee.toFixed(2)}</strong> to be collected at checkout.
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}

                {safeNumber(client.outstandingBalance) > 0 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-2 rounded-2xl p-5 shadow-sm text-left">
                        <Wallet className="h-5 w-5" />
                        <AlertTitle className="text-[10px] font-black uppercase tracking-[0.2em] mb-2">Accounting Alert</AlertTitle>
                        <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase text-left">
                            Client owes <strong>${Number(client.outstandingBalance).toFixed(2)}</strong>. Settle at checkout.
                        </AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                <div className="grid grid-cols-2 gap-3 text-left">
                  <Button variant="outline" className="h-10 rounded-xl border-2 font-bold justify-start text-[10px] uppercase tracking-widest" asChild><Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-3.5 w-3.5" /> Profile</Link></Button>
                  <Button variant="outline" className="h-10 rounded-xl border-2 font-bold justify-start text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/5" onClick={() => { onOpenChange(false); onCancel(appointment.id, !!appointment.isWalkIn); }}><AlertTriangle className="mr-2 h-3.5 w-3.5" /> Cancel</Button>
                </div>
              </div>

              <Separator className="bg-muted/50" />

              <div className="space-y-4">
                <div className="flex items-center justify-between text-left"><h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Treatment Details</h3><Button variant="ghost" size="sm" onClick={() => setIsAddAndConfigureOpen(true)} className="h-6 px-2 text-[8px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5"><PlusCircle className="w-3 h-3 mr-1" />Add Part</Button></div>
                <Card className="rounded-[1.5rem] md:rounded-[2rem] border-2 bg-muted/5 shadow-inner overflow-hidden text-left">
                  <CardContent className={isMobile ? "p-4 space-y-4" : "p-5 space-y-4"}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1 min-w-0 text-left"><p className="font-black text-sm md:text-lg uppercase tracking-tight text-slate-900 truncate leading-tight">{service.name}</p><div className="flex items-center gap-2 text-[9px] font-bold text-muted-foreground uppercase tracking-widest "><Clock className="w-2.5 h-2.5" /> {service.duration}m</div><div className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-primary/10 text-left"><Avatar className="h-5 w-5 border shadow-sm"><AvatarImage src={mainStaffMember?.avatarUrl} className="object-cover" /><AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(mainStaffMember?.name || 'S')[0]}</AvatarFallback></Avatar><span className="text-[9px] font-black uppercase text-primary tracking-widest truncate">{mainStaffMember?.name || 'Unassigned'}</span></div></div>
                      <p className="text-sm md:text-xl font-black text-primary tracking-tighter font-mono shrink-0">${financialData?.revenue.toFixed(2)}</p>
                    </div>
                    {(appointment.addOnIds || []).length > 0 && (
                      <div className="space-y-3 pt-3 border-t border-dashed text-left">
                        <p className="text-[8px] font-black uppercase text-muted-foreground tracking-widest opacity-40 text-left">Add-ons</p>
                        {(appointment.addOnIds || []).map((id: string) => {
                          const s = allServices.find((svc) => svc.id === id);
                          if (!s) return null;
                          return (
                            <div key={id} className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground bg-muted/10 p-2 rounded-lg border border-muted/20">
                              <span className="truncate flex items-center gap-2"><Sparkles className="w-3 h-3" /> {s.name}</span>
                              <span className="shrink-0 text-primary font-mono">${s.price.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
      <AddAndConfigurePartsDialog
        open={isAddAndConfigureOpen}
        onOpenChange={setIsAddAndConfigureOpen}
        onConfirm={handleAddAndConfigureConfirm}
        allAddOns={allServices.filter(s => s.type === 'addon' && (service?.compatibleAddOnIds || []).includes(s.id))}
        initialSelected={currentAddOns}
        staff={staff}
        defaultStaffId={appointment.staffId || ''}
      />
    </>
  );
};
