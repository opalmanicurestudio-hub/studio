'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Coffee, CheckCircle2, XCircle, MapPin, AlertTriangle,
  Delete, ShieldCheck, ShieldAlert, Loader, LogOut, Calendar, Target
} from 'lucide-react';
import { format, differenceInMinutes, parseISO, isToday, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useDoc, useCollection, useMemoFirebase, addDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, query, where, deleteField, getDocs } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

type KioskStep = 'idle' | 'pin_entry' | 'action_confirm' | 'success' | 'error';

export default function TimeClockPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [step, setStep] = useState<KioskStep>('idle');
  const [pin, setPin] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<any | null>(null);
  const [pendingAction, setPendingAction] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end' | null>(null);
  const [geoStatus, setGeoStatus] = useState<'checking' | 'verified' | 'failed' | 'disabled'>('disabled');
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetail, setErrorDetail] = useState('');

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tenantDocRef = useMemoFirebase(() => firestore ? doc(firestore, `tenants/${tenantId}`) : null, [firestore, tenantId]);
  const staffQuery = useMemoFirebase(() => firestore ? collection(firestore, `tenants/${tenantId}/staff`) : null, [firestore, tenantId]);

  const { data: tenant } = useDoc<any>(tenantDocRef);
  const { data: staff } = useCollection<any>(staffQuery);

  // Geo-fence check -- returns true if ok to proceed
  const checkGeoFence = useCallback(async (): Promise<boolean> => {
    if (!tenant?.geoFenceEnabled || !tenant?.studioLocation) {
      setGeoStatus('disabled');
      return true;
    }
    setGeoStatus('checking');
    return new Promise<boolean>(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          setGeoCoords({ lat: latitude, lng: longitude });
          const R = 6371e3;
          const lat1 = latitude * Math.PI / 180;
          const lat2 = tenant.studioLocation.lat * Math.PI / 180;
          const dLat = (tenant.studioLocation.lat - latitude) * Math.PI / 180;
          const dLon = (tenant.studioLocation.lng - longitude) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
          const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

          // Use break radius for break_end, otherwise clock-in radius
          const radius = pendingAction === 'break_end'
            ? (tenant.geoFenceBreakRadiusMeters || 500)
            : (tenant.geoFenceRadiusMeters || 200);

          if (dist <= radius) {
            setGeoStatus('verified');
            resolve(true);
          } else {
            setGeoStatus('failed');
            resolve(false);
          }
        },
        () => { setGeoStatus('failed'); resolve(false); },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }, [tenant, pendingAction]);

  // Check if staff has an appointment today
  const hasAppointmentToday = useCallback(async (staffId: string): Promise<boolean> => {
    if (!firestore) return false;
    try {
      const today = new Date();
      const start = startOfDay(today).toISOString();
      const end = endOfDay(today).toISOString();
      const aptsRef = collection(firestore, `tenants/${tenantId}/appointments`);
      const q = query(aptsRef,
        where('staffId', '==', staffId),
        where('startTime', '>=', start),
        where('startTime', '<=', end),
        where('status', 'in', ['confirmed', 'deposit_pending', 'servicing'])
      );
      const snap = await getDocs(q);
      return !snap.empty;
    } catch {
      return false;
    }
  }, [firestore, tenantId]);

  const handlePinDigit = (digit: string) => { if (pin.length < 4) setPin(prev => prev + digit); };
  const handlePinDelete = () => setPin(prev => prev.slice(0, -1));

  const showError = (title: string, detail = '') => {
    setErrorMessage(title);
    setErrorDetail(detail);
    setStep('error');
    setPin('');
  };

  const handlePinConfirm = async () => {
    const member = (staff || []).find((s: any) => s.pin === pin);
    if (!member) { showError('PIN Not Recognized', 'Check your PIN and try again.'); return; }

    // ---- RESTRICTION CHECKS (clock_in only) ----
    if (pendingAction === 'clock_in') {

      // 1. Block expired license
      if (tenant?.blockClockInOnExpiredLicense && member.compliance?.licenseExpiry) {
        const expiry = safeDate(member.compliance.licenseExpiry);
        if (expiry < new Date()) {
          showError('License Expired', `Your license expired on ${format(expiry, 'MMM d, yyyy')}. See a manager.`);
          return;
        }
      }

      // 2. Require appointment on schedule
      if (tenant?.requireAppointmentToClockIn) {
        const hasApt = await hasAppointmentToday(member.id);
        if (!hasApt) {
          showError('No Appointment Scheduled', 'You must have an appointment on the schedule today to clock in.');
          return;
        }
      }

      // 3. Early clock-in window
      if (tenant?.earlyClockInMinutes != null && tenant.earlyClockInMinutes >= 0) {
        try {
          const aptsRef = collection(firestore!, `tenants/${tenantId}/appointments`);
          const today = new Date();
          const start = startOfDay(today).toISOString();
          const end = endOfDay(today).toISOString();
          const q = query(aptsRef,
            where('staffId', '==', member.id),
            where('startTime', '>=', start),
            where('startTime', '<=', end),
            where('status', 'in', ['confirmed', 'deposit_pending'])
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            const apts = snap.docs.map(d => d.data());
            const firstApt = apts.sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0];
            const firstStart = safeDate(firstApt.startTime);
            const earliestAllowed = new Date(firstStart.getTime() - (tenant.earlyClockInMinutes * 60000));
            if (new Date() < earliestAllowed) {
              const minsUntil = Math.ceil((earliestAllowed.getTime() - Date.now()) / 60000);
              showError('Too Early to Clock In', `Your first appointment is at ${format(firstStart, 'h:mm a')}. You can clock in ${tenant.earlyClockInMinutes} min before (in ${minsUntil} min).`);
              return;
            }
          }
        } catch { /* If query fails, allow clock-in */ }
      }

      // 4. Geo-fence check
      if (tenant?.geoFenceEnabled) {
        const geoOk = await checkGeoFence();
        if (!geoOk) {
          const failBehavior = tenant?.geoFenceFailBehavior || 'warn';
          if (failBehavior === 'block') {
            showError('Outside Studio Zone', 'You must be at the studio location to clock in. Contact a manager if this is incorrect.');
            return;
          }
          // warn only -- let them continue but flag as unverified
        }
      }

      // 5. Minimum shift check (already clocked in -- skip)
      // Manager override for late -- flag on log, manager reviews in timesheets
    }

    // break_end geo check
    if (pendingAction === 'break_end' && tenant?.geoFenceEnabled) {
      const geoOk = await checkGeoFence();
      if (!geoOk && tenant?.geoFenceFailBehavior === 'block') {
        showError('Outside Studio Zone', `You must be within ${tenant.geoFenceBreakRadiusMeters || 500}m of the studio to end your break.`);
        return;
      }
    }

    // clock_out minimum shift check
    if (pendingAction === 'clock_out' && tenant?.minimumShiftMinutes && member.clockInTime) {
      const minutesWorked = differenceInMinutes(new Date(), safeDate(member.clockInTime));
      if (minutesWorked < tenant.minimumShiftMinutes) {
        const remaining = tenant.minimumShiftMinutes - minutesWorked;
        showError('Minimum Shift Not Met', `You need to work ${remaining} more minute${remaining !== 1 ? 's' : ''} before you can clock out.`);
        return;
      }
    }

    setSelectedStaff(member);
    setStep('action_confirm');
  };

  const handleConfirmAction = async () => {
    if (!selectedStaff || !pendingAction || !firestore) return;
    setIsProcessing(true);
    const now = new Date().toISOString();
    const activityLogsRef = collection(firestore, `tenants/${tenantId}/activityLogs`);
    const staffDocRef = doc(firestore, `tenants/${tenantId}/staff`, selectedStaff.id);

    // Determine if break is within paid limit
    let isPaidBreak = false;
    if (pendingAction === 'break_end' && selectedStaff.breakStartTime) {
      const breakMins = differenceInMinutes(new Date(), safeDate(selectedStaff.breakStartTime));
      isPaidBreak = (tenant?.paidBreakMinutes || 0) > 0 && breakMins <= (tenant.paidBreakMinutes || 0);
    }

    let staffUpdate: any = {};
    let logEntry: any = {
      staffId: selectedStaff.id,
      type: pendingAction,
      timestamp: now,
      geoVerified: geoStatus === 'verified',
      geoCoords: geoCoords || null,
      timesheetStatus: 'pending',
    };

    switch (pendingAction) {
      case 'clock_in':
        staffUpdate = { active: true, clockInTime: now };
        logEntry.clockInTime = now;
        // Flag if geo warn (not verified but allowed through)
        if (tenant?.geoFenceEnabled && geoStatus === 'failed') {
          logEntry.geoWarnOnly = true;
        }
        break;
      case 'clock_out':
        staffUpdate = { active: false, onBreak: false, status: 'idle', clockInTime: deleteField() };
        if (selectedStaff.clockInTime) {
          const worked = differenceInMinutes(new Date(), safeDate(selectedStaff.clockInTime));
          const dailyOtThreshold = (tenant?.dailyOvertimeHours || 8) * 60;
          logEntry.workedMinutes = worked;
          logEntry.overtimeMinutes = Math.max(0, worked - dailyOtThreshold);
        }
        break;
      case 'break_start':
        staffUpdate = { onBreak: true, breakStartTime: now };
        break;
      case 'break_end':
        if (selectedStaff.breakStartTime) {
          const dur = differenceInMinutes(new Date(), safeDate(selectedStaff.breakStartTime));
          logEntry.durationMinutes = dur;
          logEntry.isPaidBreak = isPaidBreak;
          logEntry.paidMinutes = isPaidBreak ? Math.min(dur, tenant?.paidBreakMinutes || 0) : 0;
          logEntry.unpaidMinutes = isPaidBreak ? Math.max(0, dur - (tenant?.paidBreakMinutes || 0)) : dur;
          // Alert if break exceeded max
          if (tenant?.maximumBreakMinutes && dur > tenant.maximumBreakMinutes) {
            logEntry.breakOverage = true;
            logEntry.breakOverageMinutes = dur - tenant.maximumBreakMinutes;
          }
        }
        staffUpdate = { onBreak: false, breakStartTime: deleteField() };
        break;
    }

    try {
      await addDocumentNonBlocking(activityLogsRef, logEntry);
      await setDocumentNonBlocking(staffDocRef, staffUpdate, { merge: true });
      setStep('success');
      setTimeout(() => {
        setStep('idle');
        setPin('');
        setSelectedStaff(null);
        setPendingAction(null);
        setGeoStatus(tenant?.geoFenceEnabled ? 'checking' : 'disabled');
        setGeoCoords(null);
        setErrorDetail('');
      }, 3000);
    } catch {
      showError('Something Went Wrong', 'Please try again or contact a manager.');
    } finally {
      setIsProcessing(false);
    }
  };

  const startAction = (action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
    setPendingAction(action);
    setPin('');
    setErrorDetail('');
    setStep('pin_entry');
  };

  const reset = () => {
    setStep('idle');
    setPin('');
    setSelectedStaff(null);
    setPendingAction(null);
    setErrorMessage('');
    setErrorDetail('');
  };

  const actionLabel: Record<string, string> = {
    clock_in: 'Clock In',
    clock_out: 'Clock Out',
    break_start: 'Start Break',
    break_end: 'End Break',
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];
  const activeStaff = (staff || []).filter((s: any) => s.active);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-primary/5 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-primary/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-primary/5 blur-[100px] rounded-full" />
      </div>

      {/* Live clock */}
      <div className="text-center mb-8 z-10">
        <p className="text-5xl md:text-7xl font-black text-slate-900 font-mono tracking-tighter">
          {format(currentTime, 'h:mm')}
          <span className="text-slate-300 text-3xl md:text-5xl">{format(currentTime, ':ss')}</span>
        </p>
        <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-sm mt-2">{format(currentTime, 'EEEE, MMMM d, yyyy')}</p>
        {tenant?.name && <p className="text-slate-300 font-black uppercase tracking-widest text-[10px] mt-1">{tenant.name}</p>}
      </div>

      {/* Geo status */}
      {tenant?.geoFenceEnabled && (
        <div className={cn("flex items-center gap-2 px-4 py-2 rounded-full border mb-6 z-10 text-[10px] font-black uppercase tracking-widest", geoStatus === 'verified' ? "bg-green-50 border-green-200 text-green-700" : geoStatus === 'failed' ? "bg-red-50 border-red-200 text-red-600" : "bg-slate-100 border-slate-200 text-slate-400")}>
          <MapPin className="w-3 h-3" />
          {geoStatus === 'verified' ? 'Location Verified' : geoStatus === 'failed' ? (tenant?.geoFenceFailBehavior === 'block' ? 'Outside Studio Zone -- Blocked' : 'Outside Studio Zone -- Warning') : geoStatus === 'checking' ? 'Checking Location...' : 'Location Services'}
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* IDLE */}
        {step === 'idle' && (
          <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-md space-y-6 z-10">
            <div className="grid grid-cols-2 gap-4">
              {[
                { action: 'clock_in' as const, label: 'Clock In', icon: Clock, color: 'bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300', iconColor: 'text-green-600', textColor: 'text-green-700', iconBg: 'bg-green-100 group-hover:bg-green-200' },
                { action: 'clock_out' as const, label: 'Clock Out', icon: LogOut, color: 'bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300', iconColor: 'text-red-500', textColor: 'text-red-600', iconBg: 'bg-red-100 group-hover:bg-red-200' },
                { action: 'break_start' as const, label: 'Start Break', icon: Coffee, color: 'bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-300', iconColor: 'text-amber-600', textColor: 'text-amber-700', iconBg: 'bg-amber-100 group-hover:bg-amber-200' },
                { action: 'break_end' as const, label: 'End Break', icon: CheckCircle2, color: 'bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300', iconColor: 'text-blue-600', textColor: 'text-blue-700', iconBg: 'bg-blue-100 group-hover:bg-blue-200' },
              ].map(btn => (
                <motion.button key={btn.action} whileTap={{ scale: 0.95 }} onClick={() => startAction(btn.action)} className={cn("flex flex-col items-center justify-center gap-3 p-8 rounded-[2.5rem] border-2 transition-all group shadow-sm", btn.color)}>
                  <div className={cn("p-4 rounded-2xl transition-colors", btn.iconBg)}><btn.icon className={cn("w-8 h-8", btn.iconColor)} /></div>
                  <span className={cn("font-black uppercase tracking-widest text-sm", btn.textColor)}>{btn.label}</span>
                </motion.button>
              ))}
            </div>

            {/* Active staff list */}
            {activeStaff.length > 0 && (
              <Card className="bg-white border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
                <CardContent className="p-5 space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Currently Active</p>
                  <div className="space-y-2">
                    {activeStaff.map((s: any) => (
                      <div key={s.id} className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 rounded-xl border border-slate-200 shrink-0"><AvatarImage src={s.avatarUrl} className="object-cover" /><AvatarFallback className="text-[10px] font-black bg-primary/10 text-primary">{s.name?.[0]}</AvatarFallback></Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black uppercase text-slate-800 truncate">{s.name}</p>
                          {s.clockInTime && <p className="text-[8px] font-bold text-slate-400 uppercase">Since {format(safeDate(s.clockInTime), 'h:mm a')}</p>}
                        </div>
                        <Badge className={cn("font-black text-[8px] uppercase border-none shrink-0", s.onBreak ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700")}>{s.onBreak ? 'Break' : 'Active'}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        )}

        {/* PIN ENTRY */}
        {step === 'pin_entry' && (
          <motion.div key="pin" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-sm space-y-8 z-10">
            <div className="text-center space-y-2">
              <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">{pendingAction ? actionLabel[pendingAction] : ''}</p>
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Enter Your PIN</h2>
            </div>
            <div className="flex justify-center gap-4">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={cn("w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all", pin.length > i ? "border-primary bg-primary/10" : "border-slate-200 bg-slate-50")}>
                  {pin.length > i && <div className="w-4 h-4 bg-primary rounded-full" />}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4 max-w-[280px] mx-auto">
              {digits.map((d, i) => {
                if (d === '') return <div key={i} />;
                if (d === 'delete') return (
                  <motion.button key={i} whileTap={{ scale: 0.9 }} onClick={handlePinDelete} className="h-16 rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
                    <Delete className="w-7 h-7" />
                  </motion.button>
                );
                return (
                  <motion.button key={i} whileTap={{ scale: 0.95 }} onClick={() => handlePinDigit(d)} className="h-16 rounded-2xl bg-white border-2 border-slate-200 text-2xl font-black text-slate-900 hover:bg-primary/5 hover:border-primary/30 transition-all flex items-center justify-center shadow-sm">
                    {d}
                  </motion.button>
                );
              })}
            </div>
            <div className="space-y-3">
              <Button onClick={handlePinConfirm} disabled={pin.length < 4 || isProcessing} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-lg shadow-2xl shadow-primary/30">
                {isProcessing ? <Loader className="animate-spin" /> : geoStatus === 'checking' ? <><Loader className="animate-spin w-5 h-5 mr-2" />Checking Location...</> : 'Confirm'}
              </Button>
              <Button variant="ghost" onClick={reset} className="w-full text-slate-400 font-bold uppercase tracking-widest text-[10px] hover:text-slate-700">Cancel</Button>
            </div>
          </motion.div>
        )}

        {/* ACTION CONFIRM */}
        {step === 'action_confirm' && selectedStaff && (
          <motion.div key="confirm" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-sm space-y-8 z-10 text-center">
            <Avatar className="w-28 h-28 mx-auto border-4 border-slate-200 rounded-[2.5rem] shadow-xl">
              <AvatarImage src={selectedStaff.avatarUrl} className="object-cover" />
              <AvatarFallback className="text-2xl font-black bg-primary/10 text-primary">{selectedStaff.name?.[0]}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">{selectedStaff.name}</h2>
              <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">{pendingAction ? actionLabel[pendingAction] : ''} -- {format(currentTime, 'h:mm a')}</p>
              {geoStatus === 'verified' && <Badge className="bg-green-100 text-green-700 border-none font-black text-[9px] uppercase"><MapPin className="w-2.5 h-2.5 mr-1" />Location Verified</Badge>}
              {geoStatus === 'failed' && tenant?.geoFenceFailBehavior === 'warn' && <Badge className="bg-amber-100 text-amber-700 border-none font-black text-[9px] uppercase"><AlertTriangle className="w-2.5 h-2.5 mr-1" />Outside Zone -- Warning Only</Badge>}
              {/* Paid break indicator */}
              {pendingAction === 'break_end' && selectedStaff.breakStartTime && (
                <div className={cn("mt-2 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase inline-flex items-center gap-1.5", (tenant?.paidBreakMinutes || 0) > 0 ? "bg-green-50 text-green-700 border border-green-200" : "bg-slate-100 text-slate-500 border border-slate-200")}>
                  {(tenant?.paidBreakMinutes || 0) > 0 ? <><CheckCircle2 className="w-3 h-3" />First {tenant.paidBreakMinutes}min Paid</> : 'Unpaid Break'}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <Button onClick={handleConfirmAction} disabled={isProcessing} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest text-xl shadow-2xl shadow-primary/30">
                {isProcessing ? <Loader className="animate-spin" /> : `Confirm ${pendingAction ? actionLabel[pendingAction] : ''}`}
              </Button>
              <Button variant="ghost" onClick={reset} className="w-full text-slate-400 font-bold uppercase tracking-widest text-[10px] hover:text-slate-700">Cancel</Button>
            </div>
          </motion.div>
        )}

        {/* SUCCESS */}
        {step === 'success' && selectedStaff && (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }} className="w-full max-w-sm space-y-6 z-10 text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, delay: 0.1 }} className="w-28 h-28 bg-green-100 rounded-full flex items-center justify-center mx-auto border-4 border-green-200">
              <CheckCircle2 className="w-14 h-14 text-green-500" />
            </motion.div>
            <div className="space-y-2">
              <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter">Done!</h2>
              <p className="text-slate-500 font-black uppercase tracking-widest text-sm">{selectedStaff.name} -- {pendingAction ? actionLabel[pendingAction] : ''}</p>
              <p className="text-slate-300 font-bold uppercase tracking-widest text-[10px]">{format(currentTime, 'h:mm:ss a')}</p>
            </div>
          </motion.div>
        )}

        {/* ERROR */}
        {step === 'error' && (
          <motion.div key="error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="w-full max-w-sm space-y-6 z-10 text-center">
            <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto border-4 border-red-200">
              <XCircle className="w-12 h-12 text-red-400" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Access Denied</h2>
              <p className="text-red-600 font-black uppercase text-sm">{errorMessage}</p>
              {errorDetail && <p className="text-slate-400 font-bold text-[10px] uppercase leading-relaxed max-w-xs mx-auto">{errorDetail}</p>}
            </div>
            <Button onClick={reset} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest shadow-xl">Try Again</Button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}