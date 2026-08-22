'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { useFirebase, updateDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Loader, Copy, Check, Share2, Send, Mail, Phone, ChevronDown } from 'lucide-react';

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

const ApplicantCard = ({ app, onStatus }: { app: any; onStatus: (id: string, status: AppStatus) => void }) => {
  const [open, setOpen] = useState(false);
  const applied = safeDate(app.createdAt);
  const status: AppStatus = STATUSES.includes(app.status) ? app.status : 'new';

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
              <ApplicantCard key={app.id} app={app} onStatus={handleStatus} />
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
