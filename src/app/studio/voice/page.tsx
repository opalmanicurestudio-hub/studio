'use client';

/**
 * /studio/voice — the AI Voice Assistant page. — v1
 *
 * SELF-CONTAINED BY DESIGN: this page wires itself (Firebase init, auth,
 * tenant detection) so it needs ZERO edits to any existing page — commit
 * this one file and navigate to /studio/voice. It hosts the entire voice
 * feature:
 *
 *   Setup (collapsible)  → TimezoneSettingCard + VoiceAgentSettingsCard
 *   Command Center       → live calls, approvals, inbox (one-click
 *                          cancel/reschedule), AI booking drafts, call log
 *
 * Firebase: reuses the app's already-initialized default Firebase app
 * when present (getApps() guard — same pattern as src/firebase's
 * initializeFirebase), falling back to firebaseConfig. Because it's the
 * same default app, the user's existing sign-in session carries over.
 *
 * Tenant detection, in order:
 *   1. users/{uid} doc → tenantId | activeTenantId | currentTenantId
 *   2. staffDirectory/{uid} doc → tenantId | first of tenantIds
 *   3. manual entry (persisted in localStorage) — shown only if 1 & 2
 *      come up empty, with the ID findable in the Firebase console URL.
 * If your app has a proper tenant context/hook, replacing the detection
 * block with it is a welcome later cleanup — everything else stays.
 *
 * onOpenAppointment: without knowing this page's route wiring, Open
 * copies the appointment ID to the clipboard for lookup in the calendar.
 * Swap the handler to open your AppointmentDetailsSheet when you wire it.
 */

import React from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';
import { getFirestore, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Bot, Settings2, ChevronDown, ChevronUp, Copy, Loader } from 'lucide-react';
import { VoiceCommandCenter } from '@/components/pos/VoiceCommandCenter';
import { TimezoneSettingCard } from '@/components/settings/TimezoneSettingCard';
import { VoiceAgentSettingsCard } from '@/components/settings/VoiceAgentSettingsCard';

const TENANT_STORAGE_KEY = 'cf_voice_tenant_id';

function useFirebase() {
  return React.useMemo(() => {
    let app;
    if (getApps().length) {
      app = getApp();
    } else {
      try {
        app = initializeApp();
      } catch {
        app = initializeApp(firebaseConfig);
      }
    }
    return { app, auth: getAuth(app), firestore: getFirestore(app) };
  }, []);
}

export default function VoicePage() {
  const { app, auth, firestore } = useFirebase();
  const [user, setUser] = React.useState<User | null | undefined>(undefined);
  const [tenantId, setTenantId] = React.useState<string>('');
  const [tenant, setTenant] = React.useState<any>(null);
  const [detecting, setDetecting] = React.useState(true);
  const [manualId, setManualId] = React.useState('');
  const [showSetup, setShowSetup] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, [auth]);

  // Tenant detection
  React.useEffect(() => {
    if (!user) {
      if (user === null) setDetecting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stored =
          typeof window !== 'undefined' ? window.localStorage.getItem(TENANT_STORAGE_KEY) : null;
        if (stored) {
          if (!cancelled) {
            setTenantId(stored);
            setDetecting(false);
          }
          return;
        }
        const userSnap = await getDoc(doc(firestore, 'users', user.uid)).catch(() => null);
        const u: any = userSnap?.exists() ? userSnap.data() : null;
        let found: string =
          u?.tenantId || u?.activeTenantId || u?.currentTenantId || '';
        if (!found) {
          const dirSnap = await getDoc(doc(firestore, 'staffDirectory', user.uid)).catch(
            () => null,
          );
          const d: any = dirSnap?.exists() ? dirSnap.data() : null;
          found =
            d?.tenantId ||
            (Array.isArray(d?.tenantIds) && d.tenantIds.length > 0 ? d.tenantIds[0] : '') ||
            '';
        }
        if (!cancelled) {
          if (found) {
            setTenantId(found);
            try {
              window.localStorage.setItem(TENANT_STORAGE_KEY, found);
            } catch { /* storage unavailable — detection just reruns next visit */ }
          }
          setDetecting(false);
        }
      } catch {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, firestore]);

  // Live tenant doc (the settings cards + inbound webhook config read it)
  React.useEffect(() => {
    if (!tenantId) return;
    const unsub = onSnapshot(
      doc(firestore, 'tenants', tenantId),
      (snap: any) => setTenant(snap.exists() ? snap.data() : null),
      () => { /* non-fatal */ },
    );
    return () => unsub();
  }, [firestore, tenantId]);

  const handleManualSave = () => {
    const id = manualId.trim();
    if (!id) return;
    setTenantId(id);
    try {
      window.localStorage.setItem(TENANT_STORAGE_KEY, id);
    } catch { /* fine */ }
  };

  const handleOpenAppointment = (appointmentId: string) => {
    try {
      navigator.clipboard?.writeText(appointmentId);
      setCopiedId(appointmentId);
      setTimeout(() => setCopiedId(null), 3000);
    } catch { /* clipboard unavailable */ }
  };

  if (user === undefined || detecting) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="max-w-md mx-auto mt-16 rounded-2xl border bg-white p-6 text-center">
        <Bot className="w-8 h-8 text-indigo-500 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-900">Sign in required</p>
        <p className="text-xs text-slate-400 mt-1">
          Open this page from inside your studio dashboard while signed in.
        </p>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="max-w-md mx-auto mt-16 rounded-2xl border bg-white p-6">
        <Bot className="w-8 h-8 text-indigo-500 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-900 text-center">
          One quick thing — which business is this?
        </p>
        <p className="text-xs text-slate-400 mt-1 text-center">
          Auto-detect couldn't find a business linked to this account. Paste
          your tenant ID (it's the document ID under "tenants" in the
          Firebase console) — this is remembered on this device.
        </p>
        <div className="flex gap-2 mt-4">
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="tenant id"
            className="flex-1 h-10 rounded-lg border text-xs px-3 font-mono"
          />
          <Button className="h-10 text-xs" onClick={handleManualSave}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {tenant?.voiceAgent?.agentName || 'AI Voice Assistant'}
            </h1>
            <p className="text-xs text-slate-400">
              Every call, booking, and request — nothing goes unnoticed.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 text-xs"
          onClick={() => setShowSetup((v) => !v)}
        >
          <Settings2 className="w-3.5 h-3.5 mr-1.5" />
          Setup
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
            Appointment ID copied — look it up in your calendar or day view.
          </p>
        </div>
      )}

      {showSetup && (
        <div className={cn('grid lg:grid-cols-2 gap-4 items-start')}>
          <VoiceAgentSettingsCard
            firestore={firestore}
            tenantId={tenantId}
            tenant={tenant}
          />
          <TimezoneSettingCard
            firestore={firestore}
            tenantId={tenantId}
            tenant={tenant}
          />
        </div>
      )}

      <VoiceCommandCenter
        firestore={firestore}
        tenantId={tenantId}
        tenant={tenant}
        currentStaffId={user.uid}
        onOpenAppointment={handleOpenAppointment}
      />
    </div>
  );
}
