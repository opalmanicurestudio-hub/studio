'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MessageSquare, Clock, User, Tag, Sparkles, Users, Plus } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFirebase, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, setDoc, query, orderBy, where } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { resolveActiveStaffId } from '@/lib/staff-identity';
import { useInventory } from '@/context/InventoryContext';
import { cn } from '@/lib/utils';

const AVAILABILITY_OPTIONS = [
  { value: 'business_hours_only', label: 'Business Hours Only' },
  { value: 'always', label: 'Always Notify Me' },
  { value: 'away', label: "I'm Away" },
];

const TEAM_THREAD_ID = 'team_broadcast';

// Deterministic thread id for a DM pair — same two people always resolve
// to the same thread, no lookup/creation race, no duplicate threads.
function dmThreadId(idA: string, idB: string): string {
  return `dm_${[idA, idB].sort().join('_')}`;
}

// v26 — consolidated /team into this page as a second section, rather
// than a separate top-level route. Two places to check for messages was
// worse UX than one hub with a clear "which audience am I looking at"
// toggle — client and staff conversations stay visually and structurally
// distinct via the section switch and distinct accent colors, without
// fragmenting navigation into two destinations to remember.
export default function MessagesPage() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant } = useTenant();
  const { staff } = useInventory();
  const router = useRouter();
  const tenantId = selectedTenant?.id;
  // v30 — PIN-verified identity first, Firebase login fallback (see
  // lib/staff-identity.ts for why): portal staff share one Firebase
  // login, so uid alone cannot identify who is actually messaging.
  const activeStaffId = resolveActiveStaffId(currentUser?.uid);
  const [filterMine, setFilterMine] = useState(false);
  const [section, setSection] = useState<'clients' | 'team'>('clients');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');

  const currentStaffMember = (staff || []).find((s: any) => s.id === activeStaffId);
  const myAvailability = currentStaffMember?.notificationAvailability?.mode || 'business_hours_only';
  const isOwnerOrAdmin = currentStaffMember?.role === 'owner' || currentStaffMember?.role === 'admin';

  // ── Client conversations (unchanged from before) ────────────────────────
  const threadsQuery = useMemoFirebase(
    () => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/smsThreads`), orderBy('lastMessageAt', 'desc')),
    [firestore, tenantId],
  );
  const { data: threads, isLoading } = useCollection<any>(threadsQuery);

  const visibleThreads = useMemo(() => {
    const list = threads || [];
    if (!isOwnerOrAdmin) return list.filter((t: any) => t.assignedStaffId === activeStaffId);
    return filterMine ? list.filter((t: any) => t.assignedStaffId === activeStaffId) : list;
  }, [threads, filterMine, activeStaffId, isOwnerOrAdmin]);

  // ── Staff-to-staff conversations ────────────────────────────────────────
  // v28 — FIX (the bug behind "I send a message and don't see the thread"):
  // this query previously combined array-contains with orderBy, which
  // requires a Firestore composite index that doesn't exist — the query
  // failed silently and this section rendered empty no matter what was in
  // the database. Messages were being written fine; nobody could ever see
  // the list. Single-field filter only, sort in memory — the same
  // discipline every other query in this codebase follows.
  const staffThreadsQuery = useMemoFirebase(
    () => !firestore || !tenantId || !activeStaffId ? null : query(
      collection(firestore, `tenants/${tenantId}/staffThreads`),
      where('participantIds', 'array-contains', activeStaffId),
    ),
    [firestore, tenantId, activeStaffId],
  );
  const { data: myStaffThreads } = useCollection<any>(staffThreadsQuery);
  const dmThreads = useMemo(
    () => (myStaffThreads || [])
      .filter((t: any) => t.type === 'dm' || t.type === 'group')
      .sort((a: any, b: any) => (b.lastMessageAt || b.createdAt || '').localeCompare(a.lastMessageAt || a.createdAt || '')),
    [myStaffThreads],
  );
  const teamThread = useMemo(() => (myStaffThreads || []).find((t: any) => t.type === 'team'), [myStaffThreads]);
  const otherStaff = useMemo(() => (staff || []).filter((s: any) => s.id !== activeStaffId), [staff, activeStaffId]);

  const isThreadUnread = (t: any) =>
    !!t.lastMessageBy && t.lastMessageBy !== activeStaffId && !(t.readBy || []).includes(activeStaffId);
  const teamUnreadCount = (myStaffThreads || []).filter(isThreadUnread).length;
  const clientOpenCount = visibleThreads.filter((t: any) => t.status === 'open').length;

  const [awayDays, setAwayDays] = useState(7);

  const handleAvailabilityChange = async (mode: string) => {
    if (!firestore || !tenantId || !activeStaffId) return;
    const awayUntil = mode === 'away'
      ? new Date(Date.now() + awayDays * 24 * 3600 * 1000).toISOString()
      : null;
    await setDoc(
      doc(firestore, `tenants/${tenantId}/staff`, activeStaffId),
      { notificationAvailability: { mode, awayUntil } },
      { merge: true },
    );
  };

  // v31 — one person selected = DM (deterministic id, same thread every
  // time); two or more = a real group thread with its own id and optional
  // name. This is the "certain members vs the whole team" middle ground —
  // the team broadcast stays for announcements; groups are for a subset.
  const handleStartConversation = async () => {
    if (!firestore || !tenantId || !activeStaffId || selectedIds.length === 0) return;
    const now = new Date().toISOString();
    let threadId: string;
    if (selectedIds.length === 1) {
      threadId = dmThreadId(activeStaffId, selectedIds[0]);
      await setDoc(
        doc(firestore, `tenants/${tenantId}/staffThreads`, threadId),
        { id: threadId, tenantId, type: 'dm', participantIds: [activeStaffId, selectedIds[0]], createdAt: now, lastMessageAt: now, readBy: [activeStaffId] },
        { merge: true },
      );
    } else {
      threadId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(
        doc(firestore, `tenants/${tenantId}/staffThreads`, threadId),
        { id: threadId, tenantId, type: 'group', groupName: groupName.trim() || null, participantIds: [activeStaffId, ...selectedIds], createdAt: now, lastMessageAt: now, readBy: [activeStaffId] },
        { merge: true },
      );
    }
    setPickerOpen(false);
    setSelectedIds([]);
    setGroupName('');
    router.push(`/messages/team/${threadId}`);
  };

  // v28 — FIX: previously fired on a Link's onClick, racing navigation —
  // the thread page could load before the doc existed. Now awaited, then
  // navigates. Also refreshes participantIds to the CURRENT staff list on
  // every open, so someone hired after the thread was first created is
  // still included.
  const openTeamThread = async () => {
    if (!firestore || !tenantId) return;
    const now = new Date().toISOString();
    await setDoc(
      doc(firestore, `tenants/${tenantId}/staffThreads`, TEAM_THREAD_ID),
      {
        id: TEAM_THREAD_ID,
        tenantId,
        type: 'team',
        participantIds: (staff || []).map((s: any) => s.id),
        ...(teamThread ? {} : { createdAt: now, lastMessageAt: now, readBy: [] }),
      },
      { merge: true },
    );
    router.push(`/messages/team/${TEAM_THREAD_ID}`);
  };

  return (
    <div className="min-h-screen bg-muted/10">
      <AppHeader title="Messages" />
      <main className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">

        {/* Section toggle — the one thing that replaces having two pages */}
        <div className="flex gap-2 p-1.5 bg-muted/30 rounded-2xl border-2 w-fit">
          <button
            onClick={() => setSection('clients')}
            className={cn(
              'flex items-center gap-2 h-10 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all',
              section === 'clients' ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground',
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Clients
            {clientOpenCount > 0 && (
              <span className="ml-1 h-4 min-w-4 px-1 bg-primary text-white text-[8px] font-black rounded-full flex items-center justify-center">{clientOpenCount}</span>
            )}
          </button>
          <button
            onClick={() => setSection('team')}
            className={cn(
              'flex items-center gap-2 h-10 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all',
              section === 'team' ? 'bg-white text-indigo-600 shadow-sm' : 'text-muted-foreground',
            )}
          >
            <Users className="w-3.5 h-3.5" /> Team
            {teamUnreadCount > 0 && (
              <span className="ml-1 h-4 min-w-4 px-1 bg-indigo-600 text-white text-[8px] font-black rounded-full flex items-center justify-center">{teamUnreadCount}</span>
            )}
          </button>
        </div>

        <Card className="border-4 rounded-[2rem] shadow-sm">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-2xl">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Your Notification Status</Label>
                <p className="text-xs font-bold text-slate-600">Controls whether escalated texts or teammate messages page you in real time</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Select value={myAvailability} onValueChange={handleAvailabilityChange}>
                <SelectTrigger className="w-full md:w-56 h-11 rounded-xl border-2 font-black uppercase text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2">
                  {AVAILABILITY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="font-bold uppercase text-[10px]">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {myAvailability === 'away' && (
                <div className="flex items-center gap-2">
                  <Select value={String(awayDays)} onValueChange={(v) => { setAwayDays(Number(v)); handleAvailabilityChange('away'); }}>
                    <SelectTrigger className="w-32 h-8 rounded-lg border-2 font-bold text-[9px] uppercase">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-2">
                      {[1, 3, 7, 14, 30].map(d => (
                        <SelectItem key={d} value={String(d)} className="font-bold text-[9px] uppercase">{d} day{d > 1 ? 's' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {currentStaffMember?.notificationAvailability?.awayUntil && (
                    <p className="text-[9px] font-bold text-muted-foreground uppercase">
                      Back {new Date(currentStaffMember.notificationAvailability.awayUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {section === 'clients' ? (
          <Card className="border-4 rounded-[2.5rem] shadow-sm overflow-hidden">
            <CardHeader className="p-6 border-b bg-muted/5 flex flex-row items-center justify-between">
              <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary/60 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Client Conversations
              </CardTitle>
              {isOwnerOrAdmin && (
                <Button
                  size="sm"
                  variant={filterMine ? 'default' : 'outline'}
                  onClick={() => setFilterMine(v => !v)}
                  className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
                >
                  Assigned to Me
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading && (
                <div className="py-16 text-center text-[10px] font-black uppercase text-slate-400">Loading...</div>
              )}
              {!isLoading && visibleThreads.length === 0 && (
                <div className="py-16 text-center space-y-3">
                  <MessageSquare className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="text-[10px] font-black uppercase text-slate-400">No conversations yet</p>
                </div>
              )}
              {visibleThreads.map((thread: any) => {
                const assignedStaff = (staff || []).find((s: any) => s.id === thread.assignedStaffId);
                return (
                  <Link
                    key={thread.id}
                    href={`/messages/${thread.id}`}
                    className="flex items-center gap-4 p-5 border-b last:border-0 hover:bg-primary/[0.02] transition-colors"
                  >
                    <Avatar className="h-11 w-11 rounded-xl border-2 shadow-sm shrink-0">
                      <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">
                        {(thread.clientName || thread.clientPhone || '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">
                          {thread.clientName || thread.clientPhone}
                        </p>
                        {thread.status === 'open' && (
                          <Badge className="h-4 px-1.5 bg-primary text-white border-none font-black text-[7px] uppercase">New</Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{thread.lastMessagePreview}</p>
                      {(thread.tags || []).length > 0 && (
                        <div className="flex gap-1 mt-1.5">
                          {thread.tags.map((tag: string) => (
                            <Badge key={tag} variant="secondary" className="h-4 px-1.5 font-bold text-[7px] uppercase bg-muted">
                              <Tag className="w-2 h-2 mr-1" />{tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 flex items-center gap-1 justify-end">
                        <Clock className="w-2.5 h-2.5" />
                        {thread.lastMessageAt ? formatDistanceToNow(parseISO(thread.lastMessageAt), { addSuffix: true }) : ''}
                      </p>
                      {assignedStaff && (
                        <p className="text-[9px] font-bold text-primary uppercase tracking-widest flex items-center gap-1 justify-end">
                          <User className="w-2.5 h-2.5" />{assignedStaff.name?.split(' ')[0]}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          <>
            <button onClick={openTeamThread} className="w-full text-left">
              <Card className="border-4 border-indigo-200 bg-indigo-50/50 rounded-[2rem] shadow-sm hover:border-indigo-300 transition-colors">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shrink-0">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black uppercase text-sm text-slate-900">Team Announcements</p>
                      {teamThread && isThreadUnread(teamThread) && (
                        <Badge className="h-4 px-1.5 bg-indigo-600 text-white border-none font-black text-[7px] uppercase">New</Badge>
                      )}
                    </div>
                    <p className="text-xs font-bold text-slate-500 truncate">
                      {teamThread?.lastMessagePreview || 'Shared with everyone on staff'}
                    </p>
                  </div>
                  {teamThread?.lastMessageAt && (
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 shrink-0">
                      {formatDistanceToNow(parseISO(teamThread.lastMessageAt), { addSuffix: true })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </button>

            <Card className="border-4 rounded-[2.5rem] shadow-sm overflow-hidden">
              <CardHeader className="p-6 border-b bg-muted/5 flex flex-row items-center justify-between">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-indigo-600/70 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Direct Messages
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                  className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest bg-indigo-600 hover:bg-indigo-700"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> New
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {dmThreads.length === 0 && (
                  <div className="py-16 text-center space-y-3">
                    <Users className="w-10 h-10 mx-auto text-slate-300" />
                    <p className="text-[10px] font-black uppercase text-slate-400">No conversations yet</p>
                  </div>
                )}
                {dmThreads.map((thread: any) => {
                  const isGroup = thread.type === 'group';
                  const others = thread.participantIds.filter((id: string) => id !== activeStaffId);
                  const otherId = others[0];
                  const otherPerson = (staff || []).find((s: any) => s.id === otherId);
                  const displayName = isGroup
                    ? (thread.groupName || others.map((id: string) => (staff || []).find((s: any) => s.id === id)?.name?.split(' ')[0]).filter(Boolean).join(', '))
                    : (otherPerson?.name || 'Unknown');
                  const unread = isThreadUnread(thread);
                  const mode = otherPerson?.notificationAvailability?.mode || 'business_hours_only';
                  const presenceColor = mode === 'always' ? 'bg-green-500' : mode === 'away' ? 'bg-slate-300' : 'bg-amber-400';
                  return (
                    <Link
                      key={thread.id}
                      href={`/messages/team/${thread.id}`}
                      className={cn('flex items-center gap-4 p-5 border-b last:border-0 hover:bg-indigo-50/40 transition-colors', unread && 'bg-indigo-50/30')}
                    >
                      <div className="relative shrink-0">
                        {isGroup ? (
                          <div className="h-11 w-11 rounded-xl border-2 shadow-sm bg-indigo-600 flex items-center justify-center">
                            <Users className="w-5 h-5 text-white" />
                          </div>
                        ) : (
                          <>
                            <Avatar className="h-11 w-11 rounded-xl border-2 shadow-sm">
                              <AvatarImage src={otherPerson?.avatarUrl} className="object-cover" />
                              <AvatarFallback className="font-black text-xs bg-indigo-100 text-indigo-600">
                                {(otherPerson?.name || '?').charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className={cn('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white', presenceColor)} title={mode === 'away' ? 'Away' : mode === 'always' ? 'Available' : 'Business hours'} />
                          </>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{displayName}</p>
                          {unread && (
                            <Badge className="h-4 px-1.5 bg-indigo-600 text-white border-none font-black text-[7px] uppercase">New</Badge>
                          )}
                        </div>
                        <p className={cn('text-xs truncate', unread ? 'text-slate-800 font-bold' : 'text-slate-500')}>{thread.lastMessagePreview}</p>
                      </div>
                      {thread.lastMessageAt && (
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 flex items-center gap-1 shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDistanceToNow(parseISO(thread.lastMessageAt), { addSuffix: true })}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="rounded-[2rem] border-4 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase tracking-tight">Message Someone</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {otherStaff.map((s: any) => {
              const checked = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedIds(ids => checked ? ids.filter(i => i !== s.id) : [...ids, s.id])}
                  className={cn('w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left border-2', checked ? 'border-indigo-400 bg-indigo-50' : 'border-transparent hover:bg-muted/40')}
                >
                  <Avatar className="h-9 w-9 rounded-lg border-2 shrink-0">
                    <AvatarImage src={s.avatarUrl} className="object-cover" />
                    <AvatarFallback className="font-black text-xs bg-indigo-100 text-indigo-600">{(s.name || '?').charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-xs uppercase text-slate-900 truncate">{s.name}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">{s.role}</p>
                  </div>
                  <div className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0', checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300')}>
                    {checked && <span className="text-white text-[10px] font-black">✓</span>}
                  </div>
                </button>
              );
            })}
          </div>
          {selectedIds.length > 1 && (
            <Input
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="Group name (optional)"
              className="h-10 rounded-xl border-2 text-xs font-bold"
            />
          )}
          <Button
            onClick={handleStartConversation}
            disabled={selectedIds.length === 0}
            className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest bg-indigo-600 hover:bg-indigo-700"
          >
            {selectedIds.length > 1 ? `Start Group (${selectedIds.length + 1} people)` : 'Start Conversation'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
