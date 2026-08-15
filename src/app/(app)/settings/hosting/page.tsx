'use client';

/**
 * /settings/hosting — how this business hosts.
 *
 * A standalone route (like /settings/automations) rather than another tab in
 * the main settings page, so it ships without touching that 1,400-line file.
 *
 * Everything here writes tenants/{id}.hostingSettings plus one floor-plan
 * template doc. The words a tenant picks are what every hosting surface will
 * say — the engine builds its sentences from them, so "table" appears only if
 * this screen said so.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_VOCABULARY, VOCABULARY_PRESETS, resolveVocabulary, type Vocabulary,
} from '@/lib/hosting';
import {
  FORMATION_BY_PRESET, resolveHostingSettings, templateFromEventTables, starterTemplate,
  type PartyFormation,
} from '@/lib/floor-plans';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, CalendarClock, CheckCircle2, LayoutGrid, MessageSquareText, Users,
} from 'lucide-react';

const FIELD = 'h-12 rounded-2xl border-2 font-bold bg-white focus:border-primary/50';
const FIELD_LABEL = 'text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1';

const Panel = ({ icon: Icon, title, hint, children }: {
  icon: any; title: string; hint: string; children: React.ReactNode;
}) => (
  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
    <CardHeader className="bg-muted/5 border-b p-6">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="space-y-1 text-left">
          <p className="text-sm font-black uppercase tracking-tight text-slate-900">{title}</p>
          <CardDescription className="text-[9px] font-bold uppercase tracking-widest opacity-60 leading-relaxed">{hint}</CardDescription>
        </div>
      </div>
    </CardHeader>
    <CardContent className="p-6 space-y-4 text-left">{children}</CardContent>
  </Card>
);

const WORD_FIELDS: Array<{ key: keyof Vocabulary; label: string; example: string }> = [
  { key: 'unit', label: 'One unit', example: 'table / station / room / bay' },
  { key: 'units', label: 'Several', example: 'tables' },
  { key: 'seat', label: 'One seat', example: 'seat / chair' },
  { key: 'seats', label: 'Several', example: 'seats' },
  { key: 'person', label: 'One person', example: 'guest / client / patient' },
  { key: 'people', label: 'Several', example: 'guests' },
  { key: 'party', label: 'One group', example: 'party / group / booking' },
  { key: 'parties', label: 'Several', example: 'parties' },
];

export default function HostingSettingsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  const { toast } = useToast();

  const [preset, setPreset] = useState('');
  const [words, setWords] = useState<Vocabulary>({ ...DEFAULT_VOCABULARY });
  const [formation, setFormation] = useState<PartyFormation>('host');
  const [holdBefore, setHoldBefore] = useState('30');
  const [holdGrace, setHoldGrace] = useState('15');
  const [cutover, setCutover] = useState('4');
  const [escalate, setEscalate] = useState('5');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [planStatus, setPlanStatus] = useState<string>('');

  // Load current settings + which events have a floor to import.
  useEffect(() => {
    if (!firestore || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await getDoc(doc(firestore, 'tenants', tenantId));
        const hs = resolveHostingSettings((t.data() as any)?.hostingSettings);
        if (cancelled) return;
        setWords(resolveVocabulary(hs.vocabulary));
        setPreset(hs.vocabularyPreset || '');
        setFormation(hs.partyFormation);
        setHoldBefore(String(hs.holdBeforeMinutes));
        setHoldGrace(String(hs.holdGraceMinutes));
        setCutover(String(hs.dayCutoverHour));
        setEscalate(String(hs.escalateAfterMinutes));

        const plan = await getDoc(doc(firestore, `tenants/${tenantId}/floorPlans`, 'default'));
        if (!cancelled && plan.exists()) {
          const units = (plan.data() as any)?.units || [];
          setPlanStatus(`${units.length} units, updated ${String((plan.data() as any)?.updatedAt || '').slice(0, 10)}`);
        }

        const evs = await getDocs(collection(firestore, `tenants/${tenantId}/studioEvents`));
        if (cancelled) return;
        setEvents(evs.docs
          .map((d) => ({ id: d.id, name: String((d.data() as any)?.name || d.id), count: ((d.data() as any)?.seatingTables || []).length }))
          .filter((e) => e.count > 0));
      } catch { /* page still renders; save will surface real errors */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId]);

  const applyPreset = (name: string) => {
    setPreset(name);
    const p = VOCABULARY_PRESETS[name];
    if (p) setWords({ ...p });
    if (FORMATION_BY_PRESET[name]) setFormation(FORMATION_BY_PRESET[name]);
  };

  const preview = useMemo(() => {
    const V = resolveVocabulary(words);
    return `“#4 is held for a ${V.party} arriving soon.” · “2 ${V.people} at a duplicated ${V.unit} name.”`;
  }, [words]);

  const save = async () => {
    if (!firestore || !tenantId) return;
    setSaving(true);
    try {
      const clamp = (v: string, d: number, lo: number, hi: number) => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
      };
      await updateDoc(doc(firestore, 'tenants', tenantId), {
        hostingSettings: {
          vocabulary: words,
          vocabularyPreset: preset || null,
          partyFormation: formation,
          holdBeforeMinutes: clamp(holdBefore, 30, 0, 240),
          holdGraceMinutes: clamp(holdGrace, 15, 0, 120),
          dayCutoverHour: clamp(cutover, 4, 0, 12),
          escalateAfterMinutes: clamp(escalate, 5, 1, 60),
        },
      });
      toast({ title: 'Hosting settings saved' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not save', description: e instanceof Error ? e.message : undefined });
    } finally { setSaving(false); }
  };

  const importPlan = async (source: 'starter' | string) => {
    if (!firestore || !tenantId) return;
    try {
      let units;
      if (source === 'starter') {
        units = starterTemplate();
      } else {
        const ev = await getDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, source));
        units = templateFromEventTables((ev.data() as any)?.seatingTables || []);
        if (units.length === 0) { toast({ variant: 'destructive', title: 'That event has no floor to import' }); return; }
      }
      await setDoc(doc(firestore, `tenants/${tenantId}/floorPlans`, 'default'), {
        id: 'default',
        units,
        updatedAt: new Date().toISOString(),
        source: source === 'starter' ? 'editor' : `event:${source}`,
      });
      setPlanStatus(`${units.length} units, updated ${new Date().toISOString().slice(0, 10)}`);
      toast({ title: 'Floor plan template saved' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Import failed', description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="p-2 rounded-xl border-2 bg-white hover:bg-muted/40">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="text-left">
          <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Module Operational</p>
          <h1 className="text-base font-black uppercase tracking-tighter text-slate-900">Hosting</h1>
        </div>
      </div>

      {!loaded && <p className="text-sm text-muted-foreground">Loading…</p>}

      {loaded && (
        <>
          <Panel icon={MessageSquareText} title="Your words" hint="Every hosting screen builds its sentences from these — nothing says “table” unless you do">
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Start from</Label>
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger className={FIELD}><SelectValue placeholder="Pick a starting point…" /></SelectTrigger>
                <SelectContent>
                  {Object.keys(VOCABULARY_PRESETS).map((k) => (
                    <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {WORD_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`w-${f.key}`} className={FIELD_LABEL}>{f.label}</Label>
                  <Input id={`w-${f.key}`} value={words[f.key]} placeholder={f.example}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWords((p) => ({ ...p, [f.key]: e.target.value }))}
                    className={FIELD} />
                </div>
              ))}
            </div>
            <p className="text-[10px] font-bold text-muted-foreground leading-relaxed border-2 border-dashed rounded-2xl px-4 py-3">
              {preview}
            </p>
          </Panel>

          <Panel icon={Users} title="How groups form" hint="Who creates a party — the host at the door, or the booking itself">
            <Select value={formation} onValueChange={(v: string) => setFormation(v === 'booking' ? 'booking' : 'host')}>
              <SelectTrigger className={FIELD}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="host">At the door — the host groups arrivals (restaurant, venue)</SelectItem>
                <SelectItem value="booking">From bookings — each appointment arrives as its own group (salon, spa, clinic)</SelectItem>
              </SelectContent>
            </Select>
          </Panel>

          <Panel icon={CalendarClock} title="Reservations and the day" hint="When a booked unit leaves the market, and when your business day rolls over">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hb" className={FIELD_LABEL}>Hold before (min)</Label>
                <Input id="hb" inputMode="numeric" value={holdBefore} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHoldBefore(e.target.value)} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hg" className={FIELD_LABEL}>Grace after (min)</Label>
                <Input id="hg" inputMode="numeric" value={holdGrace} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHoldGrace(e.target.value)} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co" className={FIELD_LABEL}>Day rolls over at (hour, 0–12)</Label>
                <Input id="co" inputMode="numeric" value={cutover} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCutover(e.target.value)} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="es" className={FIELD_LABEL}>Escalate requests after (min)</Label>
                <Input id="es" inputMode="numeric" value={escalate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEscalate(e.target.value)} className={FIELD} />
              </div>
            </div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 leading-relaxed ml-1">
              A 2am close with rollover at 4 still belongs to the previous day’s service.
            </p>
          </Panel>

          <Panel icon={LayoutGrid} title="Floor plan template" hint="What each service session copies at open — import once from an event, or start blank">
            {planStatus ? (
              <p className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-green-700">
                <CheckCircle2 className="w-3.5 h-3.5" /> Template saved — {planStatus}
              </p>
            ) : (
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">No template yet — sessions cannot open a floor without one.</p>
            )}
            <div className="flex flex-col gap-2">
              {events.map((e) => (
                <Button key={e.id} variant="outline" onClick={() => importPlan(e.id)}
                  className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 bg-white justify-between">
                  <span className="truncate">Import from “{e.name}”</span>
                  <span className="opacity-60">{e.count} units</span>
                </Button>
              ))}
              <Button variant="outline" onClick={() => importPlan('starter')}
                className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 bg-white">
                Start with a blank four-unit floor
              </Button>
            </div>
          </Panel>

          <Button onClick={save} disabled={saving || !tenantId}
            className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest">
            {saving ? 'Saving…' : 'Save hosting settings'}
          </Button>
        </>
      )}
    </div>
  );
}
