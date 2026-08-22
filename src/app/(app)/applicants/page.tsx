'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { useFirebase, updateDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Loader, Copy, Check, Share2, Send, Mail, Phone, ChevronDown, UserPlus, RefreshCw, ArrowRight } from 'lucide-react';

const STATUSES = ['new', 'reviewing', 'interview', 'offer', 'hired', 'declined'] as const;
type AppStatus = typeof STATUSES[number];

const STATUS_LABEL: Record<AppStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  declined: 'Declined',
};

const STATUS_TONE: Record<AppStatus, string> = {
  new: 'bg-sky-100 text-sky-900 border-sky-300',
  reviewing: 'bg-amber-100 text-amber-900 border-amber-300',
  interview: 'bg-violet-100 text-violet-900 border-violet-300',
  offer: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  hired: 'bg-slate-900 text-white border-slate-900',
  declined: 'bg-slate-100 text-slate-500 border-slate-300',
};

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const makePin = () => String(Math.floor(1000 + Math.random() * 9000));

const ApplicantCard = ({ app, onStatus, onHire, teamEmails }: { app: any; onStatus: (id: string, status: AppStatus) => void; onHire: (app: any, opts: { role: 'staff' | 'admin'; payStructure: string; pin: string }) => Promise<void>; teamEmails: Set<string> }) => {
  const [open, setOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [hireRole, setHireRole] = useState<'staff' | 'admin'>('staff');
  const [payStructure, setPayStructure] = useState('commission');
  const [pin, setPin] = useState(makePin);
  const [hiring, setHiring] = useState(false);
  const [hireError, setHireError] = useState('');
  const applied = safeDate(app.createdAt);
  const status: AppStatus = STATUSES.includes(app.status) ? app.status : 'new';
  const alreadyOnTeam = Boolean(app.staffId);
  const emailMatch = Boolean(app.email && teamEmails.has(String(app.email).trim().toLowerCase()));

  const handleHire = async () => {
    setHireError('');
    setHiring(true);
    try {
      await onHire(app, { role: hireRole, payStructure, pin });
    } catch (e: any) {
      console.error(e);
      setHireError('Could not add them to the team. Nothing was saved — please try again.');
    } finally {
      setHiring(false);
    }
  };

  return (
    <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <p className="truncate text-[15px] font-black tracking-tight text-slate-900">{app.name || 'No name'}</p>
            <p className="truncate text-[12px] font-bold text-muted-foreground">
              {app.position || 'No role given'}{applied ? ` · applied ${format(applied, 'MMM d')}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn('rounded-lg border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', STATUS_TONE[status])}>
              {STATUS_LABEL[status]}
            </span>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </div>
        </button>

        <div className="flex flex-wrap gap-1.5">
          {app.experienceLevel && (
            <span className="rounded-lg border-2 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">{app.experienceLevel}</span>
          )}
          {(app.availability || []).map((a: string) => (
            <span key={a} className="rounded-lg border-2 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">{a}</span>
          ))}
          {app.startWhen && (
            <span className="rounded-lg border-2 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">{app.startWhen}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {app.phone && (
            <a href={`tel:${app.phone}`} className="flex h-10 items-center gap-1.5 rounded-xl border-2 bg-white px-3 text-[11px] font-black uppercase tracking-widest text-slate-900">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call
            </a>
          )}
          {app.email && (
            <a href={`mailto:${app.email}`} className="flex h-10 items-center gap-1.5 rounded-xl border-2 bg-white px-3 text-[11px] font-black uppercase tracking-widest text-slate-900">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Email
            </a>
          )}
        </div>

        {open && (
          <div className="space-y-3 border-t-2 border-dashed pt-3">
            {app.license && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">License / certification</p>
                <p className="mt-0.5 text-[13px] font-bold text-slate-800">{app.license}</p>
              </div>
            )}
            {app.experience && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Experience</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-800">{app.experience}</p>
              </div>
            )}
            {app.message && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Anything else</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-800">{app.message}</p>
              </div>
            )}
            {(app.email || app.phone) && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Contact</p>
                <p className="mt-0.5 text-[13px] font-bold text-slate-800">{[app.email, app.phone].filter(Boolean).join(' · ')}</p>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Move to</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.filter(s => s !== status).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onStatus(app.id, s)}
                    className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', STATUS_TONE[s])}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>

            {alreadyOnTeam ? (
              <div className="rounded-2xl border-2 bg-slate-900 p-4">
                <p className="text-[11px] font-black uppercase tracking-widest text-white">On the team</p>
                <p className="mt-1 text-[12px] font-bold text-slate-300">Finish their setup from the Pro Team page — their card has a finish-onboarding button.</p>
                <a href="/staff" className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-[11px] font-black uppercase tracking-widest text-slate-900">
                  Go to Pro Team <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            ) : !hireOpen ? (
              <Button onClick={() => setHireOpen(true)} className="h-12 w-full rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">
                <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Hire — add to the team
              </Button>
            ) : (
              <div className="space-y-3 rounded-2xl border-2 bg-muted/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Add {app.name} to the team</p>
                {emailMatch && (
                  <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                    <p className="text-[11px] font-bold text-amber-900">Heads up — someone on the team already uses this email. Hiring again will create a second record.</p>
                  </div>
                )}
                <div>
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Access level</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['staff', 'admin'] as const).map(r => (
                      <button key={r} type="button" aria-pressed={hireRole === r} onClick={() => setHireRole(r)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', hireRole === r ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                        {r === 'staff' ? 'Team member' : 'Admin'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pay structure</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[['commission', 'Commission'], ['hourly', 'Hourly'], ['salary', 'Salary'], ['hourly_plus_commission', 'Hourly + commission']].map(([v, l]) => (
                      <button key={v} type="button" aria-pressed={payStructure === v} onClick={() => setPayStructure(v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', payStructure === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-muted-foreground">Rates start at the defaults — fine-tune them in Edit after hiring.</p>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Their clock-in PIN</p>
                  <div className="flex items-center gap-2">
                    <span className="rounded-xl border-2 bg-white px-4 py-2 font-mono text-lg font-black tracking-[0.3em] text-slate-900">{pin}</span>
                    <Button type="button" variant="outline" aria-label="New PIN" onClick={() => setPin(makePin())} className="h-11 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest">
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {hireError && (
                  <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-[11px] font-bold text-destructive">{hireError}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setHireOpen(false)} className="h-12 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">
                    Cancel
                  </Button>
                  <Button type="button" disabled={hiring} onClick={handleHire} className="h-12 flex-[2] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-60">
                    {hiring ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <>Confirm hire</>}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default function ApplicantsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const tenantId = selectedTenant?.id;
  const canManage = role === 'owner' || role === 'admin';

  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [lane, setLane] = useState<'active' | AppStatus>('active');
  const [q, setQ] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const applicationsQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/applications`) : null,
    [firestore, tenantId, canManage]
  );
  const { data: applications, isLoading } = useCollection(applicationsQuery);

  const staffQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/staff`) : null,
    [firestore, tenantId, canManage]
  );
  const { data: staff } = useCollection(staffQuery);

  const teamEmails = useMemo(() => {
    const s = new Set<string>();
    for (const m of (staff || []) as any[]) {
      if (m.email) s.add(String(m.email).trim().toLowerCase());
    }
    return s;
  }, [staff]);

  const handleHire = async (app: any, opts: { role: 'staff' | 'admin'; payStructure: string; pin: string }) => {
    if (!tenantId) throw new Error('No tenant');
    const staffId = nanoid();
    const record = {
      id: staffId,
      tenantId,
      name: String(app.name || '').trim(),
      email: String(app.email || '').trim(),
      phone: String(app.phone || '').trim(),
      role: opts.role,
      payStructure: opts.payStructure,
      pin: opts.pin,
      avatarUrl: '',
      active: false,
      onBreak: false,
      status: 'idle',
      specialties: [],
      services: [],
      assignedFormIds: [],
      commissionRate: 40,
      retailCommissionRate: 10,
      showOnPublicPage: true,
      hiredFromApplicationId: app.id,
    };
    await setDoc(doc(firestore, 'tenants', tenantId, 'staff', staffId), JSON.parse(JSON.stringify(record)));
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${app.id}`), {
      status: 'hired',
      staffId,
      hiredAt: serverTimestamp(),
    });
  };

  const applyUrl = tenantId && origin ? `${origin}/apply/${tenantId}` : '';

  const handleCopy = async () => {
    if (!applyUrl) return;
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', applyUrl);
    }
  };

  const handleShare = async () => {
    if (!applyUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Apply to ${selectedTenant?.name || 'our team'}`,
          text: `We're hiring — apply here:`,
          url: applyUrl,
        });
      } catch { /* user closed the sheet */ }
    } else {
      handleCopy();
    }
  };

  const handleStatus = (id: string, status: AppStatus) => {
    if (!tenantId) return;
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${id}`), { status });
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { active: 0 };
    for (const s of STATUSES) c[s] = 0;
    for (const a of (applications || []) as any[]) {
      const s = STATUSES.includes(a.status) ? a.status : 'new';
      c[s]++;
      if (s !== 'hired' && s !== 'declined') c.active++;
    }
    return c;
  }, [applications]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ((applications || []) as any[])
      .filter(a => {
        const s = STATUSES.includes(a.status) ? a.status : 'new';
        if (lane === 'active' ? (s === 'hired' || s === 'declined') : s !== lane) return false;
        if (!needle) return true;
        return `${a.name || ''} ${a.position || ''} ${a.email || ''} ${a.phone || ''}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => (safeDate(b.createdAt)?.getTime() || 0) - (safeDate(a.createdAt)?.getTime() || 0));
  }, [applications, lane, q]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Applicants" />
      <main className="flex-1 space-y-6 p-4 md:p-8 mx-auto w-full max-w-3xl">
        {!canManage ? (
          <Card className="rounded-[2rem] border-2 bg-white">
            <CardContent className="p-8 text-center">
              <p className="text-sm font-black uppercase tracking-widest text-slate-900">Managers only</p>
              <p className="mt-2 text-[12px] font-bold text-muted-foreground">Applications hold personal details, so only owners, admins, and managers can see them.</p>
            </CardContent>
          </Card>
        ) : (
        <>
        <Card className="rounded-[2rem] border-2 bg-slate-950 text-white overflow-hidden">
          <CardContent className="p-5 space-y-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Your application link</p>
              <p className="mt-1 break-all text-[13px] font-bold text-slate-200">{applyUrl || '…'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCopy} disabled={!applyUrl} className="h-11 rounded-xl bg-white text-slate-900 hover:bg-slate-200 px-4 text-[11px] font-black uppercase tracking-widest">
                {copied ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button onClick={handleShare} disabled={!applyUrl} variant="outline" className="h-11 rounded-xl border-2 border-white/30 bg-transparent text-white hover:bg-white/10 px-4 text-[11px] font-black uppercase tracking-widest">
                <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Share
              </Button>
            </div>
            <p className="text-[11px] font-bold text-slate-400">Put it in your bio, a job post, or a QR by the register — applications land here.</p>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label="Search applicants"
            placeholder="Search by name, role, or contact"
            className="h-12 rounded-2xl border-2 bg-white px-4 font-bold text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={lane === 'active'}
              onClick={() => setLane('active')}
              className={cn('h-9 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', lane === 'active' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}
            >
              Active ({counts.active})
            </button>
            {STATUSES.map(s => (
              <button
                key={s}
                type="button"
                aria-pressed={lane === s}
                onClick={() => setLane(s)}
                className={cn('h-9 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', lane === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}
              >
                {STATUS_LABEL[s]} ({counts[s]})
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader className="h-7 w-7 animate-spin text-slate-900" aria-label="Loading applications" />
          </div>
        ) : visible.length > 0 ? (
          <div className="space-y-4">
            {visible.map((app: any) => (
              <ApplicantCard key={app.id} app={app} onStatus={handleStatus} onHire={handleHire} teamEmails={teamEmails} />
            ))}
          </div>
        ) : (
          <div className="rounded-[2rem] border-2 border-dashed bg-white/60 py-14 text-center">
            <Send className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="mt-3 text-sm font-black uppercase tracking-widest text-slate-900">
              {(applications || []).length === 0 ? 'No applications yet' : 'Nothing in this lane'}
            </p>
            <p className="mt-1 text-[12px] font-bold text-muted-foreground">
              {(applications || []).length === 0
                ? 'Share your link above and applications will show up here.'
                : 'Try another lane or clear the search.'}
            </p>
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
}
