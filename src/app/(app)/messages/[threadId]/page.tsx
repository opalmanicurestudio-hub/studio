'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Send, Tag, X, Loader, User } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFirebase, useCollection, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const SUGGESTED_TAGS = ['Client Issue', 'Scheduling', 'Product Question', 'Complaint', 'General'];

export default function MessageThreadPage() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId as string;
  const router = useRouter();
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant } = useTenant();
  const { staff } = useInventory();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [newTag, setNewTag] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}/smsThreads`, threadId), [firestore, tenantId, threadId]);
  const { data: thread, isLoading: threadLoading } = useDoc<any>(threadRef);

  const messagesQuery = useMemoFirebase(
    () => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/smsThreads/${threadId}/messages`), orderBy('sentAt', 'asc')),
    [firestore, tenantId, threadId],
  );
  const { data: messages, isLoading: messagesLoading } = useCollection<any>(messagesQuery);

  const assignedStaff = (staff || []).find((s: any) => s.id === thread?.assignedStaffId);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  const handleSend = async () => {
    if (!replyText.trim() || !tenantId || sending) return;
    setSending(true);
    try {
      const idToken = await currentUser?.getIdToken?.();
      const res = await fetch('/api/sms/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ tenantId, threadId, message: replyText.trim() }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setReplyText('');
      } else {
        toast({ variant: 'destructive', title: 'Could not send', description: data.error || 'Please try again.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Could not send', description: 'Please try again.' });
    } finally {
      setSending(false);
    }
  };

  const handleAddTag = async (tag: string) => {
    if (!firestore || !tenantId || !tag.trim()) return;
    await setDoc(doc(firestore, `tenants/${tenantId}/smsThreads`, threadId), { tags: arrayUnion(tag.trim()) }, { merge: true });
    setNewTag('');
  };

  const handleRemoveTag = async (tag: string) => {
    if (!firestore || !tenantId) return;
    await setDoc(doc(firestore, `tenants/${tenantId}/smsThreads`, threadId), { tags: arrayRemove(tag) }, { merge: true });
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
      <AppHeader title={thread?.clientName || thread?.clientPhone || 'Conversation'} />
      <main className="flex-1 p-4 md:p-8 max-w-3xl mx-auto w-full flex flex-col gap-4">

        <button
          onClick={() => router.push('/messages')}
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> All Conversations
        </button>

        <Card className="border-4 rounded-[2rem] shadow-sm">
          <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {assignedStaff && (
                <Badge variant="outline" className="h-6 px-2.5 font-black uppercase text-[9px] tracking-widest border-2">
                  <User className="w-3 h-3 mr-1" /> {assignedStaff.name}
                </Badge>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(thread?.tags || []).map((tag: string) => (
                  <Badge key={tag} className="h-6 px-2 bg-primary/10 text-primary border-none font-bold text-[9px] uppercase flex items-center gap-1">
                    <Tag className="w-2.5 h-2.5" />{tag}
                    <button onClick={() => handleRemoveTag(tag)} className="ml-0.5 hover:text-destructive">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTag(newTag); }}
                placeholder="Add tag..."
                className="h-8 w-32 rounded-lg border-2 text-[10px] font-bold"
              />
            </div>
          </CardContent>
        </Card>

        {(thread?.tags || []).length === 0 && (
          <div className="flex gap-1.5 flex-wrap px-1">
            {SUGGESTED_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => handleAddTag(tag)}
                className="h-6 px-2.5 rounded-full border-2 border-dashed text-[9px] font-black uppercase text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                + {tag}
              </button>
            ))}
          </div>
        )}

        <Card className="border-4 rounded-[2rem] shadow-sm flex-1 flex flex-col overflow-hidden">
          <CardContent className="p-5 flex-1 overflow-y-auto space-y-3 min-h-[300px] max-h-[50vh]">
            {messagesLoading && <div className="text-center text-[10px] font-black uppercase text-slate-400 py-8">Loading...</div>}
            {(messages || []).map((msg: any) => (
              <div key={msg.id} className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm font-medium',
                  msg.direction === 'outbound' ? 'bg-primary text-white' : 'bg-muted text-slate-800',
                )}>
                  <p>{msg.body}</p>
                  <p className={cn('text-[9px] font-bold uppercase tracking-wide mt-1 opacity-60')}>
                    {msg.sentAt ? format(parseISO(msg.sentAt), 'MMM d, h:mm a') : ''}
                  </p>
                </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </CardContent>
          <CardFooter className="p-4 border-t bg-muted/5 gap-2">
            <Input
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Type a reply..."
              className="h-12 rounded-xl border-2 flex-1"
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={sending || !replyText.trim()} className="h-12 w-12 rounded-xl shrink-0 p-0">
              {sending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
