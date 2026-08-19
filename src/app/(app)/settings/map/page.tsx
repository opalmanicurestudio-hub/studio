'use client';

// ─── /settings/map ────────────────────────────────────────────────────────────
// Setup: the whole studio configuration on one scrolling page, in plain words,
// with the controls people actually use sitting right next to the sentence
// that explains them.
//
// This started life as a read-only map, on the reasoning that duplicate
// controls caused the settings mess. That was the wrong lesson. The mess was
// two engines writing DIFFERENT FIELDS for one concept, so the screens really
// did disagree. A control here writes the SAME field as the owning screen —
// one field with two doors, which cannot contradict itself.
//
// What that buys is the thing the settings were failing at: changing the
// handful of things you change often should not cost four taps and two page
// loads. Anything with genuine complexity — a cancellation matrix, rewriting a
// message — still links out, because a switch is a poor interface for a
// decision that needs context.

import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { AlertTriangle, ArrowRight, Check, Loader } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { SETTING_GROUPS, attentionItems, summariseGroup } from '@/lib/settings-map';
import { cn } from '@/lib/utils';

export default function SettingsSetupPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id || '';

  const staffRole = String((selectedTenant as any)?.staffMember?.role || 'owner').toLowerCase();
  const isMgr = ['owner', 'admin'].includes(staffRole);
  const attention = useMemo(() => attentionItems(selectedTenant), [selectedTenant]);

  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const save = async (key: string, field: string, value: any) => {
    if (!firestore || !tenantId || !isMgr || busy) return;
    setBusy(key);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value });
      toast({ title: 'Saved' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save', description: e?.message });
    } finally { setBusy(null); }
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <h1 className="font-black uppercase tracking-tighter text-2xl leading-none">Setup</h1>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-1">
            How your studio runs, in plain words{isMgr ? '' : ' · view only'}
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {attention.length > 0 && (
          <Card className="border-2 border-amber-300 rounded-[2rem] bg-amber-50">
            <CardContent className="p-5 space-y-3">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" /> {attention.length} thing{attention.length === 1 ? '' : 's'} switched on but doing nothing
              </p>
              {attention.map((a) => (
                <div key={a.label} className="border-t border-amber-200 pt-2.5 first:border-0 first:pt-0">
                  <p className="text-sm font-black text-amber-900">{a.label}</p>
                  <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-amber-800/80">{a.warning}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {attention.length === 0 && (
          <p className="flex items-center gap-2 rounded-2xl border-2 border-green-300 bg-green-50 px-4 py-3 text-[11px] font-bold text-green-800">
            <Check className="h-4 w-4 shrink-0" />
            Every rule you have set has what it needs to actually work.
          </p>
        )}

        {SETTING_GROUPS.map((g) => {
          const entries = summariseGroup(selectedTenant, g.id);
          if (entries.length === 0) return null;
          return (
            <Card key={g.id} className="border-2 rounded-[2rem] bg-white overflow-hidden">
              <CardContent className="p-0">
                <div className="border-b-2 bg-muted/20 px-5 py-3.5">
                  <p className="text-base font-black tracking-tight">{g.question}</p>
                </div>
                <div className="divide-y">
                  {entries.map((e) => {
                    const c = e.control;
                    const key = `${e.group}-${e.label}`;
                    return (
                      <div key={e.label} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-sm font-black', e.needsAttention && 'text-amber-800')}>
                              {e.label}
                              {e.needsAttention && <AlertTriangle className="ml-1.5 inline h-3 w-3" />}
                            </p>
                            <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">{e.summary}</p>
                          </div>

                          {/* Toggles sit on the right, where a thumb already is. */}
                          {c?.kind === 'toggle' && (
                            <button type="button" role="switch" aria-checked={c.on(selectedTenant)} aria-label={e.label}
                              disabled={!isMgr || busy === key}
                              onClick={() => void save(key, c.field, !c.on(selectedTenant))}
                              className={cn('relative mt-0.5 h-7 w-12 shrink-0 rounded-full border-2 transition-all disabled:opacity-40',
                                c.on(selectedTenant) ? 'border-green-600 bg-green-500/20' : 'border-muted-foreground/30 bg-muted/40')}>
                              <span className={cn('absolute top-0.5 h-5 w-5 rounded-full transition-all',
                                c.on(selectedTenant) ? 'right-0.5 bg-green-600' : 'left-0.5 bg-muted-foreground/50')} />
                            </button>
                          )}

                          {!c && (
                            <Link href={e.href} aria-label={`Open ${e.screen}`}
                              className="mt-1 flex shrink-0 items-center gap-1 text-[9px] font-black uppercase tracking-widest text-primary">
                              Open <ArrowRight className="h-3 w-3" />
                            </Link>
                          )}
                        </div>

                        {/* Choices render as a full-width row of taps — no
                            dropdown, because a dropdown hides the options you
                            are trying to compare. */}
                        {c?.kind === 'choice' && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {c.options.map((o) => {
                              const active = c.value(selectedTenant) === o.value;
                              return (
                                <button key={o.value} type="button" disabled={!isMgr || busy === key}
                                  onClick={() => void save(key, c.field, o.value)}
                                  className={cn('h-9 flex-1 min-w-[7rem] rounded-xl border-2 px-2 text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50',
                                    active ? 'border-foreground bg-foreground text-background' : 'bg-white hover:border-primary/40')}>
                                  {o.label}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {c?.kind === 'number' && (
                          <div className="mt-2.5 flex items-center gap-2">
                            <input inputMode="numeric" aria-label={e.label}
                              value={draft[key] !== undefined ? draft[key] : String(c.value(selectedTenant))}
                              onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: ev.target.value.replace(/[^0-9]/g, '') }))}
                              disabled={!isMgr}
                              className="h-9 w-20 rounded-xl border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{c.unit}</span>
                            <Button size="sm" variant="outline"
                              disabled={!isMgr || busy === key || (draft[key] ?? String(c.value(selectedTenant))) === String(c.value(selectedTenant))}
                              onClick={() => {
                                const raw = Number(draft[key] ?? c.value(selectedTenant)) || 0;
                                const capped = c.max ? Math.min(c.max, Math.max(0, raw)) : Math.max(0, raw);
                                void save(key, c.field, c.transform ? c.transform(capped) : capped);
                              }}
                              className="h-9 rounded-xl border-2 px-3 font-black uppercase text-[8px] tracking-widest">
                              {busy === key ? <Loader className="h-3 w-3 animate-spin" /> : 'Set'}
                            </Button>
                          </div>
                        )}

                        {/* Only shown where you actually have to leave. */}
                        {c && (
                          <Link href={e.href}
                            className="mt-2 inline-block text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 underline-offset-4 hover:underline">
                            More in {e.screen}
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
