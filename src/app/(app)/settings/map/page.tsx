'use client';

// ─── /settings/map ────────────────────────────────────────────────────────────
// The settings map: your entire configuration, in plain language, grouped by
// the question you are actually asking.
//
// Deliberately NOT a control panel. Every setting in this product now lives on
// exactly one screen, and duplicating controls here would recreate the problem
// this page exists to solve. What it does instead is answer three questions the
// scattered screens could not:
//
//   1. What IS my configuration right now, stated as consequences?
//   2. Which screen owns each thing, so I stop hunting?
//   3. What have I left unset in a way that quietly disables something?
//
// That third one matters most. A rule that reads "enabled" on its own screen
// while a missing prerequisite makes it a no-op is the worst state a setting
// can be in, and nothing else in the app surfaces it.

import { AlertTriangle, ArrowLeft, ArrowRight, Check, Map as MapIcon } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { SETTING_GROUPS, attentionItems, summariseGroup } from '@/lib/settings-map';
import { cn } from '@/lib/utils';

export default function SettingsMapPage() {
  const { selectedTenant } = useTenant();
  const attention = useMemo(() => attentionItems(selectedTenant), [selectedTenant]);

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">How your studio is set up</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              Everything you have configured, in plain words
            </p>
          </div>
          <MapIcon className="h-5 w-5 text-muted-foreground" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* Things quietly switched off by a missing prerequisite. */}
        {attention.length > 0 && (
          <Card className="border-2 border-amber-300 rounded-[2rem] bg-amber-50">
            <CardContent className="p-5 space-y-3">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" /> {attention.length} thing{attention.length === 1 ? '' : 's'} not doing anything yet
              </p>
              {attention.map((a) => (
                <div key={a.label} className="flex items-start justify-between gap-3 border-t border-amber-200 pt-2.5 first:border-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-amber-900">{a.label}</p>
                    <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-amber-800/80">{a.warning}</p>
                  </div>
                  <Button asChild size="sm" variant="outline"
                    className="h-8 shrink-0 rounded-xl border-2 border-amber-400 bg-white px-2.5 font-black uppercase text-[8px] tracking-widest text-amber-900">
                    <Link href={a.href}>Fix</Link>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {attention.length === 0 && (
          <p className="flex items-center gap-2 rounded-2xl border-2 border-green-300 bg-green-50 px-4 py-3 text-[11px] font-bold text-green-800">
            <Check className="h-4 w-4 shrink-0" />
            Nothing is switched on but sitting idle — every rule you have set has what it needs to work.
          </p>
        )}

        {SETTING_GROUPS.map((g) => {
          const entries = summariseGroup(selectedTenant, g.id);
          if (entries.length === 0) return null;
          return (
            <Card key={g.id} className="border-2 rounded-[2rem] bg-white overflow-hidden">
              <CardContent className="p-0">
                <div className="border-b-2 bg-muted/20 px-5 py-4">
                  <p className="text-base font-black tracking-tight">{g.question}</p>
                  <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">{g.blurb}</p>
                </div>
                <div className="divide-y">
                  {entries.map((e) => (
                    <Link key={e.label} href={e.href}
                      className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-muted/20">
                      <div className="min-w-0">
                        <p className={cn('text-sm font-black', e.needsAttention && 'text-amber-800')}>
                          {e.label}
                          {e.needsAttention && <AlertTriangle className="ml-1.5 inline h-3 w-3" />}
                        </p>
                        <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">{e.summary}</p>
                        <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">
                          Set in {e.screen}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}

        <p className="px-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
          This page only reads. Every setting is changed on the one screen that owns it — which is why the same rule can
          never say two different things in two places.
        </p>
      </main>
    </div>
  );
}
