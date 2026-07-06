'use client';

/**
 * /voice — the AI Receptionist page. — v3 "Switchboard"
 *
 * Designed in the house system (Figtree black-weight micro-labels, violet
 * primary, pillowy 2.5–3rem radii, border-2 cards, dashed empty states)
 * rather than a generic dashboard idiom. One bold move, everything else
 * disciplined:
 *
 *   THE SWITCHBOARD HERO — a deep-ink panel carrying the agent's identity
 *   and a live "line status" element that encodes real state: a breathing
 *   teal dot while the line is open and idle, a pulsing violet LIVE strip
 *   with caller + ticking duration during calls. Today's numbers sit
 *   inside the hero as big tracking-tighter numerals — no grey tile row.
 *
 * Below: two editorial columns — ACTION QUEUE (approvals, inbox, drafts)
 * and CALL ARCHIVE — with the app's 8px tracking-[0.22em] section labels.
 * Unconfigured tenants get an onboarding-forward hero variant with a
 * setup checklist and the setup cards open by default.
 *
 * Consumes the app's real providers (useTenant / useFirestore / useUser);
 * owns its own voiceCalls/inbox/approvals subscriptions so the layout is
 * fully design-controlled (imports the panels directly rather than
 * VoiceCommandCenter, which remains available for embedding elsewhere).
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection, query, where, orderBy, limit, onSnapshot,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { useFirestore, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Bot, Settings2, ChevronDown, Copy, Loader, PhoneIncoming, PhoneOutgoing,
  Radio, CheckCircle2, Circle, Sparkles, ArrowRight,
} from 'lucide-react';
import { VoiceInboxPanel } from '@/components/pos/VoiceInboxPanel';
import { VoiceCallLog } from '@/components/pos/VoiceCallLog';
import { VoiceBookingApprovalsPanel } from '@/components/pos/VoiceBookingApprovalsPanel';
import { TimezoneSettingCard } from '@/components/settings/TimezoneSettingCard';
import { VoiceAgentSettingsCard } from '@/components/settings/VoiceAgentSettingsCard';
import { VoiceKnowledgeManager } from '@/components/settings/VoiceKnowledgeManager';

// ── Editorial section label (house pattern) ─────────────────────────────────
function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <p className="text-[8px] font-black uppercase tracking-[0.22em] text-muted-foreground/50 shrink-0">
        {children}
      </p>
      {count !== undefined && count > 0 && (
        <span className="bg-primary text-primary-foreground rounded-full h-4 min-w-4 px-1 flex items-center justify-center font-black text-[8px]">
          {count > 9 ? '9+' : count}
        </span>
      )}
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

// ── Hero stat (big numeral, tiny label) ─────────────────────────────────────
function HeroStat({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <div className="text-center sm:text-left">
      <p
        className={cn(
          'text-3xl font-black tracking-tighter tabular-nums leading-none',
          alert && value > 0 ? 'text-rose-400' : 'text-white',
        )}
      >
        {value}
      </p>
      <p className="text-[8px] font-black uppercase tracking-[0.22em] text-white/40 mt-1.5">
        {label}
      </p>
    </div>
  );
}

export default function VoicePage() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const va = selectedTenant?.voiceAgent || {};
  const agentName: string = va.agentName || 'Your AI Receptionist';
  const hasName = !!va.agentName;
  const hasKnowledge = !!(va.knowledgeBase || '').trim() || !!va.agentName; // auto-derived layer means knowledge exists once configured
  const hasNumber = !!(va.phoneNumber || '').trim();
  const isConfigured = hasNumber;

  const [showSetup, setShowSetup] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [calls, setCalls] = React.useState<any[]>([]);
  const [openInbox, setOpenInbox] = React.useState<any[]>([]);
  const [pendingApprovals, setPendingApprovals] = React.useState(0);
  const [aiDrafts, setAiDrafts] = React.useState<number>(0);
  const [, setTick] = React.useState(0);

  // voiceCalls — hero status, stats, and the recordings map for the panels
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/voiceCalls`),
      orderBy('startedAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap: any) => {
      const list: any[] = [];
      snap.forEach((d: any) => list.push({ id: d.id, ...(d.data() as any) }));
      setCalls(list);
    }, () => { /* non-fatal */ });
    return () => unsub();
  }, [firestore, tenantId]);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/voiceInbox`),
      where('status', '==', 'open'),
    );
    const unsub = onSnapshot(q, (snap: any) => {
      const list: any[] = [];
      snap.forEach((d: any) => list.push({ id: d.id, ...(d.data() as any) }));
      setOpenInbox(list);
    }, () => { /* non-fatal */ });
    return () => unsub();
  }, [firestore, tenantId]);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/appointments`),
      where('voiceApproval', '==', 'pending'),
    );
    const unsub = onSnapshot(q, (snap: any) => {
      let n = 0;
      snap.forEach((d: any) => { if ((d.data() as any)?.status !== 'cancelled') n += 1; });
      setPendingApprovals(n);
    }, () => { /* non-fatal */ });
    return () => unsub();
  }, [firestore, tenantId]);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/callBackDrafts`),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q, (snap: any) => {
      let n = 0;
      snap.forEach((d: any) => { if ((d.data() as any)?.source === 'ai_receptionist') n += 1; });
      setAiDrafts(n);
    }, () => { /* non-fatal */ });
    return () => unsub();
  }, [firestore, tenantId]);

  const callsById = React.useMemo(() => {
    const map: Record<string, { recordingUrl?: string; transcript?: string }> = {};
    calls.forEach((c) => { map[c.id] = { recordingUrl: c.recordingUrl, transcript: c.transcript }; });
    return map;
  }, [calls]);

  const liveCalls = calls.filter((c) => {
    if (c.status !== 'live' || typeof c.startedAt !== 'string') return false;
    const age = Date.now() - new Date(c.startedAt).getTime();
    return age >= 0 && age < 2 * 3600 * 1000;
  });
  React.useEffect(() => {
    if (liveCalls.length === 0) return;
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [liveCalls.length]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const callsToday = calls.filter(
    (c) => typeof c.startedAt === 'string' && c.startedAt.startsWith(todayStr),
  ).length;
  const bookingsToConfirm = pendingApprovals + aiDrafts;
  const complaints = openInbox.filter((i) => i.intent === 'complaint').length;

  const handleOpenAppointment = (appointmentId: string) => {
    try {
      navigator.clipboard?.writeText(appointmentId);
      setCopiedId(appointmentId);
      setTimeout(() => setCopiedId(null), 3000);
    } catch { /* clipboard unavailable */ }
  };

  if (!tenantId || !firestore) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader className="w-5 h-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const setupOpen = showSetup || !isConfigured;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2.5rem] sm:rounded-[3rem] bg-slate-950 text-white border-2 border-slate-900 shadow-2xl shadow-primary/10"
      >
        <div className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full bg-primary/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 w-72 h-72 rounded-full bg-accent/15 blur-3xl" />

        <div className="relative p-6 sm:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-12">
            <div className="flex items-center gap-5 min-w-0 flex-1">
              <div className="relative shrink-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-[1.75rem] bg-primary flex items-center justify-center shadow-xl shadow-primary/40">
                  <Bot className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                </div>
                {isConfigured && liveCalls.length === 0 && (
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-accent border-2 border-slate-950" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[8px] font-black uppercase tracking-[0.3em] text-primary-foreground/40 mb-1.5">
                  AI Receptionist
                </p>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter leading-none truncate">
                  {agentName}
                </h1>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-2">
                  {isConfigured
                    ? liveCalls.length > 0
                      ? 'On a call right now'
                      : 'Line open · answering for ' + (selectedTenant?.name || 'the studio')
                    : 'Not answering yet · finish setup below'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 sm:gap-10 lg:pr-2 shrink-0">
              <HeroStat value={callsToday} label="Calls today" />
              <HeroStat value={bookingsToConfirm} label="To confirm" />
              <HeroStat value={complaints} label="Complaints" alert />
            </div>
          </div>

          <div className="mt-7">
            <AnimatePresence mode="wait">
              {liveCalls.length > 0 ? (
                <motion.div
                  key="live"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="rounded-2xl bg-primary/15 border border-primary/30 px-4 py-3 space-y-1.5"
                >
                  {liveCalls.map((c) => {
                    const mins = Math.max(0, Math.floor((Date.now() - new Date(c.startedAt).getTime()) / 60_000));
                    const Icon = c.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming;
                    return (
                      <div key={c.id} className="flex items-center gap-3">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                        </span>
                        <Icon className="w-3.5 h-3.5 text-primary-foreground/70 shrink-0" />
                        <p className="text-xs font-bold text-white truncate">
                          {c.direction === 'outbound' ? c.toNumber : c.fromNumber || 'Unknown number'}
                          {c.outboundReason && (
                            <span className="text-white/40 font-medium"> · {String(c.outboundReason).replace(/_/g, ' ')}</span>
                          )}
                        </p>
                        <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-primary-foreground/60 tabular-nums shrink-0">
                          Live · {mins < 1 ? 'now' : `${mins}m`}
                        </span>
                      </div>
                    );
                  })}
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="flex items-center gap-2.5">
                    <Radio className={cn('w-3.5 h-3.5', isConfigured ? 'text-accent' : 'text-white/25')} />
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">
                      {isConfigured
                        ? 'Recording, transcribing & filing every call'
                        : 'Three steps from your first answered call'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setShowSetup((v) => !v)}
                    className={cn(
                      'h-9 rounded-xl font-black uppercase text-[9px] tracking-widest px-4',
                      isConfigured
                        ? 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                        : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/40',
                    )}
                  >
                    {isConfigured ? (
                      <><Settings2 className="w-3.5 h-3.5 mr-1.5" /> Setup</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Finish setup <ArrowRight className="w-3 h-3 ml-1.5" /></>
                    )}
                    <ChevronDown className={cn('w-3.5 h-3.5 ml-1 transition-transform', setupOpen && 'rotate-180')} />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.section>

      <AnimatePresence>
        {setupOpen && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-1">
              {!isConfigured && (
                <div className="flex items-center gap-4 flex-wrap px-1">
                  {[
                    { done: hasName, label: 'Name your assistant' },
                    { done: hasKnowledge, label: 'Review what it knows' },
                    { done: hasNumber, label: 'Connect a phone number' },
                  ].map((step) => (
                    <div key={step.label} className="flex items-center gap-1.5">
                      {step.done ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-muted-foreground/30" />
                      )}
                      <p className={cn(
                        'text-[9px] font-black uppercase tracking-widest',
                        step.done ? 'text-accent' : 'text-muted-foreground/50',
                      )}>
                        {step.label}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid lg:grid-cols-2 gap-4 items-start">
                <VoiceAgentSettingsCard firestore={firestore} tenantId={tenantId} tenant={selectedTenant} />
                <TimezoneSettingCard firestore={firestore} tenantId={tenantId} tenant={selectedTenant} />
              </div>
              <VoiceKnowledgeManager
                firestore={firestore}
                tenantId={tenantId}
                tenant={selectedTenant}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {copiedId && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl border-2 border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center gap-2.5"
          >
            <Copy className="w-3.5 h-3.5 text-primary shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
              Appointment ID copied — look it up in the Planner
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid lg:grid-cols-2 gap-x-6 gap-y-4 items-start">
        <div className="space-y-4">
          <SectionLabel count={bookingsToConfirm + openInbox.length}>Action queue</SectionLabel>
          <VoiceBookingApprovalsPanel
            firestore={firestore}
            tenantId={tenantId}
            tenant={selectedTenant}
            currentStaffId={user?.uid}
            callsById={callsById}
          />
          <VoiceInboxPanel
            firestore={firestore}
            tenantId={tenantId}
            currentStaffId={user?.uid}
            onOpenAppointment={handleOpenAppointment}
            callsById={callsById}
          />
          {bookingsToConfirm + openInbox.length === 0 && (
            <div className="p-10 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
              <CheckCircle2 className="w-7 h-7" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                Queue clear — nothing needs you
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SectionLabel count={calls.length > 0 ? undefined : undefined}>Call archive</SectionLabel>
          {calls.length === 0 ? (
            <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
              <PhoneIncoming className="w-8 h-8" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                The phone hasn't rung yet
              </p>
              <p className="text-[9px] font-bold uppercase tracking-widest max-w-[220px]">
                {isConfigured
                  ? `${agentName} will file every call here — audio, transcript & summary`
                  : 'Finish setup and forward your line to start capturing calls'}
              </p>
            </div>
          ) : (
            <VoiceCallLog firestore={firestore} tenantId={tenantId} />
          )}
        </div>
      </div>
    </div>
  );
}
