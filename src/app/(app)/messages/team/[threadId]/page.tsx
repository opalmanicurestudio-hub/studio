'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Send, Loader, AlertCircle, Check, CheckCheck, Users, MoreHorizontal, Copy, Trash2, ImagePlus, Mic, Square, Paperclip, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFirebase, useCollection, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useTenant } from '@/context/TenantContext';
import { resolveActiveStaffId } from '@/lib/staff-identity';
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
  // v30 — same PIN-first identity resolution as the hub; see
  // lib/staff-identity.ts.
  const activeStaffId = resolveActiveStaffId(currentUser?.uid);

  const [messageText, setMessageText] = useState('');
  const [needsResponse, setNeedsResponse] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  const threadRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}/staffThreads`, threadId), [firestore, tenantId, threadId]);
  const { data: thread, isLoading: threadLoading } = useDoc<any>(threadRef);

  const messagesQuery = useMemoFirebase(
    () => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`), orderBy('sentAt', 'asc')),
    [firestore, tenantId, threadId],
  );
  const { data: messages } = useCollection<any>(messagesQuery);

  const isTeamThread = thread?.type === 'team';
  const isGroupThread = thread?.type === 'group';
  const groupTitle = isGroupThread
    ? (thread?.groupName || (thread?.participantIds || []).filter((id: string) => id !== activeStaffId).map((id: string) => (staff || []).find((s: any) => s.id === id)?.name?.split(' ')[0]).filter(Boolean).join(', '))
    : null;
  const otherId = !isTeamThread ? thread?.participantIds?.find((id: string) => id !== activeStaffId) : null;
  const otherPerson = (staff || []).find((s: any) => s.id === otherId);
  const otherCount = isTeamThread ? (thread?.participantIds?.length || 1) - 1 : 0;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  // Mark every message not sent by me as read the moment I view the thread.
  useEffect(() => {
    if (!firestore || !tenantId || !activeStaffId || !messages) return;
    messages.forEach((msg: any) => {
      if (msg.senderId !== activeStaffId && !(msg.readBy || []).includes(activeStaffId)) {
        updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`, msg.id), {
          readBy: [...(msg.readBy || []), activeStaffId],
        }).catch(() => {});
      }
    });
  }, [messages, firestore, tenantId, activeStaffId, threadId]);

  // v28 — FIX: thread-level readBy was read by every unread badge
  // (mobile portal, sidebar, the hub) but NOTHING ever wrote it — every
  // thread with a message from someone else showed unread forever.
  // Opening the thread now records it. For the team broadcast, also
  // syncs me into participantIds — membership was frozen at creation, so
  // anyone hired afterward was never included.
  useEffect(() => {
    if (!firestore || !tenantId || !activeStaffId || !thread) return;
    const patch: any = {};
    if (!(thread.readBy || []).includes(activeStaffId)) patch.readBy = arrayUnion(activeStaffId);
    if (thread.type === 'team' && !(thread.participantIds || []).includes(activeStaffId)) patch.participantIds = arrayUnion(activeStaffId);
    if (Object.keys(patch).length > 0) {
      updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads`, threadId), patch).catch(() => {});
    }
  }, [thread, firestore, tenantId, activeStaffId, threadId]);

  const handleDeleteMessage = async (msgId: string) => {
    if (!firestore || !tenantId) return;
    // Soft delete — the bubble stays as "Message deleted" rather than
    // vanishing, so a conversation's flow still reads coherently and
    // nobody can silently unsay something without a trace.
    await updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`, msgId), {
      deleted: true, body: '', imageUrl: null,
    }).catch(() => {});
    setOpenMenuId(null);
  };

  const handleCopyMessage = (body: string) => {
    try { navigator.clipboard.writeText(body); } catch {}
    setOpenMenuId(null);
  };

  // v32 — one shared upload path for every media kind. Photos, voice
  // notes, and files all ride the same Storage pipeline; only the message
  // field they land in differs, so rendering stays a simple branch.
  const uploadAndSend = async (blob: Blob, fileName: string, kind: 'image' | 'audio' | 'file') => {
    if (!firestore || !tenantId || !activeStaffId || uploading) return;
    setUploading(true);
    try {
      const storage = getStorage();
      const path = `tenants/${tenantId}/staffThreads/${threadId}/${Date.now()}_${fileName}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, blob);
      const url = await getDownloadURL(sRef);
      const now = new Date().toISOString();
      const msgRef = doc(collection(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`));
      await setDoc(msgRef, {
        id: msgRef.id, senderId: activeStaffId, body: '', sentAt: now, readBy: [activeStaffId],
        ...(kind === 'image' ? { imageUrl: url } : kind === 'audio' ? { audioUrl: url } : { fileUrl: url, fileName }),
      });
      await setDoc(doc(firestore, `tenants/${tenantId}/staffThreads`, threadId),
        { lastMessageAt: now, lastMessagePreview: kind === 'image' ? '📷 Photo' : kind === 'audio' ? '🎤 Voice note' : `📎 ${fileName}`, lastMessageBy: activeStaffId, readBy: [activeStaffId] }, { merge: true });
    } catch {
      toast({ variant: 'destructive', title: 'Upload failed', description: 'Check that Firebase Storage rules allow uploads.' });
    } finally {
      setUploading(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) uploadAndSend(blob, `voice_note.webm`, 'audio');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast({ variant: 'destructive', title: 'Microphone unavailable', description: 'Allow microphone access to record a voice note.' });
    }
  };

  const handleAttachPhoto = async (file: File) => {
    await uploadAndSend(file, file.name, file.type.startsWith('image/') ? 'image' : 'file');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    if (!messageText.trim() || !firestore || !tenantId || !activeStaffId || sending) return;
    setSending(true);
    try {
      const now = new Date().toISOString();
      const msgRef = doc(collection(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`));
      await setDoc(msgRef, {
        id: msgRef.id,
        senderId: activeStaffId,
        body: messageText.trim(),
        sentAt: now,
        readBy: [activeStaffId],
        needsResponse,
      });
      await setDoc(
        doc(firestore, `tenants/${tenantId}/staffThreads`, threadId),
        // v28 — readBy resets to just the sender on every send: that's
        // what makes the thread show as unread to everyone else until
        // they actually open it. Without this, unread badges had nothing
        // real to key off.
        { lastMessageAt: now, lastMessagePreview: messageText.trim().slice(0, 140), lastMessageBy: activeStaffId, readBy: [activeStaffId] },
        { merge: true },
      );

      // v28 — respects the same notificationAvailability model already
      // built for client-message escalation. For the team broadcast,
      // recipients come from the LIVE staff list, not the thread's
      // participantIds — membership was frozen at creation, so anyone
      // hired after the thread first existed would otherwise silently
      // never be notified.
      const recipients = isTeamThread
        ? (staff || []).map((s: any) => s.id).filter((id: string) => id !== activeStaffId)
        : (thread?.participantIds || []).filter((id: string) => id !== activeStaffId);
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
          message: `${staff?.find((s: any) => s.id === activeStaffId)?.name || 'A teammate'}: "${messageText.trim().slice(0, 100)}"`,
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
      <AppHeader title={isTeamThread ? 'Team Announcements' : isGroupThread ? (groupTitle || 'Group') : (otherPerson?.name || 'Conversation')} />
      <main className="flex-1 p-4 md:p-8 max-w-3xl mx-auto w-full flex flex-col gap-4">

        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/messages')}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-indigo-600 transition-colors w-fit"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> All Conversations
          </button>
          {!isTeamThread && otherPerson && (() => {
            const mode = otherPerson?.notificationAvailability?.mode || 'business_hours_only';
            const away = mode === 'away';
            return (
              <span className={cn(
                'flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border-2',
                away ? 'text-slate-500 border-slate-200 bg-slate-50' : mode === 'always' ? 'text-green-700 border-green-200 bg-green-50' : 'text-amber-700 border-amber-200 bg-amber-50',
              )}>
                <span className={cn('w-2 h-2 rounded-full', away ? 'bg-slate-300' : mode === 'always' ? 'bg-green-500' : 'bg-amber-400')} />
                {away ? "Away — they'll see this when they're back" : mode === 'always' ? 'Available' : 'Business hours only'}
              </span>
            );
          })()}
        </div>

        <Card className="border-4 rounded-[2rem] shadow-sm flex-1 flex flex-col overflow-hidden">
          <CardContent className="p-5 flex-1 overflow-y-auto space-y-3 min-h-[300px] max-h-[55vh]">
            {(messages || []).map((msg: any, index: number) => {
              const isMine = msg.senderId === activeStaffId;
              const sender = (staff || []).find((s: any) => s.id === msg.senderId);
              const seenByOthers = (msg.readBy || []).filter((id: string) => id !== msg.senderId).length;
              // v29 — sender grouping: consecutive messages from the same
              // person render as one visual block — name label on the
              // first, avatar anchored on the last — so a back-and-forth
              // reads as a conversation, not an anonymous stack. Name now
              // shows in DMs too (was team-threads-only), and "their"
              // bubbles are white with a real border instead of a muted
              // gray that blended into the page.
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const nextMsg = index < (messages?.length || 0) - 1 ? messages[index + 1] : null;
              const isGroupStart = !prevMsg || prevMsg.senderId !== msg.senderId;
              const isGroupEnd = !nextMsg || nextMsg.senderId !== msg.senderId;
              return (
                <div key={msg.id} className={cn('flex gap-2', isMine ? 'justify-end' : 'justify-start', !isGroupStart && '-mt-1.5')}>
                  {!isMine && (
                    <div className="w-7 shrink-0 flex items-end">
                      {isGroupEnd && (
                        <Avatar className="h-7 w-7 rounded-lg border">
                          <AvatarImage src={sender?.avatarUrl} className="object-cover" />
                          <AvatarFallback className="text-[9px] font-black bg-indigo-100 text-indigo-600">{(sender?.name || '?').charAt(0)}</AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  )}
                  <div className="max-w-[75%] relative group/msg">
                    {!msg.deleted && (
                      <button
                        onClick={() => setOpenMenuId(openMenuId === msg.id ? null : msg.id)}
                        className={cn('absolute top-0 z-10 p-1 rounded-lg bg-white border shadow-sm opacity-0 group-hover/msg:opacity-100 transition-opacity', isMine ? '-left-8' : '-right-8')}
                      >
                        <MoreHorizontal className="w-3.5 h-3.5 text-slate-500" />
                      </button>
                    )}
                    {openMenuId === msg.id && (
                      <div className={cn('absolute top-7 z-20 bg-white border-2 rounded-xl shadow-xl overflow-hidden min-w-32', isMine ? 'right-0' : 'left-0')}>
                        {msg.body && (
                          <button onClick={() => handleCopyMessage(msg.body)} className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase text-slate-700 hover:bg-muted/40">
                            <Copy className="w-3 h-3" /> Copy
                          </button>
                        )}
                        {isMine && (
                          <button onClick={() => handleDeleteMessage(msg.id)} className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase text-destructive hover:bg-destructive/5">
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        )}
                      </div>
                    )}
                    {!isMine && isGroupStart && (
                      <p className="text-[9px] font-black uppercase tracking-widest text-indigo-600/70 mb-0.5 ml-1">{sender?.name || 'Unknown'}</p>
                    )}
                    <div className={cn(
                      'px-4 py-2.5 text-sm font-medium',
                      isMine
                        ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md shadow-sm'
                        : 'bg-white text-slate-800 border-2 border-slate-200 rounded-2xl rounded-bl-md',
                    )}>
                      {msg.needsResponse && !isMine && !msg.deleted && (
                        <p className="text-[9px] font-black uppercase tracking-wide mb-1 text-amber-600 flex items-center gap-1">
                          <AlertCircle className="w-2.5 h-2.5" /> Needs a response
                        </p>
                      )}
                      {msg.deleted ? (
                        <p className="italic opacity-50 text-xs">Message deleted</p>
                      ) : (
                        <>
                          {msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noreferrer">
                              <img src={msg.imageUrl} alt="Shared photo" className="rounded-xl max-h-64 max-w-full mb-1 border" />
                            </a>
                          )}
                          {msg.audioUrl && (
                            <audio controls src={msg.audioUrl} className="max-w-full h-10 my-0.5" />
                          )}
                          {msg.fileUrl && (
                            <a href={msg.fileUrl} target="_blank" rel="noreferrer" className={cn('flex items-center gap-2 rounded-xl border-2 px-3 py-2 my-0.5 text-xs font-bold', isMine ? 'border-white/30 text-white' : 'border-slate-200 text-slate-700')}>
                              <FileText className="w-4 h-4 shrink-0" /> <span className="truncate">{msg.fileName || 'Attachment'}</span>
                            </a>
                          )}
                          {msg.body && <p>{msg.body}</p>}
                        </>
                      )}
                      {isGroupEnd && (
                        <div className={cn('flex items-center gap-1 mt-1', isMine ? 'opacity-70' : 'opacity-50')}>
                          <p className="text-[9px] font-bold uppercase tracking-wide">
                            {msg.sentAt ? format(parseISO(msg.sentAt), 'h:mm a') : ''}
                          </p>
                          {isMine && (
                            isTeamThread ? (
                              seenByOthers > 0 && (
                                <span className="text-[9px] font-bold flex items-center gap-0.5">
                                  <Users className="w-2.5 h-2.5" /> {seenByOthers}
                                </span>
                              )
                            ) : (
                              seenByOthers > 0
                                ? <CheckCheck className="w-3 h-3" />
                                : <Check className="w-3 h-3" />
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={scrollRef} />
          </CardContent>
          <CardFooter className="p-4 border-t bg-muted/5 flex-col gap-2">
            <div className="flex items-center gap-2 w-full">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAttachPhoto(f); }}
              />
              <input
                ref={docFileInputRef}
                type="file"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { uploadAndSend(f, f.name, 'file'); if (docFileInputRef.current) docFileInputRef.current.value = ''; } }}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || recording}
                className="h-12 w-12 rounded-xl shrink-0 p-0 border-2"
                title="Share a photo"
              >
                {uploading ? <Loader className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              </Button>
              <Button
                variant="outline"
                onClick={() => docFileInputRef.current?.click()}
                disabled={uploading || recording}
                className="h-12 w-12 rounded-xl shrink-0 p-0 border-2 hidden sm:flex"
                title="Attach a file"
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Button
                variant={recording ? 'destructive' : 'outline'}
                onClick={toggleRecording}
                disabled={uploading}
                className={cn('h-12 w-12 rounded-xl shrink-0 p-0 border-2', recording && 'animate-pulse')}
                title={recording ? 'Stop and send' : 'Record a voice note'}
              >
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
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
