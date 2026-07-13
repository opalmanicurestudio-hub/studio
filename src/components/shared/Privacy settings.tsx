'use client';

/**
 * PrivacySettings — v1
 *
 * The owner's control panel for tenant.staffPrivacy — what regular staff
 * can see across the entire app. Drop <PrivacySettings /> into the
 * Settings page. Writes require owner role (matches the Firestore rule:
 * tenant update ⇒ isOwner).
 *
 * Every consumer reads through src/lib/privacy.ts, so a toggle here
 * changes every card, list, and panel at once — one source of truth.
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Shield } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { PRIVACY_DEFAULTS, type StaffPrivacySettings, type PrivacyAudience } from '@/lib/privacy';

const ROWS: { key: keyof StaffPrivacySettings; label: string; description: string }[] = [
  {
    key: 'financials',
    label: 'Client financials',
    description: 'Balance owed, lifetime value, and revenue figures on client cards and profiles.',
  },
  {
    key: 'clientContact',
    label: 'Client contact info',
    description: 'Phone and email on client surfaces. Note: staff always see the number of a client they are actively messaging — those threads are phone-based.',
  },
  {
    key: 'careNoteContents',
    label: 'Care note contents',
    description: 'The text of medical, allergy, and sensory notes. The "care notes on file" flag stays visible to everyone either way.',
  },
];

export function PrivacySettings() {
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;
  const [saving, setSaving] = useState<string | null>(null);

  const isOwner = role === 'owner';
  const current: StaffPrivacySettings = (selectedTenant as any)?.staffPrivacy || {};

  const setAudience = async (key: keyof StaffPrivacySettings, allStaff: boolean) => {
    if (!firestore || !tenantId || !isOwner) return;
    setSaving(key);
    try {
      const value: PrivacyAudience = allStaff ? 'all_staff' : 'admins_only';
      await setDoc(
        doc(firestore, 'tenants', tenantId),
        { staffPrivacy: { ...current, [key]: value } },
        { merge: true },
      );
      toast({ title: 'Privacy updated', description: 'Applies everywhere immediately.' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save', description: 'Only the owner can change privacy settings.' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="border-2 rounded-[2rem]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-sm font-black uppercase tracking-tight">
          <div className="p-2 bg-slate-900 rounded-xl"><Shield className="w-4 h-4 text-white" /></div>
          Staff Data Visibility
        </CardTitle>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
          Owners and admins always see everything. These control what regular staff see, across the entire app.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {ROWS.map(row => {
          const audience: PrivacyAudience = current[row.key] || PRIVACY_DEFAULTS[row.key];
          const allStaff = audience === 'all_staff';
          return (
            <div key={row.key} className="flex items-start justify-between gap-4 p-3.5 rounded-xl border-2 bg-muted/5">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-slate-900">{row.label}</p>
                <p className="text-[10px] font-bold text-muted-foreground leading-snug mt-0.5">{row.description}</p>
                <p className={`text-[9px] font-black uppercase tracking-widest mt-1.5 ${allStaff ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {allStaff ? 'Visible to all staff' : 'Admins only'}
                </p>
              </div>
              <Switch
                checked={allStaff}
                disabled={!isOwner || saving === row.key}
                onCheckedChange={(v) => setAudience(row.key, v)}
              />
            </div>
          );
        })}
        {!isOwner && (
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center pt-1">
            Only the owner can change these settings
          </p>
        )}
      </CardContent>
    </Card>
  );
}
