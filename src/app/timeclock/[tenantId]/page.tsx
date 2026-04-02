'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Coffee, CheckCircle2, XCircle, MapPin, AlertTriangle,
  Delete, ShieldCheck, ShieldAlert, Loader, LogOut
} from 'lucide-react';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useDoc, useCollection, useMemoFirebase, addDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, deleteField, query, where } from 'firebase/firestore';
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

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tenantDocRef = useMemoFirebase(() => firestore ? doc(firestore, `tenants/${tenantId}`) : null, [firestore, tenantId]);
  const staffQuery = useMemoFirebase(() => firestore ? collection(firestore, `tenants/${tenantId}/staff`) : null, [firestore, tenantId]);

  const { data: tenant } = useDoc<any>(tenantDocRef);
  const { data: staff } = useCollection<any>(staffQuery);

  // Geo-fence check
  const checkGeoFence = useCallback(async () => {
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
          // Haversine distance
          const R = 6371e3;
          const lat1 = latitude * Math.PI / 180;
          const lat2 = tenant.studioLocation.lat * Math.PI / 180;
          const dLat = (tenant.studioLocation.lat - latitude) * Math.PI / 180;
          const dLon = (tenant.studioLocation.lng - longitude) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
          const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const radius = tenant.geoFenceRadiusMeters || 200;
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
  }, [tenant]);

  const handlePinDigit = (digit: string) => {
    if (pin.length < 4) setPin(prev => prev + digit);
  };

  const handlePinDelete = () => setPin(prev => prev.slice(0, -1));

  const handlePinConfirm = async () => {
    const member = (staff || []).find((s: any) => s.pin === pin);
    if (!member) {
      setErrorMessage('PIN not recognized. Please try again.');
      setStep('error');
      setPin('');
      return;
    }

    // Geo check
    if (tenant?.geoFenceEnabled && pendingAction === 'clock_in') {
      const geoOk = await checkGeoFence();
      if (!geoOk) {
        setErrorMessage('You must be at the studio location to clock in.');
        setStep('error');
        setPin('');
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
        break;
      case 'clock_out':
        staffUpdate = { active: false, onBreak: false, status: 'idle', clockInTime: deleteField() };
        if (selectedStaff.clockInTime) {
          const worked = differenceInMinutes(new Date(), safeDate(selectedStaff.clockInTime));
          const overtimeThreshold = (tenant?.overtimeThresholdHours || 8) * 60;
          logEntry.workedMinutes = worked;
          logEntry.overtimeMinutes = Math.max(0, worked - overtimeThreshold);
        }
        break;
      case 'break_start':
        staffUpdate = { onBreak: true, breakStartTime: now };
        break;
      case 'break_end':
        if (selectedStaff.breakStartTime) {
          const dur = differenceInMinutes(new Date(), safeDate(selectedStaff.breakStartTime));
          logEntry.durationMinutes = dur;
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
      }, 3000);
    } catch (e) {
      setErrorMessage('Something went wrong. Please try again.');
      setStep('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const startAction = (action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
    setPendingAction(action);
    setPin('');
    setStep('pin_entry');
  };

  const reset = () => {
    setStep('idle');
    setPin('');
    setSelectedStaff(null);
    setPendingAction(null);
    setErrorMessage('');
  };

  const actionLabel = {
    clock_in: 'Clock In',
    clock_out: 'Clock Out',
    break_start: 'Start Break',
    break_end: 'End Break',
  };

  const digits = ['1','2','3','4','5','6','7','8','9','','0','delete'];

  const activeStaff = (staff || []).filter((s: any) => s.active);
  const onBreakStaff = (staff || []).filter((s: any) => s.onBreak);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-primary/5 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-primary/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-primary/5 blur-[100px] rounded-full" />
      </div>

      {/* Live clock */}
      <div className="text-center mb-8 z-10">
        <p className="text-5xl md:text-7xl font-black text-slate-900 font-mono tracking-tighter">{format(currentTime, 'h:mm')}<span className="text-slate-300 text-3xl md:text-5xl">{format(currentTime, ':ss')}</span></p>
        <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-sm mt-2">{format(currentTime, 'EEEE, MMMM d, yyyy')}</p>
        {tenant?.name && <p className="text-slate-300 font-black uppercase tracking-widest text-[10px] mt-1">{tenant.name}</p>}
      </div>

      {/* Geo status indicator */}
      {tenant?.geoFenceEnabled && (
        <div className={cn("flex items-center gap-2 px-4 py-2 rounded-full border mb-6 z-10 text-[10px] font-black uppercase tracking-widest", geoStatus === 'verified' ? "bg-green-500/10 border-green-500/20 text-green-400" : geoStatus === 'failed' ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-slate-100 border-slate-200 text-slate-400")}>
          <MapPin className="w-3 h-3" />
          {geoStatus === 'verified' ? 'Location Verified' : geoStatus === 'failed' ? 'Outside Studio Zone' : geoStatus === 'checking' ? 'Checking Location...' : 'Location Services'}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* IDLE -- Show action buttons and active staff */}
        {step === 'idle' && (
          <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-md space-y-6 z-10">
            <div className="grid grid-cols-2 gap-4">
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => startAction('clock_in')} className="flex flex-col items-center justify-center gap-3 p-8 rounded-[2.5rem] bg-green-50 border-2 border-green-200 hover:bg-green-100 hover:border-green-300 transition-all group shadow-sm">
                <div className="p-4 bg-green-100 rounded-2xl group-hover:bg-green-200 transition-colors"><Clock className="w-8 h-8 text-green-600" /></div>
                <span className="font-black uppercase tracking-widest text-green-700 text-sm">Clock In</span>
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => startAction('clock_out')} className="flex flex-col items-center justify-center gap-3 p-8 rounded-[2.5rem] bg-red-50 border-2 border-red-200 hover:bg-red-100 hover:border-red-300 transition-all group shadow-sm">
                <div className="p-4 bg-red-100 rounded-2xl group-hover:bg-red-200 transition-colors"><LogOut className="w-8 h-8 text-red-500" /></div>
                <span className="font-black uppercase tracking-widest text-red-600 text-sm">Clock Out</span>
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => startAction('break_start')} className="flex flex-col items-center justify-center gap-3 p-8 rounded-[2.5rem] bg-amber-50 border-2 border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-all group shadow-sm">
                <div className="p-4 bg-amber-100 rounded-2xl group-hover:bg-amber-200 transition-colors"><Coffee className="w-8 h-8 text-amber-600" /></div>
                <span className="font-black uppercase tracking-widest text-amber-700 text-sm">Start Break</span>
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => startAction('break_end')} className="flex flex-col items-center justify-center gap-3 p-8 rounded-[2.5rem] bg-blue-50 border-2 border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-all group shadow-sm">
                <div className="p-4 bg-blue-100 rounded-2xl group-hover:bg-blue-200 transition-colors"><CheckCircle2 className="w-8 h-8 text-blue-600" /></div>
                <span className="font-black uppercase tracking-widest text-blue-700 text-sm">End Break</span>
              </motion.button>
            </div>

            {/* Active staff status */}
            {(activeStaff.length > 0 || onBreakStaff.length > 0) && (
              <Card className="bg-white border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
                <CardContent className="p-5 space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Currently Active</p>
                  <div className="space-y-2">
                    {activeStaff.map((s: any) => (
                      <div key={s.id} className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 rounded-xl border border-white/10 shrink-0"><AvatarImage src={s.avatarUrl} className="object-cover" /><AvatarFallback className="text-[10px] font-black bg-white/10 text-white">{s.name?.[0]}</AvatarFallback></Avatar>
                        <span className="text-sm font-black uppercase text-slate-800 truncate">{s.name}</span>
                        <Badge className={cn("ml-auto font-black text-[8px] uppercase border-none shrink-0", s.onBreak ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700")}>{s.onBreak ? 'Break' : 'Active'}</Badge>
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

            {/* PIN display */}
            <div className="flex justify-center gap-4">
              {[0,1,2,3].map(i => (
                <div key={i} className={cn("w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all", pin.length > i ? "border-primary bg-primary/10" : "border-slate-200 bg-slate-50")}>
                  {pin.length > i && <div className="w-4 h-4 bg-primary rounded-full" />}
                </div>
              ))}
            </div>

            {/* Keypad */}
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
              <Button onClick={handlePinConfirm} disabled={pin.length < 4} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-lg shadow-2xl shadow-primary/30">
                {geoStatus === 'checking' ? <><Loader className="animate-spin w-5 h-5 mr-2" /> Checking Location...</> : 'Confirm'}
              </Button>
              <Button variant="ghost" onClick={reset} className="w-full text-slate-400 font-bold uppercase tracking-widest text-[10px] hover:text-slate-700">Cancel</Button>
            </div>
          </motion.div>
        )}

        {/* ACTION CONFIRM */}
        {step === 'action_confirm' && selectedStaff && (
          <motion.div key="confirm" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-sm space-y-8 z-10 text-center">
            <Avatar className="w-28 h-28 mx-auto border-4 border-white/20 rounded-[2.5rem] shadow-2xl">
              <AvatarImage src={selectedStaff.avatarUrl} className="object-cover" />
              <AvatarFallback className="text-2xl font-black bg-primary/10 text-primary">{selectedStaff.name?.[0]}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">{selectedStaff.name}</h2>
              <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">{pendingAction ? actionLabel[pendingAction] : ''} -- {format(currentTime, 'h:mm a')}</p>
              {geoStatus === 'verified' && <Badge className="bg-green-500/20 text-green-400 border-none font-black text-[9px] uppercase"><MapPin className="w-2.5 h-2.5 mr-1" />Location Verified</Badge>}
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
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, delay: 0.1 }} className="w-28 h-28 bg-green-500/20 rounded-full flex items-center justify-center mx-auto border-4 border-green-500/30">
              <CheckCircle2 className="w-14 h-14 text-green-400" />
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
            <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto border-4 border-red-500/30">
              <XCircle className="w-12 h-12 text-red-400" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Access Denied</h2>
              <p className="text-red-300 font-bold uppercase text-sm">{errorMessage}</p>
            </div>
            <Button onClick={reset} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest shadow-xl">Try Again</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}