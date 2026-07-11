'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Send, Loader, AlertCircle, Check, CheckCheck, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFirebase, useCollection, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy, setDoc, updateDoc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function TeamThreadPage() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId as string;
  const router = useRouter();
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant } = useTenant();
  const { staff } = useInventory();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [messageText, setMessageText] = useState('');
  const [needsResponse, setNeedsResponse] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}/staffThreads`, threadId), [firestore, tenantId, threadId]);
  const { data: thread, isLoading: threadLoading } = useDoc<any>(threadRef);

  const messagesQuery = useMemoFirebase(
    () => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`), orderBy('sentAt', 'asc')),
    [firestore, tenantId, threadId],
  );
  const { data: messages } = useCollection<any>(messagesQuery);

  const isTeamThread = thread?.type === 'team';
  const otherId = !isTeamThread ? thread?.participantIds?.find((id: string) => id !== currentUser?.uid) : null;
  const otherPerson = (staff || []).find((s: any) => s.id === otherId);
  const otherCount = isTeamThread ? (thread?.participantIds?.length || 1) - 1 : 0;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  // Mark every message not sent by me as read the moment I view the thread.
  useEffect(() => {
    if (!firestore || !tenantId || !currentUser?.uid || !messages) return;
    messages.forEach((msg: any) => {
      if (msg.senderId !== currentUser.uid && !(msg.readBy || []).includes(currentUser.uid)) {
        updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`, msg.id), {
          readBy: [...(msg.readBy || []), currentUser.uid],
        }).catch(() => {});
      }
    });
  }, [messages, firestore, tenantId, currentUser?.uid, threadId]);

  const handleSend = async () => {
    if (!messageText.trim() || !firestore || !tenantId || !currentUser?.uid || sending) return;
    setSending(true);
    try {
      const now = new Date().toISOString();
      const msgRef = doc(collection(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`));
      await setDoc(msgRef, {
        id: msgRef.id,
        senderId: currentUser.uid,
        body: messageText.trim(),
        sentAt: now,
        readBy: [currentUser.uid],
        needsResponse,
      });
      await setDoc(
        doc(firestore, `tenants/${tenantId}/staffThreads`, threadId),
        { lastMessageAt: now, lastMessagePreview: messageText.trim().slice(0, 140), lastMessageBy: currentUser.uid },
        { merge: true },
      );

      // v25 — respects the same notificationAvailability model already
      // built for client-message escalation: only actually pings a
      // recipient if they're not away/outside hours right now. The
      // message itself always saves either way — this only governs
      // whether a notification entry gets created to nudge them.
      const recipients = (thread?.participantIds || []).filter((id: string) => id !== currentUser.uid);
      for (const recipientId of recipients) {
        const recipient = (staff || []).find((s: any) => s.id === recipientId);
        const availability = recipient?.notificationAvailability?.mode || 'business_hours_only';
        const isAway = availability === 'away' &&
          (!recipient?.notificationAvailability?.awayUntil || new Date(recipient.notificationAvailability.awayUntil) > new Date());
        if (isAway) continue; // message still saved above; just no ping
        const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        await setDoc(notifRef, {
          id: notifRef.id,
          userId: recipientId,
          type: 'staff_message',
          message: `${staff?.find((s: any) => s.id === currentUser.uid)?.name || 'A teammate'}: "${messageText.trim().slice(0, 100)}"`,
          link: `/messages/team/${threadId}`,
          createdAt: now,
          read: false,
        });
      }

      setMessageText('');
      setNeedsResponse(false);
    } catch {
      toast({ variant: 'destructive', title: 'Could not send', description: 'Please try again.' });
    } finally {
      setSending(false);
    }
  };

  if (threadLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader className="w-5 h-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/10 flex flex-col">
      <AppHeader title={isTeamThread ? 'Team Announcements' : (otherPerson?.name || 'Conversation')} />
      <main className="flex-1 p-4 md:p-8 max-w-3xl mx-auto w-full flex flex-col gap-4">

        <button
          onClick={() => router.push('/messages')}
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-indigo-600 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> All Conversations
        </button>

        <Card className="border-4 rounded-[2rem] shadow-sm flex-1 flex flex-col overflow-hidden">
          <CardContent className="p-5 flex-1 overflow-y-auto space-y-3 min-h-[300px] max-h-[55vh]">
            {(messages || []).map((msg: any) => {
              const isMine = msg.senderId === currentUser?.uid;
              const sender = (staff || []).find((s: any) => s.id === msg.senderId);
              const seenByOthers = (msg.readBy || []).filter((id: string) => id !== msg.senderId).length;
              return (
                <div key={msg.id} className={cn('flex gap-2', isMine ? 'justify-end' : 'justify-start')}>
                  {!isMine && (
                    <Avatar className="h-7 w-7 rounded-lg border shrink-0 mt-auto">
                      <AvatarImage src={sender?.avatarUrl} className="object-cover" />
                      <AvatarFallback className="text-[9px] font-black bg-primary/10 text-primary">{(sender?.name || '?').charAt(0)}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="max-w-[75%]">
                    {isTeamThread && !isMine && (
                      <p className="text-[9px] font-black uppercase text-muted-foreground mb-0.5 ml-1">{sender?.name}</p>
                    )}
                    <div className={cn(
                      'rounded-2xl px-4 py-2.5 text-sm font-medium',
                      isMine ? 'bg-primary text-white' : 'bg-muted text-slate-800',
                    )}>
                      {msg.needsResponse && !isMine && (
                        <p className="text-[9px] font-black uppercase tracking-wide mb-1 opacity-80 flex items-center gap-1">
                          <AlertCircle className="w-2.5 h-2.5" /> Needs a response
                        </p>
                      )}
                      <p>{msg.body}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <p className="text-[9px] font-bold uppercase tracking-wide opacity-60">
                          {msg.sentAt ? format(parseISO(msg.sentAt), 'h:mm a') : ''}
                        </p>
                        {isMine && (
                          isTeamThread ? (
                            seenByOthers > 0 && (
                              <span className="text-[9px] font-bold opacity-60 flex items-center gap-0.5">
                                <Users className="w-2.5 h-2.5" /> {seenByOthers}
                              </span>
                            )
                          ) : (
                            seenByOthers > 0
                              ? <CheckCheck className="w-3 h-3 opacity-80" />
                              : <Check className="w-3 h-3 opacity-60" />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={scrollRef} />
          </CardContent>
          <CardFooter className="p-4 border-t bg-muted/5 flex-col gap-2">
            <div className="flex items-center gap-2 w-full">
              <Input
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                className="h-12 rounded-xl border-2 flex-1"
                disabled={sending}
              />
              <Button onClick={handleSend} disabled={sending || !messageText.trim()} className="h-12 w-12 rounded-xl shrink-0 p-0">
                {sending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <button
              onClick={() => setNeedsResponse(v => !v)}
              className={cn(
                'text-[9px] font-black uppercase tracking-widest self-start px-2 py-1 rounded-lg transition-colors',
                needsResponse ? 'bg-amber-100 text-amber-700' : 'text-muted-foreground hover:text-slate-600',
              )}
            >
              <AlertCircle className="w-3 h-3 inline mr-1" />
              {needsResponse ? 'Flagged as needing a response' : 'Flag as needing a response'}
            </button>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
