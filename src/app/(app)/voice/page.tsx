'use client';

/**
 * /voice — the AI Receptionist page. — v2
 *
 * v2: rebuilt on the app's REAL providers after auditing the repo. The
 * (app) route group's layout already mounts AuthGuard → TenantProvider →
 * SidebarProvider, so this page simply consumes useTenant() and
 * useFirestore()/useUser() like every other page — no self-wiring, no
 * manual tenant entry, and it renders inside the app shell with the
 * sidebar. (Replaces the earlier self-contained version that lived at
 * src/app/studio/voice — delete that folder.)
 *
 * Hosts the entire voice feature:
 *   Setup (collapsible) → VoiceAgentSettingsCard + TimezoneSettingCard
 *   Command Center      → live calls, booking approvals, inbox with
 *                         one-click cancel/reschedule, AI drafts, call log
 *
 * onOpenAppointment: copies the appointment ID for lookup in the Planner.
 * Wiring the full AppointmentDetailsSheet here is a later enhancement —
 * the sheet takes a full appointment object plus substantial page context
 * (see planner/page.tsx), so it deserves a deliberate integration rather
 * than a blind one.
 */

import React from 'react';
import { useFirestore, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Bot, Settings2, ChevronDown, ChevronUp, Copy, Loader } from 'lucide-react';
import { VoiceCommandCenter } from '@/components/pos/VoiceCommandCenter';
import { TimezoneSettingCard } from '@/components/settings/TimezoneSettingCard';
import { VoiceAgentSettingsCard } from '@/components/settings/VoiceAgentSettingsCard';

export default function VoicePage() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const [showSetup, setShowSetup] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

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
        <Loader className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  const agentName = selectedTenant?.voiceAgent?.agentName;
  const isConfigured = !!selectedTenant?.voiceAgent?.phoneNumber;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {agentName ? `${agentName} — AI Receptionist` : 'AI Receptionist'}
            </h1>
            <p className="text-xs text-slate-400">
              Every call, booking, and request — nothing goes unnoticed.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={isConfigured ? 'outline' : 'default'}
          className="h-9 text-xs"
          onClick={() => setShowSetup((v) => !v)}
        >
          <Settings2 className="w-3.5 h-3.5 mr-1.5" />
          {isConfigured ? 'Setup' : 'Finish setup'}
          {showSetup ? (
            <ChevronUp className="w-3.5 h-3.5 ml-1" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 ml-1" />
          )}
        </Button>
      </div>

      {copiedId && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 flex items-center gap-2">
          <Copy className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <p className="text-xs text-indigo-800">
            Appointment ID copied — look it up in the Planner.
          </p>
        </div>
      )}

      {(showSetup || !isConfigured) && (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <VoiceAgentSettingsCard
            firestore={firestore}
            tenantId={tenantId}
            tenant={selectedTenant}
          />
          <TimezoneSettingCard
            firestore={firestore}
            tenantId={tenantId}
            tenant={selectedTenant}
          />
        </div>
      )}

      <VoiceCommandCenter
        firestore={firestore}
        tenantId={tenantId}
        tenant={selectedTenant}
        currentStaffId={user?.uid}
        onOpenAppointment={handleOpenAppointment}
      />
    </div>
  );
}
