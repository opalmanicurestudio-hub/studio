'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { MessageSquare, Clock, User, Tag, Sparkles } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import Link from 'next/link';
import { useFirebase, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, setDoc, query, orderBy } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { cn } from '@/lib/utils';

const AVAILABILITY_OPTIONS = [
  { value: 'business_hours_only', label: 'Business Hours Only' },
  { value: 'always', label: 'Always Notify Me' },
  { value: 'away', label: "I'm Away" },
];

export default function MessagesPage() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant } = useTenant();
  const { staff } = useInventory();
  const tenantId = selectedTenant?.id;
  const [filterMine, setFilterMine] = useState(false);

  const currentStaffMember = (staff || []).find((s: any) => s.id === currentUser?.uid);
  const myAvailability = currentStaffMember?.notificationAvailability?.mode || 'business_hours_only';

  const threadsQuery = useMemoFirebase(
    () => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/smsThreads`), orderBy('lastMessageAt', 'desc')),
    [firestore, tenantId],
  );
  const { data: threads, isLoading } = useCollection<any>(threadsQuery);

  const visibleThreads = useMemo(() => {
    const list = threads || [];
    return filterMine ? list.filter((t: any) => t.assignedStaffId === currentUser?.uid) : list;
  }, [threads, filterMine, currentUser]);

  const handleAvailabilityChange = async (mode: string) => {
    if (!firestore || !tenantId || !currentUser?.uid) return;
    await setDoc(
      doc(firestore, `tenants/${tenantId}/staff`, currentUser.uid),
      { notificationAvailability: { mode, awayUntil: null } },
      { merge: true },
    );
  };

  return (
    <div className="min-h-screen bg-muted/10">
      <AppHeader title="Messages" />
      <main className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">

        <Card className="border-4 rounded-[2rem] shadow-sm">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-2xl">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Your Notification Status</Label>
                <p className="text-xs font-bold text-slate-600">Controls whether escalated texts page you in real time</p>
              </div>
            </div>
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
          </CardContent>
        </Card>

        <Card className="border-4 rounded-[2.5rem] shadow-sm overflow-hidden">
          <CardHeader className="p-6 border-b bg-muted/5 flex flex-row items-center justify-between">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary/60 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Conversations
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={filterMine ? 'default' : 'outline'}
                onClick={() => setFilterMine(v => !v)}
                className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
              >
                Assigned to Me
              </Button>
            </div>
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
      </main>
    </div>
  );
}
