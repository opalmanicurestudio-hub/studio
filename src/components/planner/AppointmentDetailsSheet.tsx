'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds } from 'date-fns';
import {
  Award,
  MoreHorizontal,
  DollarSign,
  Clock,
  FileText,
  Edit,
  Trash2,
  TrendingUp,
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
  Undo2
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, type Staff, AppointmentCheckoutState } from '@/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc, increment } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { AddAndConfigurePartsDialog } from './AddAndConfigurePartsDialog';
import { formatPhoneNumber } from 'react-phone-number-input';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
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
  const { inventory, services: allServices, staff, appointments: allAppointments } = useInventory();
  const { role, selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);
  
  const [isAddAndConfigureOpen, setIsAddAndConfigureOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Synchronize with the live appointment from the global collection
  const appointment = useMemo(() => {
    if (!initialAppointment || !allAppointments) return initialAppointment;
    return allAppointments.find(a => a.id === initialAppointment.id) || initialAppointment;
  }, [initialAppointment, allAppointments]);

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

  const financialData = useMemo(() => {
    if (!appointment || !service) return null;
    const isCompleted = appointment.status === 'completed';
    const addOns = (appointment.addOnIds || [])
      .map((id) => allServices.find((s) => s.id === id))
      .filter((s): s is Service => !!s);
    const allServicesInApt = [service, ...addOns];
    const assignedStaffMember = staff.find((s) => s.id === appointment.staffId);

    const productCost = allServicesInApt
      .flatMap((s) => s?.products || [])
      .reduce((acc: number, p: any) => {
        const product = inventory.find((i) => i.id === p.id);
        if (!product) return acc;
        let costPerUse =
          product.costingMethod === 'size' && product.size
            ? (product.costPerUnit || 0) / product.size
            : product.estimatedUses
            ? (product.costPerUnit || 0) / product.estimatedUses
            : product.costPerUnit || 0;
        return acc + costPerUse * (p.quantityUsed || 1);
      }, 0);

    const start = safeDate(appointment.actualStartTime || appointment.startTime);
    const end = safeDate(appointment.actualEndTime || appointment.endTime);
    const actualDuration = appointment.actualEndTime
      ? differenceInMinutes(end, start)
      : allServicesInApt.reduce((acc, s) => acc + (s?.duration || 0), 0);
    const timeCost =
      ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * tmhr;
    const breakEven = timeCost + productCost;
    const revenue = isCompleted
      ? transactions
          .filter((t) => t.appointmentId === appointment.id && t.category === 'Service Revenue')
          .reduce((acc, t) => acc + t.amount, 0)
      : allServicesInApt.reduce(
          (acc, s) =>
            acc +
            (s.serviceTiers?.find((t) => t.tierId === assignedStaffMember?.pricingTierId)?.price ||
              s.price),
          0
        );

    return { revenue, breakEven, profit: revenue - breakEven };
  }, [appointment, service, tmhr, inventory, transactions, allServices, staff]);

  const currentAddOns = useMemo(() => {
    if (!appointment?.addOnIds || !allServices) return [];
    return appointment.addOnIds
      .map((id) => allServices.find((s) => s.id === id))
      .filter((s): s is Service => !!s);
  }, [appointment?.addOnIds, allServices]);

  if (!mounted || !open) return null;

  if (!appointment || !client || !service) {
      return (
          <Sheet open={open} onOpenChange={onOpenChange}>
              <SheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[50vh]" : "sm:max-w-xl", "flex flex-col items-center justify-center")}>
                  <Loader className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-4">Retrieving Dossier...</p>
              </SheetContent>
          </Sheet>
      );
  }

  const handleCopyCheckInLink = () => {
    if (appointment.checkInToken) {
      const link = `${window.location.origin}/check-in/${appointment.checkInToken}`;
      navigator.clipboard.writeText(link);
      toast({ title: 'Link Copied', description: 'Guest check-in URL is on your clipboard.' });
    } else {
        toast({ variant: 'destructive', title: 'Token Missing', description: 'This appointment is missing a security token.' });
    }
  };

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
        if (config.isConcurrent) {
          newConcurrentIds.push(s.id);
        }
      }
    });

    updateDocumentNonBlocking(appointmentRef, {
      addOnIds: selectedAddOns.map(s => s.id),
      checkoutState: {
        ...currentCheckoutState,
        serviceStaffOverrides: newStaffOverrides,
        concurrentServiceIds: Array.from(new Set(newConcurrentIds)),
      },
    });

    toast({
      title: 'Appointment Updated',
      description: 'New parts have been added and configured.',
    });
    setIsAddAndConfigureOpen(false);
  };

  const ticketId = appointment.id.slice(-6).toUpperCase();
  const mainStaffId = appointment.checkoutState?.serviceStaffOverrides?.[service.id] || appointment.staffId;
  const mainStaffMember = staff.find(s => s.id === mainStaffId);
  const checkInLink = `${window.location.origin}/check-in/${appointment.checkInToken}`;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            isMobile ? 'h-[92dvh] rounded-t-[2.5rem]' : 'sm:max-w-xl',
            'flex flex-col p-0 border-none bg-background shadow-2xl overflow-hidden'
          )}
        >
          <SheetHeader className={cn(
            "border-b bg-muted/5 flex-shrink-0 text-left",
            isMobile ? "p-5" : "p-8 pb-6"
          )}>
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">
                Session Dossier
              </span>
            </div>
            <SheetTitle className={cn(
              "font-black uppercase tracking-tighter text-slate-900 leading-none",
              isMobile ? "text-xl" : "text-3xl"
            )}>
              Session Summary
            </SheetTitle>
            <SheetDescription className="text-[9px] sm:text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
              ID: {ticketId}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className={cn("space-y-8 pb-32", isMobile ? "p-5" : "p-8")}>
              {appointment.status === 'confirmed' && (
                <div className="flex justify-center">
                    <Button
                        onClick={() => onStartService(appointment.id)}
                        className={cn(
                            "w-full max-w-xs rounded-[1.5rem] md:rounded-[2rem] font-black uppercase shadow-2xl shadow-primary/20 transition-all active:scale-95",
                            isMobile ? "h-12 text-sm" : "h-16 text-lg"
                        )}
                        size="lg"
                    >
                        <Play className="mr-3 h-5 w-5" /> Start Session
                    </Button>
                </div>
              )}

              {appointment.status === 'servicing' && (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <Button
                        onClick={() => onFinishService(appointment)}
                        className={cn(
                        "w-full max-w-xs rounded-[1.5rem] md:rounded-[2rem] font-black uppercase shadow-2xl shadow-primary/20 transition-all active:scale-95",
                        isMobile ? "h-12 text-sm" : "h-16 text-lg"
                        )}
                        size="lg"
                    >
                        <Square className="mr-3 h-5 w-5" /> Finish Service
                    </Button>
                  </div>
                  {elapsedTime && (
                    <div
                      className={cn(
                        'rounded-[1.5rem] md:rounded-[2rem] border-4 text-center transition-all',
                        isMobile ? "p-4" : "p-6",
                        isRunningOver
                          ? 'bg-destructive/5 border-destructive animate-pulse'
                          : 'bg-primary/5 border-primary/20'
                      )}
                    >
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary mb-1">
                        Live Session Time
                      </p>
                      <p
                        className={cn(
                          'font-black font-mono tracking-tighter',
                          isMobile ? "text-3xl" : "text-5xl",
                          isRunningOver ? 'text-destructive' : 'text-primary'
                        )}
                      >
                        {elapsedTime}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6">
                  <Avatar className={cn("border-4 border-background shadow-xl rounded-[1.5rem] md:rounded-[2.5rem]", isMobile ? "w-16 h-16" : "w-24 h-24")}>
                    <AvatarImage src={client.avatarUrl} className="object-cover" />
                    <AvatarFallback className="text-xl font-black bg-primary/10 text-primary">
                      {(client?.name || 'G').substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <h2 className={cn("font-black uppercase tracking-tighter text-slate-900 truncate", isMobile ? "text-lg" : "text-3xl")}>
                      {client.name}
                    </h2>
                    <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                      <Badge
                        variant="outline"
                        className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest border-2"
                      >
                        <UserIcon className="w-2.5 h-2.5 mr-1 opacity-40" /> Guest
                      </Badge>
                      {client.activeMembershipId && (
                        <Badge className="h-5 px-2 rounded-full font-black uppercase text-[8px] tracking-widest bg-indigo-600 text-white border-none shadow-md">
                          <Award className="w-2.5 h-2.5 mr-1" /> Member
                        </Badge>
                      )}
                    </div>
                    {isOwnerOrAdmin ? (
                        <div className="flex flex-col gap-1 pt-2">
                            {client.email && (
                                <a href={`mailto:${client.email}`} className="flex items-center justify-center sm:justify-start gap-2 text-[10px] font-black uppercase tracking-tight text-muted-foreground hover:text-primary transition-colors">
                                    <Mail className="w-3 h-3 opacity-40" />
                                    <span className="truncate">{client.email}</span>
                                </a>
                            )}
                            {client.phone && (
                                <a href={`tel:${client.phone}`} className="flex items-center justify-center sm:justify-start gap-2 text-[10px] font-black uppercase tracking-tight text-muted-foreground hover:text-primary transition-colors">
                                    <Phone className="w-3 h-3 opacity-40" />
                                    <span>{formatPhoneNumber(client.phone)}</span>
                                </a>
                            )}
                        </div>
                    ) : (
                        <p className="text-[9px] text-muted-foreground italic pt-2 font-black uppercase tracking-widest opacity-40">Contact Restricted</p>
                    )}
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-dashed">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Engagement & Check-in</h3>
                    <div className="p-4 rounded-2xl bg-primary/[0.03] border-2 border-primary/10 space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black uppercase text-primary">Guest Portal Link</span>
                            <Button variant="ghost" size="sm" onClick={handleCopyCheckInLink} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                                <PlusCircle className="w-3 h-3 mr-1.5" /> Copy Link
                            </Button>
                        </div>
                        <div className="bg-white/80 p-3 rounded-xl border border-primary/10 shadow-inner">
                            <p className="text-[10px] font-mono text-muted-foreground break-all leading-relaxed">{checkInLink}</p>
                        </div>
                    </div>
                </div>

                {client.outstandingBalance && client.outstandingBalance > 0 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <Alert
                      variant="destructive"
                      className="bg-destructive/5 border-destructive/20 border-2 rounded-[1.5rem] p-4 shadow-xl shadow-destructive/5"
                    >
                      <Wallet className="h-5 w-5" />
                      <AlertTitle className="text-xs font-black uppercase tracking-tight mb-1">
                        Accounting Alert
                      </AlertTitle>
                      <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase">
                        Client owes <strong>${Number(client.outstandingBalance).toFixed(2)}</strong>. Settle at checkout.
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="h-10 rounded-xl border-2 font-bold justify-start text-[10px] uppercase tracking-widest" asChild>
                    <Link href={`/clients/${client.id}`}>
                      <UserIcon className="mr-2 h-3.5 w-3.5" /> Profile
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 rounded-xl border-2 font-bold justify-start text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/5"
                    onClick={() => {
                        onOpenChange(false);
                        onCancel(appointment.id);
                    }}
                  >
                    <AlertTriangle className="mr-2 h-3.5 w-3.5" /> Cancel
                  </Button>
                </div>
              </div>

              <Separator className="bg-muted/50" />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                    Treatment Details
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddAndConfigureOpen(true)}
                    className="h-6 px-2 text-[8px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5"
                  >
                    <PlusCircle className="w-3 h-3 mr-1" />
                    Add Part
                  </Button>
                </div>
                <Card className="rounded-[1.5rem] md:rounded-[2rem] border-2 bg-muted/5 shadow-inner overflow-hidden">
                  <CardContent className={isMobile ? "p-4 space-y-4" : "p-5 space-y-4"}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1 min-w-0 text-left">
                        <p className="font-black text-sm md:text-lg uppercase tracking-tight text-slate-900 leading-tight truncate">
                          {service.name}
                        </p>
                        <div className="flex items-center gap-2 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                          <Clock className="w-2.5 h-2.5" /> {service.duration}m
                        </div>
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-primary/10">
                            <Avatar className="h-5 w-5 border shadow-sm">
                                <AvatarImage src={mainStaffMember?.avatarUrl} className="object-cover" />
                                <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(mainStaffMember?.name || 'S')[0]}</AvatarFallback>
                            </Avatar>
                            <span className="text-[9px] font-black uppercase text-primary tracking-widest truncate">{mainStaffMember?.name || 'Unassigned'}</span>
                        </div>
                      </div>
                      <p className="text-sm md:text-xl font-black text-primary tracking-tighter font-mono shrink-0">
                        ${financialData?.revenue.toFixed(2)}
                      </p>
                    </div>
                    {(appointment.addOnIds || []).length > 0 && (
                      <div className="space-y-3 pt-3 border-t border-dashed">
                        <p className="text-[8px] font-black uppercase text-muted-foreground tracking-widest opacity-40 text-left">
                          Add-ons
                        </p>
                        {(appointment.addOnIds || []).map((id) => {
                          const s = allServices.find((svc) => svc.id === id);
                          if (!s) return null;
                          
                          const addonStaffId = appointment.checkoutState?.serviceStaffOverrides?.[id] || appointment.staffId;
                          const addonStaff = staff.find(st => st.id === addonStaffId);

                          return (
                            <div key={id} className="space-y-1.5 p-2 rounded-xl bg-background border shadow-sm">
                                <div className="flex justify-between text-[9px] font-black uppercase tracking-tight text-slate-600">
                                    <span className="truncate mr-2">+ {s.name}</span>
                                    <span className="font-mono shrink-0">${s.price.toFixed(2)}</span>
                                </div>
                                <div className="flex items-center gap-1.5 opacity-60">
                                    <Avatar className="h-4 w-4 border shadow-inner">
                                        <AvatarImage src={addonStaff?.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="text-[6px] font-black">{(addonStaff?.name || 'S')[0]}</AvatarFallback>
                                    </Avatar>
                                    <span className="text-[8px] font-black uppercase tracking-widest">{addonStaff?.name?.split(' ')[0] || 'Unassigned'}</span>
                                </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {isOwnerOrAdmin && financialData && (
                <div className="space-y-4">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">
                    Yield Analysis
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 space-y-1 text-left">
                      <p className="text-[8px] font-black uppercase tracking-widest text-primary opacity-60">
                        Gross Yield
                      </p>
                      <p className="text-base md:text-xl font-black font-mono tracking-tighter text-primary">
                        ${financialData.revenue.toFixed(2)}
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/10 space-y-1 text-right">
                      <p className="text-[8px] font-black uppercase tracking-widest text-destructive opacity-60">
                        Est. COGS
                      </p>
                      <p className="text-base md:text-xl font-black font-mono tracking-tighter text-destructive">
                        ${financialData.breakEven.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">
                  Health & Intel
                </h3>
                <div className="space-y-3">
                  {client.medicalNotes && (
                    <Alert variant="destructive" className="border-2 rounded-xl bg-red-500/5">
                      <ShieldAlert className="h-4 w-4" />
                      <AlertTitle className="text-[9px] font-black uppercase text-left">
                        Medical Alert
                      </AlertTitle>
                      <AlertDescription className="text-[10px] font-bold opacity-80 uppercase text-left">
                        {client.medicalNotes}
                      </AlertDescription>
                    </Alert>
                  )}
                  {client.allergyNotes && (
                    <Alert
                      variant="destructive"
                      className="border-2 rounded-xl bg-amber-500/5 text-amber-700 border-amber-200"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle className="text-[9px] font-black uppercase text-left">
                        Allergy Warning
                      </AlertTitle>
                      <AlertDescription className="text-[10px] font-bold opacity-80 uppercase text-left">
                        {client.allergyNotes}
                      </AlertDescription>
                    </Alert>
                  )}
                  <Card className="rounded-[1.5rem] border-2 bg-muted/5">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <FileText className="w-3 h-3" /> Discovery Notes
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <p className="text-[11px] font-medium text-slate-600 leading-relaxed italic text-left">
                        "{client.notes?.general || 'No session notes provided.'}"
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </ScrollArea>
          
          <SheetFooter className={cn(
            "border-t bg-background flex-shrink-0 shadow-2xl",
            isMobile ? "p-4" : "p-6 sm:p-8 pt-4"
          )}>
            <div className="grid grid-cols-2 gap-3 w-full">
              <Button
                variant="outline"
                className="h-12 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
                onClick={() => {
                  onOpenChange(false);
                  setTimeout(() => onReschedule(appointment), 150);
                }}
              >
                <Undo2 className="mr-2 h-3.5 w-3.5" /> Reschedule
              </Button>
              <Button
                variant="outline"
                className="h-12 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
                onClick={() => {
                  onOpenChange(false);
                  setTimeout(() => onEdit(appointment), 150);
                }}
              >
                <Edit className="mr-2 h-3.5 w-3.5" /> Edit Record
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AddAndConfigurePartsDialog
        open={isAddAndConfigureOpen}
        onOpenChange={setIsAddAndConfigureOpen}
        allAddOns={allServices.filter((s) => s.type === 'addon')}
        initialSelected={currentAddOns}
        staff={staff}
        defaultStaffId={appointment.staffId}
        onConfirm={handleAddAndConfigureConfirm}
      />
    </>
  );
};
