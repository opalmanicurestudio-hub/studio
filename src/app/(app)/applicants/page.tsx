'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { useFirebase, useUser, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc, setDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Loader, Copy, Check, Share2, Send, Mail, Phone, ChevronDown, UserPlus, RefreshCw, ArrowRight, Briefcase } from 'lucide-react';

const pumpComms = (payload: Record<string, string>) => {
  try {
    void fetch('/api/comms/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* message docs keep their own status; the timeline shows the truth */ });
  } catch { /* fire-and-forget */ }
};

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

const DECLINE_REASONS = ['Position filled', 'Not a fit right now', 'Experience level', 'Availability mismatch', 'Other'] as const;

const MESSAGE_TEMPLATES: Array<{ key: string; label: string; subject: (v: any) => string; body: (v: any) => string }> = [
  {
    key: 'forward',
    label: 'Moving forward',
    subject: v => `Your application to ${v.business}`,
    body: v => `Hi ${v.first},

Thanks for applying${v.role ? ` for ${v.role}` : ''} — we liked what we saw and we're moving your application forward. We'll be in touch soon with next steps.

${v.business}`,
  },
  {
    key: 'interview',
    label: 'Interview invite',
    subject: v => `Interview — ${v.business}`,
    body: v => `Hi ${v.first},

We'd love to meet you about${v.role ? ` the ${v.role} role` : ' your application'}. Reply to this email with a couple of days and times that work for you this week, and we'll confirm one.

${v.business}`,
  },
  {
    key: 'offer',
    label: 'Offer',
    subject: v => `Good news from ${v.business}`,
    body: v => `Hi ${v.first},

We'd like to offer you${v.role ? ` the ${v.role} position` : ' a position with us'}. Reply here or call us and we'll walk through the details together.

${v.business}`,
  },
  {
    key: 'newopening',
    label: 'New opening',
    subject: v => `A new opening at ${v.business}`,
    body: v => `Hi ${v.first},

You applied with us a while back and we kept your application on file — a new opening just came up${v.role ? ` that fits what you were looking for` : ''} and we thought of you. If you're still interested, reply here and we'll take it from there.

${v.business}`,
  },
  {
    key: 'decline',
    label: 'Kind decline',
    subject: v => `Your application to ${v.business}`,
    body: v => `Hi ${v.first},

Thank you for taking the time to apply. We've decided to go a different direction for now, but we were glad to meet you through your application and we'll keep it on file.

Wishing you the best,
${v.business}`,
  },
];

const GRID_DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']] as const;
const GRID_SLOT_LABEL: Record<string, string> = { am: 'AM', pm: 'PM', eve: 'Eve' };

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const makePin = () => String(Math.floor(1000 + Math.random() * 9000));

const ApplicantCard = ({ app, onStatus, onHire, teamEmails, consentForms, businessName, onSendMessage, timeline, onDecline, onScheduleInterview, invite, onCopyInviteLink, onAcceptProposed, onCancelInterview, publishedDocs }: { app: any; onStatus: (id: string, status: AppStatus) => void; onHire: (app: any, opts: { role: 'staff' | 'admin'; payStructure: string; pin: string; assignedFormIds: string[]; assignedDocIds?: string[] }) => Promise<void>; teamEmails: Set<string>; consentForms: any[]; businessName: string; onSendMessage: (app: any, subject: string, body: string) => Promise<void>; timeline: any[]; onDecline: (app: any, reason: string, talentPool: boolean) => void; onScheduleInterview: (app: any, slots: string[]) => Promise<void>; invite: any; onCopyInviteLink: (inviteId: string) => void; onAcceptProposed: (inviteId: string, slot: string) => void; onCancelInterview: (app: any, invite: any) => void; publishedDocs: any[] }) => {
  const [open, setOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [hireRole, setHireRole] = useState<'staff' | 'admin'>('staff');
  const [payStructure, setPayStructure] = useState('commission');
  const [pin, setPin] = useState(makePin);
  const [formIds, setFormIds] = useState<string[]>([]);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [hireError, setHireError] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [keepInPool, setKeepInPool] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [slots, setSlots] = useState<string[]>(['']);
  const [inviteError, setInviteError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState<'' | 'sent' | 'error'>('');

  const templateVars = { first: String(app.name || 'there').split(' ')[0], business: businessName, role: app.listingTitle || app.position || '' };

  const applyTemplate = (key: string) => {
    const t = MESSAGE_TEMPLATES.find(x => x.key === key);
    if (!t) return;
    setMsgSubject(t.subject(templateVars));
    setMsgBody(t.body(templateVars));
  };

  const handleSend = async () => {
    if (!msgBody.trim()) return;
    setSending(true);
    setSendState('');
    try {
      await onSendMessage(app, msgSubject.trim(), msgBody.trim());
      setSendState('sent');
      setComposeOpen(false);
      setMsgSubject('');
      setMsgBody('');
    } catch {
      setSendState('error');
    } finally {
      setSending(false);
    }
  };
  const applied = safeDate(app.createdAt);
  const status: AppStatus = STATUSES.includes(app.status) ? app.status : 'new';
  const alreadyOnTeam = Boolean(app.staffId);
  const emailMatch = Boolean(app.email && teamEmails.has(String(app.email).trim().toLowerCase()));

  const handleHire = async () => {
    setHireError('');
    setHiring(true);
    try {
      await onHire(app, { role: hireRole, payStructure, pin, assignedFormIds: formIds, assignedDocIds: docIds });
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
          {app.status === 'declined' && app.talentPool && (
            <span className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-900">Talent pool</span>
          )}
          {app.listingTitle && (
            <span className="flex items-center gap-1 rounded-lg border-2 bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white"><Briefcase className="h-3 w-3" aria-hidden="true" /> {app.listingTitle}</span>
          )}
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
            {app.availabilityGrid && Object.keys(app.availabilityGrid).length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Can work</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {GRID_DAYS.filter(([k]) => (app.availabilityGrid[k] || []).length > 0).map(([k, label]) => (
                    <span key={k} className="rounded-lg border-2 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">
                      {label} {(app.availabilityGrid[k] || []).map((sl: string) => GRID_SLOT_LABEL[sl] || sl).join('·')}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(app.answers) && app.answers.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Their answers</p>
                <div className="mt-1 space-y-2">
                  {app.answers.map((a: any, i: number) => (
                    <div key={a.id || i}>
                      <p className="text-[11px] font-bold text-muted-foreground">{a.label}</p>
                      <p className="whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-800">{a.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(app.email || app.phone) && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Contact</p>
                <p className="mt-0.5 text-[13px] font-bold text-slate-800">{[app.email, app.phone].filter(Boolean).join(' · ')}</p>
              </div>
            )}
            {app.email && !alreadyOnTeam && (
              <div className="space-y-2">
                {invite && invite.status === 'accepted' ? (
                  <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-3 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-900">Interview confirmed</p>
                    <p className="mt-0.5 text-[13px] font-black text-emerald-900">{invite.chosenSlot ? format(safeDate(invite.chosenSlot) as Date, 'EEEE, MMM d · h:mm a') : ''}</p>
                    <Button type="button" variant="outline" onClick={() => onCancelInterview(app, invite)} className="h-auto min-h-10 w-full whitespace-normal rounded-xl border-2 py-2 text-[10px] font-black uppercase leading-tight tracking-widest text-destructive border-destructive/30 sm:w-auto">
                      Cancel this interview (emails them)
                    </Button>
                    <p className="text-[11px] font-bold text-emerald-900/70">To move it instead, cancel, then propose new times below.</p>
                  </div>
                ) : invite && invite.status === 'canceled' ? (
                  <div className="rounded-2xl border-2 border-dashed bg-slate-50 p-3">
                    <p className="text-[11px] font-bold text-slate-600">Interview canceled — they&apos;ve been emailed. Propose new times below whenever you&apos;re ready.</p>
                  </div>
                ) : invite && invite.status === 'needs_new_times' ? (
                  <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
                    <p className="text-[11px] font-bold text-amber-900">None of the offered times worked — propose new ones below.</p>
                  </div>
                ) : invite && invite.status === 'countered' ? (
                  <div className="rounded-2xl border-2 border-slate-900 bg-white p-3 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-900">They sent their availability</p>
                    {invite.applicantNote && <p className="text-[12px] font-bold text-slate-600">\u201c{invite.applicantNote}\u201d</p>}
                    <div className="space-y-1.5">
                      {(invite.proposedSlots || []).map((sl: string, i: number) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onAcceptProposed(invite.id, sl)}
                          className="flex h-11 w-full items-center justify-between rounded-xl border-2 bg-white px-3 text-left hover:border-slate-900"
                        >
                          <span className="text-[12px] font-black text-slate-900">{format(new Date(sl), 'EEE, MMM d \u00b7 h:mm a')}</span>
                          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Accept ✓</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground">Accepting emails them the confirmation automatically. If none work, schedule fresh times below — the new invite supersedes this one.</p>
                  </div>
                ) : invite && invite.status === 'pending' ? (
                  <div className="rounded-2xl border-2 border-dashed bg-slate-50 p-3 space-y-2">
                    <p className="text-[11px] font-bold text-slate-600">Interview invite sent — waiting on their pick.</p>
                    <Button type="button" variant="outline" onClick={() => { onCopyInviteLink(invite.id); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); }} className={cn('h-auto min-h-11 w-full whitespace-normal rounded-xl border-2 px-3 py-2 text-[10px] font-black uppercase leading-tight tracking-widest sm:w-auto', linkCopied && 'border-emerald-400 bg-emerald-50 text-emerald-800')}>
                      {linkCopied ? 'Link copied ✓ — paste it in a text' : 'Copy their scheduling link'}
                    </Button>
                    <p className="text-[10px] font-bold text-muted-foreground">Same link the email carries — text it to them directly if email is slow.</p>
                  </div>
                ) : null}
                {!inviteOpen ? (
                  <Button type="button" variant="outline" onClick={() => setInviteOpen(true)} className="h-11 w-full rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">
                    <ChevronDown className="mr-1.5 h-3.5 w-3.5 shrink-0 rotate-[-90deg]" aria-hidden="true" /> <span className="whitespace-normal leading-tight">{invite ? 'Propose new interview times' : 'Schedule interview'}</span>
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-2xl border-2 bg-muted/10 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Offer up to 3 times — they pick one</p>
                    {slots.map((slot, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <label htmlFor={`slot-${app.id}-${i}`} className="sr-only">Time option {i + 1}</label>
                        <input
                          id={`slot-${app.id}-${i}`}
                          type="datetime-local"
                          value={slot}
                          onChange={e => setSlots(prev => prev.map((x, xi) => xi === i ? e.target.value : x))}
                          className="h-12 flex-1 rounded-xl border-2 bg-white px-3 font-bold text-sm"
                        />
                        {slots.length > 1 && (
                          <Button type="button" variant="outline" aria-label={`Remove time option ${i + 1}`} onClick={() => setSlots(prev => prev.filter((_, xi) => xi !== i))} className="h-12 w-12 rounded-xl border-2 p-0 font-black">✕</Button>
                        )}
                      </div>
                    ))}
                    {slots.length < 3 && (
                      <Button type="button" variant="outline" onClick={() => setSlots(prev => [...prev, ''])} className="h-10 w-full rounded-xl border-2 border-dashed text-[11px] font-black uppercase tracking-widest">+ Another time</Button>
                    )}
                    {inviteError && <p className="text-[11px] font-bold text-destructive">{inviteError}</p>}
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
                      <Button type="button" disabled={inviting} onClick={async () => {
                        const clean = slots.filter(x => x && !isNaN(new Date(x).getTime()));
                        if (clean.length === 0) { setInviteError('Add at least one valid time.'); return; }
                        setInviteError(''); setInviting(true);
                        try { await onScheduleInterview(app, clean); setInviteOpen(false); setSlots(['']); }
                        catch { setInviteError('Couldn\u2019t send the invite — try again.'); }
                        finally { setInviting(false); }
                      }} className="h-11 flex-[2] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-60">
                        {inviting ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Send invite'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {app.email ? (
              <div className="space-y-2">
                {!composeOpen ? (
                  <Button type="button" variant="outline" onClick={() => setComposeOpen(true)} className="h-11 w-full rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">
                    <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Send a message
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-2xl border-2 bg-muted/10 p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {MESSAGE_TEMPLATES.map(t => (
                        <button key={t.key} type="button" onClick={() => applyTemplate(t.key)} className="h-9 rounded-lg border-2 bg-white px-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700">
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <label htmlFor={`msg-subj-${app.id}`} className="sr-only">Subject</label>
                    <Input id={`msg-subj-${app.id}`} value={msgSubject} onChange={e => setMsgSubject(e.target.value)} maxLength={200} placeholder="Subject" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
                    <label htmlFor={`msg-body-${app.id}`} className="sr-only">Message</label>
                    <textarea id={`msg-body-${app.id}`} value={msgBody} onChange={e => setMsgBody(e.target.value)} maxLength={5000} rows={6} placeholder="Pick a template above or write your own" className="w-full rounded-xl border-2 bg-white p-3 font-bold text-sm" />
                    {sendState === 'error' && <p className="text-[11px] font-bold text-destructive">Couldn&apos;t queue the message — try again.</p>}
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setComposeOpen(false)} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
                      <Button type="button" disabled={sending || !msgBody.trim()} onClick={handleSend} className="h-11 flex-[2] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-60">
                        {sending ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Send email'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] font-bold text-muted-foreground">No email on this application — use the phone number to reach them.</p>
            )}

            {timeline.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">History</p>
                <div className="space-y-1.5">
                  {timeline.map((ev: any) => {
                    const when = safeDate(ev.createdAt);
                    return (
                      <div key={ev.id} className="flex items-start justify-between gap-2 rounded-xl border-2 border-dashed bg-slate-50/60 px-3 py-2">
                        <p className="min-w-0 text-[12px] font-bold text-slate-700">
                          {ev.type === 'status'
                            ? `${ev.note ? ev.note : `Moved to ${STATUS_LABEL[(ev.toStatus as AppStatus)] || ev.toStatus}`}`
                            : `Email: ${ev.subject || '(no subject)'}${ev.status === 'failed' ? ' — failed to send' : ev.status === 'queued' ? ' — sending…' : ''}`}
                          {ev.by ? <span className="text-muted-foreground font-bold"> · {ev.by}</span> : null}
                        </p>
                        <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{when ? format(when, 'MMM d, h:mm a') : ''}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Move to</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.filter(s => s !== status).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { if (s === 'declined') { setDeclineOpen(v => !v); } else { setDeclineOpen(false); onStatus(app.id, s); } }}
                    className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', STATUS_TONE[s])}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              {declineOpen && (
                <div className="mt-2 space-y-2 rounded-2xl border-2 bg-muted/10 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Why? (kept private)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DECLINE_REASONS.map(r => (
                      <button key={r} type="button" aria-pressed={declineReason === r} onClick={() => setDeclineReason(r)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', declineReason === r ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <button type="button" aria-pressed={keepInPool} onClick={() => setKeepInPool(v => !v)} className={cn('h-10 w-full rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', keepInPool ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-white text-muted-foreground')}>
                    {keepInPool ? 'Keep in talent pool for future openings ✓' : 'Don\u2019t keep on file'}
                  </button>
                  <Button type="button" onClick={() => { onDecline(app, declineReason, keepInPool); setDeclineOpen(false); }} className="h-11 w-full rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">
                    Confirm decline
                  </Button>
                </div>
              )}
              <div className="hidden">
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
                {consentForms.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Forms to sign during onboarding</p>
                    <div className="flex flex-wrap gap-1.5">
                      {consentForms.map((f: any) => {
                        const on = formIds.includes(f.id);
                        return (
                          <button key={f.id} type="button" aria-pressed={on} onClick={() => setFormIds(prev => on ? prev.filter(x => x !== f.id) : [...prev, f.id])} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                            {f.title || 'Untitled form'}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] font-bold text-muted-foreground">Selected forms are assigned now and collected in their onboarding.</p>
                  </div>
                )}
                {publishedDocs.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Handbook &amp; SOPs to assign</p>
                    <div className="flex flex-wrap gap-1.5">
                      {publishedDocs.map((dd: any) => {
                        const on = docIds.includes(dd.id);
                        return (
                          <button key={dd.id} type="button" aria-pressed={on} onClick={() => setDocIds(prev => on ? prev.filter(x => x !== dd.id) : [...prev, dd.id])} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                            {dd.title || 'Untitled'}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] font-bold text-muted-foreground">These land in their Documents library to read and confirm.</p>
                  </div>
                )}
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

const ListingsManager = ({ listings, applyBase, onCreate, onUpdate, onDelete }: { listings: any[]; applyBase: string; onCreate: (l: any) => void; onUpdate: (id: string, patch: any) => void; onDelete: (id: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [payRange, setPayRange] = useState('');
  const [scheduleNote, setScheduleNote] = useState('');
  const [requirements, setRequirements] = useState('');
  const [err, setErr] = useState('');
  const [copiedId, setCopiedId] = useState('');

  const startNew = () => { setEditing('new'); setTitle(''); setDescription(''); setPayRange(''); setScheduleNote(''); setRequirements(''); setErr(''); };
  const startEdit = (l: any) => { setEditing(l.id); setTitle(l.title || ''); setDescription(l.description || ''); setPayRange(l.payRange || ''); setScheduleNote(l.scheduleNote || ''); setRequirements(l.requirements || ''); setErr(''); };

  const save = () => {
    const t = title.trim().slice(0, 120);
    if (!t) { setErr('The role needs a title.'); return; }
    const body = {
      title: t,
      description: description.trim().slice(0, 2000),
      payRange: payRange.trim().slice(0, 80),
      scheduleNote: scheduleNote.trim().slice(0, 80),
      requirements: requirements.trim().slice(0, 2000),
    };
    if (editing === 'new') onCreate(body); else if (editing) onUpdate(editing, body);
    setEditing(null);
  };

  const copyLink = async (id: string) => {
    const url = `${applyBase}?job=${id}`;
    try { await navigator.clipboard.writeText(url); setCopiedId(id); setTimeout(() => setCopiedId(''), 2000); }
    catch { window.prompt('Copy this link:', url); }
  };

  const sorted = [...listings].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

  const editorFields = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="jl-title" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Role title</label>
        <Input id="jl-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Front desk, weekend technician" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="jl-desc" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Description</label>
        <textarea id="jl-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={3} className="w-full rounded-xl border-2 bg-white p-3 font-bold text-sm" placeholder="What the job is, day to day" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label htmlFor="jl-pay" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pay</label>
          <Input id="jl-pay" value={payRange} onChange={e => setPayRange(e.target.value)} maxLength={80} placeholder="e.g. $18–22/hr" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="jl-sched" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Schedule</label>
          <Input id="jl-sched" value={scheduleNote} onChange={e => setScheduleNote(e.target.value)} maxLength={80} placeholder="e.g. Part-time, weekends" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="jl-req" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What you&apos;re looking for</label>
        <textarea id="jl-req" value={requirements} onChange={e => setRequirements(e.target.value)} maxLength={2000} rows={2} className="w-full rounded-xl border-2 bg-white p-3 font-bold text-sm" placeholder="Experience, certifications, must-haves" />
      </div>
      {err && <p className="text-[11px] font-bold text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setEditing(null)} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
        <Button type="button" onClick={save} className="h-11 flex-[2] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">Save role</Button>
      </div>
    </div>
  );

  return (
    <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Open roles</p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
              {listings.length > 0 ? `${listings.filter((l: any) => l.status === 'open').length} open · ${listings.length} total` : 'Post the roles you\u2019re hiring for'}
            </p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {open && (
          <div className="space-y-3 border-t-2 border-dashed pt-3">
            <p className="text-[11px] font-bold text-muted-foreground">
              With roles posted, your application link opens with the list — applicants pick one and apply to it. No roles means the general application, as now.
            </p>
            {sorted.map((l: any) => (
              <div key={l.id} className="rounded-2xl border-2 p-3 space-y-2">
                {editing === l.id ? editorFields : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-black tracking-tight text-slate-900">{l.title}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          {l.status === 'open' ? 'Open' : 'Closed'}{l.payRange ? ` · ${l.payRange}` : ''}{l.scheduleNote ? ` · ${l.scheduleNote}` : ''}
                        </p>
                      </div>
                      <button type="button" aria-pressed={l.status === 'open'} onClick={() => onUpdate(l.id, { status: l.status === 'open' ? 'closed' : 'open' })} className={cn('h-9 shrink-0 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', l.status === 'open' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-slate-100 text-slate-500')}>
                        {l.status === 'open' ? 'Open' : 'Closed'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button type="button" variant="outline" onClick={() => copyLink(l.id)} className="h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest">
                        {copiedId === l.id ? 'Copied' : 'Copy link'}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => startEdit(l)} className="h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest">Edit</Button>
                      <Button type="button" variant="outline" aria-label={`Remove role ${l.title}`} onClick={() => onDelete(l.id)} className="h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest text-destructive border-destructive/30">Remove</Button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {editing === 'new' ? (
              <div className="rounded-2xl border-2 p-3">{editorFields}</div>
            ) : (
              <Button type="button" variant="outline" onClick={startNew} className="h-11 w-full rounded-xl border-2 border-dashed text-[11px] font-black uppercase tracking-widest">
                + Post a role
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const QUESTION_TYPES = [
  ['text', 'Short answer'],
  ['paragraph', 'Paragraph'],
  ['choice', 'Multiple choice'],
  ['yesno', 'Yes / no'],
] as const;

const MAX_QUESTIONS = 8;

const QuestionBuilder = ({ questions, onSave }: { questions: any[]; onSave: (list: any[]) => void }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [qType, setQType] = useState<'text' | 'paragraph' | 'choice' | 'yesno'>('text');
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState('');
  const [editError, setEditError] = useState('');

  const startNew = () => {
    setEditing(-1);
    setLabel('');
    setQType('text');
    setRequired(false);
    setOptionsText('');
    setEditError('');
  };

  const startEdit = (i: number) => {
    const q = questions[i];
    setEditing(i);
    setLabel(q.label || '');
    setQType(q.type || 'text');
    setRequired(Boolean(q.required));
    setOptionsText((q.options || []).join('\n'));
    setEditError('');
  };

  const saveDraft = () => {
    const cleanLabel = label.trim().slice(0, 140);
    if (!cleanLabel) { setEditError('The question needs wording.'); return; }
    const options = qType === 'choice'
      ? optionsText.split('\n').map(o => o.trim().slice(0, 60)).filter(Boolean).slice(0, 8)
      : [];
    if (qType === 'choice' && options.length < 2) { setEditError('Multiple choice needs at least two options, one per line.'); return; }
    const q = {
      id: editing !== null && editing >= 0 ? questions[editing].id : nanoid(),
      label: cleanLabel,
      type: qType,
      required,
      options,
    };
    const next = [...questions];
    if (editing !== null && editing >= 0) next[editing] = q; else next.push(q);
    onSave(next);
    setEditing(null);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    onSave(next);
  };

  const remove = (i: number) => onSave(questions.filter((_, x) => x !== i));

  return (
    <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Application questions</p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
              {questions.length > 0 ? `${questions.length} custom question${questions.length === 1 ? '' : 's'} added` : 'Add your own questions to the application'}
            </p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {open && (
          <div className="space-y-3 border-t-2 border-dashed pt-3">
            <p className="text-[11px] font-bold text-muted-foreground">
              Name, contact, role, availability, and experience are always asked. Your questions appear after those.
            </p>

            {questions.map((q, i) => (
              <div key={q.id} className="rounded-2xl border-2 p-3">
                {editing === i ? null : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-black tracking-tight text-slate-900">{q.label}</p>
                      <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        {(QUESTION_TYPES.find(t => t[0] === q.type)?.[1]) || 'Short answer'}{q.required ? ' · required' : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="outline" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="h-9 w-9 rounded-lg border-2 p-0 text-xs font-black">↑</Button>
                      <Button type="button" variant="outline" aria-label="Move down" disabled={i === questions.length - 1} onClick={() => move(i, 1)} className="h-9 w-9 rounded-lg border-2 p-0 text-xs font-black">↓</Button>
                      <Button type="button" variant="outline" onClick={() => startEdit(i)} className="h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest">Edit</Button>
                      <Button type="button" variant="outline" aria-label={`Remove question: ${q.label}`} onClick={() => remove(i)} className="h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest text-destructive border-destructive/30">✕</Button>
                    </div>
                  </div>
                )}
                {editing === i && (
                  <QuestionEditorFields {...{ label, setLabel, qType, setQType, required, setRequired, optionsText, setOptionsText, editError, saveDraft, cancel: () => setEditing(null) }} />
                )}
              </div>
            ))}

            {editing === -1 ? (
              <div className="rounded-2xl border-2 p-3">
                <QuestionEditorFields {...{ label, setLabel, qType, setQType, required, setRequired, optionsText, setOptionsText, editError, saveDraft, cancel: () => setEditing(null) }} />
              </div>
            ) : questions.length < MAX_QUESTIONS ? (
              <Button type="button" variant="outline" onClick={startNew} className="h-11 w-full rounded-xl border-2 border-dashed text-[11px] font-black uppercase tracking-widest">
                + Add a question
              </Button>
            ) : (
              <p className="text-center text-[11px] font-bold text-muted-foreground">That&apos;s the limit — {MAX_QUESTIONS} questions keeps applying quick.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const QuestionEditorFields = ({ label, setLabel, qType, setQType, required, setRequired, optionsText, setOptionsText, editError, saveDraft, cancel }: any) => (
  <div className="space-y-3">
    <div className="space-y-1.5">
      <label htmlFor="qb-label" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Question</label>
      <Input id="qb-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={140} placeholder="e.g. Do you have weekend availability?" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
    </div>
    <div className="space-y-1.5">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Answer type</p>
      <div className="flex flex-wrap gap-1.5">
        {QUESTION_TYPES.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={qType === v} onClick={() => setQType(v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', qType === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
            {l}
          </button>
        ))}
      </div>
    </div>
    {qType === 'choice' && (
      <div className="space-y-1.5">
        <label htmlFor="qb-options" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Options — one per line</label>
        <textarea id="qb-options" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} className="w-full rounded-xl border-2 bg-white p-3 font-bold text-sm" placeholder={'Morning\nAfternoon\nEvening'} />
      </div>
    )}
    <button type="button" aria-pressed={required} onClick={() => setRequired((r: boolean) => !r)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', required ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
      {required ? 'Required ✓' : 'Optional'}
    </button>
    {editError && <p className="text-[11px] font-bold text-destructive">{editError}</p>}
    <div className="flex gap-2">
      <Button type="button" variant="outline" onClick={cancel} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
      <Button type="button" onClick={saveDraft} className="h-11 flex-[2] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">Save question</Button>
    </div>
  </div>
);

const ApplicantCardWithData = (props: any) => {
  const { firestore } = useFirebase();
  const { app, tenantId } = props;
  const msgsQuery = useMemoFirebase(
    () => (tenantId ? collection(firestore, `tenants/${tenantId}/applications/${app.id}/messages`) : null),
    [firestore, tenantId, app.id]
  );
  const { data: events } = useCollection(msgsQuery);
  const pumpedOnce = React.useRef(false);
  useEffect(() => {
    if (pumpedOnce.current || !tenantId) return;
    const stuck = ((events || []) as any[]).some((m: any) => m.type === 'email' && m.status === 'queued');
    if (stuck) {
      pumpedOnce.current = true;
      pumpComms({ kind: 'messages', tenantId, applicationId: app.id });
    }
  }, [events, tenantId, app.id]);
  const timeline = useMemo(
    () => ([...((events || []) as any[])]).sort((a, b) => (safeDate(b.createdAt)?.getTime() || 0) - (safeDate(a.createdAt)?.getTime() || 0)).slice(0, 20),
    [events]
  );
  return <ApplicantCard {...props} timeline={timeline} />;
};

export default function ApplicantsPage() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant, role } = useTenant();
  const actorName = currentUser?.displayName || currentUser?.email || 'A manager';
  const tenantId = selectedTenant?.id;
  const canManage = role === 'owner' || role === 'admin';

  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [lane, setLane] = useState<'active' | 'pool' | AppStatus>('active');
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

  const consentFormsQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/consentForms`) : null,
    [firestore, tenantId, canManage]
  );
  const { data: consentForms } = useCollection(consentFormsQuery);

  const listingsQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/jobListings`) : null,
    [firestore, tenantId, canManage]
  );
  const { data: listings } = useCollection(listingsQuery);

  const teamEmails = useMemo(() => {
    const s = new Set<string>();
    for (const m of (staff || []) as any[]) {
      if (m.email) s.add(String(m.email).trim().toLowerCase());
    }
    return s;
  }, [staff]);

  const handleHire = async (app: any, opts: { role: 'staff' | 'admin'; payStructure: string; pin: string; assignedFormIds: string[]; assignedDocIds?: string[] }) => {
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
      assignedFormIds: opts.assignedFormIds || [],
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
    for (const docId of (opts.assignedDocIds || [])) {
      updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/documents/${docId}`), {
        assignedStaffIds: arrayUnion(staffId),
      });
    }
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
    const evId = nanoid();
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${id}/messages/${evId}`), {
      id: evId, type: 'status', toStatus: status, by: actorName, createdAt: new Date().toISOString(),
    }, { merge: false });
  };

  const invitesQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/interviewInvites`) : null,
    [firestore, tenantId, canManage]
  );
  const { data: invites } = useCollection(invitesQuery);
  const inviteByApplication = useMemo(() => {
    const m = new Map<string, any>();
    const sorted = [...((invites || []) as any[])].sort((a, b) => (safeDate(a.createdAt)?.getTime() || 0) - (safeDate(b.createdAt)?.getTime() || 0));
    for (const inv of sorted) if (inv.applicationId) m.set(inv.applicationId, inv);
    return m;
  }, [invites]);

  const supersedeOpenInvites = (applicationId: string) => {
    if (!tenantId) return;
    for (const inv of ((invites || []) as any[])) {
      if (inv.applicationId !== applicationId) continue;
      if (inv.status === 'pending' || inv.status === 'countered' || inv.status === 'needs_new_times') {
        updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/interviewInvites/${inv.id}`), {
          status: 'superseded',
          supersededAt: new Date().toISOString(),
        });
      }
    }
  };

  const documentsQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/documents`) : null,
    [firestore, tenantId, canManage]
  );
  const { data: tenantDocs } = useCollection(documentsQuery);
  const publishedDocs = useMemo(
    () => ((tenantDocs || []) as any[]).filter(d => d.status === 'published').sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
    [tenantDocs]
  );

  const [focusAppId, setFocusAppId] = useState('');
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('app') || '';
      if (id) setFocusAppId(id);
    } catch { /* no-op */ }
  }, []);
  useEffect(() => {
    if (!focusAppId) return;
    const t = setTimeout(() => {
      document.getElementById(`applicant-${focusAppId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
    const fade = setTimeout(() => {
      setFocusAppId('');
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete('app');
        window.history.replaceState({}, '', u.toString());
      } catch { /* cosmetic only */ }
    }, 6000);
    return () => { clearTimeout(t); clearTimeout(fade); };
  }, [focusAppId, applications]);

  const handleCancelInterview = async (app: any, invite: any) => {
    if (!tenantId) return;
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/interviewInvites/${invite.id}`), {
      status: 'canceled',
      canceledAt: new Date().toISOString(),
    });
    const whenStr = invite.chosenSlot ? (() => { try { const dd = safeDate(invite.chosenSlot); return dd ? format(dd as Date, 'EEEE, MMM d \u00b7 h:mm a') : ''; } catch { return ''; } })() : '';
    const businessName = selectedTenant?.name || 'our team';
    const msgId = nanoid();
    await setDoc(doc(firestore, `tenants/${tenantId}/applications/${app.id}/messages/${msgId}`), {
      id: msgId,
      type: 'email',
      status: 'queued',
      to: app.email || '',
      subject: `Interview update — ${businessName}`,
      body: `Hi ${String(app.name || 'there').split(' ')[0]},\n\nWe need to cancel ${whenStr ? `our interview scheduled for ${whenStr}` : 'our upcoming interview'} — our apologies for the change of plans. This isn\u2019t a reflection on your application: we\u2019ll follow up shortly with new times.\n\nThank you for your patience,\n${businessName}`,
      by: actorName,
      createdAt: new Date().toISOString(),
    });
    pumpComms({ kind: 'messages', tenantId, applicationId: app.id });
  };

  const handleAcceptProposed = async (inviteId: string, slot: string) => {
    if (!tenantId) return;
    const { updateDoc } = await import('firebase/firestore');
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/interviewInvites/${inviteId}`), {
        status: 'accepted',
        chosenSlot: slot,
      });
      pumpComms({ kind: 'interview', tenantId, token: inviteId });
    } catch (e) {
      console.error('accept proposed failed', e);
    }
  };

  const handleCopyInviteLink = async (inviteId: string) => {
    const url = `${origin}/interview/${tenantId}/${inviteId}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt('Copy this link:', url); }
  };

  const handleDecline = (app: any, reason: string, talentPool: boolean) => {
    if (!tenantId) return;
    supersedeOpenInvites(app.id);
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${app.id}`), {
      status: 'declined',
      declineReason: reason || '',
      talentPool,
    });
    const evId = nanoid();
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${app.id}/messages/${evId}`), {
      id: evId, type: 'status', toStatus: 'declined', note: [reason, talentPool ? 'kept in talent pool' : ''].filter(Boolean).join(' · '), by: actorName, createdAt: new Date().toISOString(),
    }, { merge: false });
  };

  const handleScheduleInterview = async (app: any, slots: string[]) => {
    if (!tenantId || !app?.email) throw new Error('Missing recipient');
    supersedeOpenInvites(app.id);
    const token = nanoid();
    const { setDoc } = await import('firebase/firestore');
    await setDoc(doc(firestore, `tenants/${tenantId}/interviewInvites/${token}`), {
      id: token,
      applicationId: app.id,
      firstName: String(app.name || 'there').split(' ')[0],
      roleTitle: String(app.listingTitle || app.position || '').slice(0, 120),
      slots: slots.slice(0, 3).map(x => new Date(x).toISOString()),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    const link = `${origin}/interview/${tenantId}/${token}`;
    await handleSendMessage(app, `Interview — ${selectedTenant?.name || 'our team'}`,
      `Hi ${String(app.name || 'there').split(' ')[0]},

We'd love to meet you${app.listingTitle ? ` about the ${app.listingTitle} role` : ''}. Pick the time that works best for you here:

${link}

If none of them work, the page lets us know and we'll offer others.

${selectedTenant?.name || ''}`, { skipAutoAdvance: true });
    const evId = nanoid();
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${app.id}/messages/${evId}`), {
      id: evId, type: 'status', toStatus: 'interview', note: 'interview times offered', by: actorName, createdAt: new Date().toISOString(),
    }, { merge: false });
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${app.id}`), { status: 'interview' });
  };

  const handleSendMessage = async (app: any, subject: string, body?: string, opts?: { skipAutoAdvance?: boolean }) => {
    if (!tenantId || !app?.email) throw new Error('No recipient');
    const msgId = nanoid();
    const { setDoc } = await import('firebase/firestore');
    await setDoc(doc(firestore, `tenants/${tenantId}/applications/${app.id}/messages/${msgId}`), {
      id: msgId,
      type: 'email',
      status: 'queued',
      to: String(app.email).trim(),
      subject: subject.slice(0, 200),
      body: String(body || '').slice(0, 5000),
      by: actorName,
      createdAt: new Date().toISOString(),
    });
    pumpComms({ kind: 'messages', tenantId, applicationId: app.id });
    if (!opts?.skipAutoAdvance && app.status === 'new') {
      updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${app.id}`), { status: 'reviewing' });
      const evId = nanoid();
      setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/applications/${app.id}/messages/${evId}`), {
        id: evId, type: 'status', toStatus: 'reviewing', note: 'moved automatically — first message sent', by: actorName, createdAt: new Date().toISOString(),
      }, { merge: false });
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { active: 0, pool: 0 };
    for (const s of STATUSES) c[s] = 0;
    for (const a of (applications || []) as any[]) {
      const s = STATUSES.includes(a.status) ? a.status : 'new';
      c[s]++;
      if (s !== 'hired' && s !== 'declined') c.active++;
      if (s === 'declined' && a.talentPool) c.pool++;
    }
    return c;
  }, [applications]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ((applications || []) as any[])
      .filter(a => {
        if (focusAppId && a.id === focusAppId) return true;
        const s = STATUSES.includes(a.status) ? a.status : 'new';
        if (lane === 'pool') { if (!(s === 'declined' && a.talentPool)) return false; }
        else if (lane === 'active' ? (s === 'hired' || s === 'declined') : s !== lane) return false;
        if (!needle) return true;
        return `${a.name || ''} ${a.position || ''} ${a.listingTitle || ''} ${a.email || ''} ${a.phone || ''}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => (safeDate(b.createdAt)?.getTime() || 0) - (safeDate(a.createdAt)?.getTime() || 0));
  }, [applications, lane, q, focusAppId]);

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

        <ListingsManager
          listings={(listings || []) as any[]}
          applyBase={applyUrl}
          onCreate={(body) => {
            if (!tenantId) return;
            const id = nanoid();
            setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/jobListings/${id}`), { ...body, id, status: 'open', createdAt: serverTimestamp() }, { merge: false });
          }}
          onUpdate={(id, patch) => {
            if (!tenantId) return;
            updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/jobListings/${id}`), patch);
          }}
          onDelete={(id) => {
            if (!tenantId) return;
            deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/jobListings/${id}`));
          }}
        />

        {role === 'owner' && (
          <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
            <CardContent className="p-5 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Confirmation email note</p>
              <p className="text-[12px] font-bold text-muted-foreground">Every applicant gets an instant "we got it" email. This note rides along — introduce the business, the vibe, what working here is like. The role's own description is included automatically.</p>
              <textarea
                aria-label="Confirmation email note"
                defaultValue={(selectedTenant as any)?.applicationWelcome || ''}
                maxLength={2000}
                rows={4}
                onBlur={(e) => {
                  if (!tenantId) return;
                  const v = e.target.value.trim().slice(0, 2000);
                  if (v === ((selectedTenant as any)?.applicationWelcome || '')) return;
                  updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}`), { applicationWelcome: v });
                }}
                className="w-full rounded-xl border-2 bg-white p-3 font-bold text-sm"
                placeholder="e.g. We're a small team that cares about craft and kindness. Most of us started exactly where you are…"
              />
              <p className="text-[11px] font-bold text-muted-foreground">Saves when you tap away.</p>
            </CardContent>
          </Card>
        )}

        {role === 'owner' && (
          <QuestionBuilder
            questions={((selectedTenant as any)?.applicationQuestions || []) as any[]}
            onSave={(list) => {
              if (!tenantId) return;
              updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}`), { applicationQuestions: list });
            }}
          />
        )}

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
            <button
              type="button"
              aria-pressed={lane === 'pool'}
              onClick={() => setLane('pool' as any)}
              className={cn('h-9 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', lane === ('pool' as any) ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}
            >
              Talent pool ({counts.pool})
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader className="h-7 w-7 animate-spin text-slate-900" aria-label="Loading applications" />
          </div>
        ) : visible.length > 0 ? (
          <div className="space-y-4">
            {visible.map((app: any) => (
              <div key={app.id} id={`applicant-${app.id}`} className={cn('rounded-[2rem]', focusAppId === app.id && 'ring-4 ring-amber-300 ring-offset-2')}>
              <ApplicantCardWithData app={app} tenantId={tenantId} onStatus={handleStatus} onHire={handleHire} teamEmails={teamEmails} consentForms={(consentForms || []) as any[]} businessName={selectedTenant?.name || "our team"} onSendMessage={handleSendMessage} onDecline={handleDecline} onScheduleInterview={handleScheduleInterview} invite={inviteByApplication.get(app.id) || null} onCopyInviteLink={handleCopyInviteLink} onAcceptProposed={handleAcceptProposed} onCancelInterview={handleCancelInterview} publishedDocs={publishedDocs} />
              </div>
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
