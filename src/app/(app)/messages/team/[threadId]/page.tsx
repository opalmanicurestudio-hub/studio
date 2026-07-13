'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Send, Loader, AlertCircle, Check, CheckCheck, Users, MoreHorizontal, Copy, Trash2, ImagePlus, Mic, Square, Paperclip, FileText, User, Pin, X, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { useFirebase, useCollection, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy, setDoc, updateDoc, arrayUnion, getDocs } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GifPicker, GIF_ENABLED } from '@/components/shared/GifPicker';
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
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const lastTypingWriteRef = useRef(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recCancelledRef = useRef(false);
  const recExtRef = useRef('webm');
  const [clientSearch, setClientSearch] = useState('');
  const [shareClients, setShareClients] = useState<any[] | null>(null);

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

  const openClientPicker = async () => {
    if (clientPickerOpen) { setClientPickerOpen(false); return; }
    setClientPickerOpen(true);
    if (!shareClients && firestore && tenantId) {
      try {
        const snap = await getDocs(collection(firestore, `tenants/${tenantId}/clients`));
        setShareClients(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch { setShareClients([]); }
    }
  };

  const shareClientCard = async (cl: any) => {
    setClientPickerOpen(false);
    setClientSearch('');
    // Snapshot the essentials onto the message itself — rendering never
    // needs a join, and the card stays meaningful even if the client is
    // later renamed or removed. The composer text (if any) rides along as
    // the note. Financials are DELIBERATELY excluded from the snapshot:
    // message content is visible to everyone in the thread regardless of
    // role, so "owes $X" here would leak straight past the privacy gate.
    await handleSend({
      clientId: cl.id,
      name: cl.name || 'Client',
      phone: cl.phone || '',
      avatarUrl: cl.avatarUrl || null,
      member: cl.subscription?.status === 'past_due' ? 'past_due' : (cl.subscription?.status === 'active' || cl.activeMembershipId) ? 'active' : null,
      careFlag: !!(cl.medicalNotes || cl.allergyNotes || cl.sensoryNeeds),
      lastVisit: cl.lastAppointment || null,
    });
  };

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
      // v36 — FIX: contentType must be explicit. Some browsers report an
      // empty blob type for recordings; uploaded typeless, the file serves
      // as application/octet-stream and the <audio> player refuses it —
      // exactly the "uploads but errors on playback" symptom.
      await uploadBytes(sRef, blob, { contentType: blob.type || (kind === 'audio' ? 'audio/mp4' : 'application/octet-stream') });
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

  // v36 — pick a format the CURRENT browser can actually record. Safari
  // records audio/mp4, Chrome audio/webm; hardcoding webm (v1) produced
  // typeless or mislabeled blobs on iPhones — uploads succeeded, playback
  // errored.
  const pickAudioMime = (): { mime: string; ext: string } => {
    const candidates: [string, string][] = [
      ['audio/webm;codecs=opus', 'webm'],
      ['audio/webm', 'webm'],
      ['audio/mp4', 'm4a'],
      ['audio/ogg;codecs=opus', 'ogg'],
    ];
    for (const [m, e] of candidates) {
      try { if ((window as any).MediaRecorder?.isTypeSupported?.(m)) return { mime: m, ext: e }; } catch {}
    }
    return { mime: '', ext: 'webm' };
  };

  const stopRecordingCleanup = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setMicLevel(0);
    setRecSeconds(0);
    setRecording(false);
  };

  const cancelRecording = () => {
    recCancelledRef.current = true;
    mediaRecorderRef.current?.stop();
  };

  const toggleRecording = async () => {
    if (recording) {
      recCancelledRef.current = false;
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime, ext } = pickAudioMime();
      recExtRef.current = ext;
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recCancelledRef.current = false;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        stopRecordingCleanup();
        if (recCancelledRef.current) return; // discarded on purpose
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mime || 'audio/mp4' });
        if (blob.size < 1000) {
          toast({ variant: 'destructive', title: 'Nothing recorded', description: 'The mic produced no audio — check the level bars move while you speak.' });
          return;
        }
        uploadAndSend(blob, `voice_note.${recExtRef.current}`, 'audio');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);

      // Live level meter — THE "is it actually hearing me" indicator.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        setMicLevel(Math.sqrt(sum / data.length));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      toast({ variant: 'destructive', title: 'Microphone unavailable', description: 'Allow microphone access to record a voice note.' });
    }
  };

  // v37 — typing indicators. A throttled timestamp lands on the thread
  // doc while someone types; anyone with a timestamp fresher than 6s who
  // isn't me renders as "typing". Staleness handles cleanup — no
  // explicit clear needed, so a closed tab never leaves a ghost typer.
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 2000);
    return () => clearInterval(iv);
  }, []);

  const recordTyping = () => {
    if (!firestore || !tenantId || !activeStaffId) return;
    const now = Date.now();
    if (now - lastTypingWriteRef.current < 2500) return;
    lastTypingWriteRef.current = now;
    updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads`, threadId), {
      [`typingBy.${activeStaffId}`]: new Date().toISOString(),
    }).catch(() => {});
  };

  const typers = useMemo(() => {
    const map = (thread as any)?.typingBy || {};
    return Object.entries(map)
      .filter(([id, ts]: any) => id !== activeStaffId && ts && (nowTick - new Date(ts).getTime()) < 6000)
      .map(([id]) => (staff || []).find((s: any) => s.id === id)?.name?.split(' ')[0])
      .filter(Boolean);
  }, [thread, nowTick, staff, activeStaffId]);

  const handlePinMessage = async (msg: any) => {
    if (!firestore || !tenantId) return;
    const senderName = (staff || []).find((s: any) => s.id === msg.senderId)?.name || 'Someone';
    // Snapshot, not reference — the pinned bar stays meaningful even if
    // the original message is later soft-deleted.
    await updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads`, threadId), {
      pinnedMessage: {
        id: msg.id,
        preview: msg.body?.slice(0, 140) || (msg.imageUrl ? '📷 Photo' : msg.audioUrl ? '🎤 Voice note' : msg.fileUrl ? '📎 File' : 'Message'),
        senderName,
        pinnedAt: new Date().toISOString(),
      },
    }).catch(() => {});
    setOpenMenuId(null);
  };

  const handleUnpin = async () => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads`, threadId), { pinnedMessage: null }).catch(() => {});
  };

  const REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥'];

  // v38 — @mentions. Typing @Maria highlights her name in the bubble and
  // her notification says "mentioned you" instead of a generic preview —
  // the difference between noise and "this one's for me."
  const staffFirstNames = useMemo(
    () => new Set((staff || []).map((s: any) => (s.name || '').split(' ')[0].toLowerCase()).filter(Boolean)),
    [staff],
  );
  const renderBody = (body: string) => {
    const parts = body.split(/(@[A-Za-z]+)/g);
    return parts.map((p, i) =>
      p.startsWith('@') && staffFirstNames.has(p.slice(1).toLowerCase())
        ? <span key={i} className="font-black underline decoration-2 underline-offset-2">{p}</span>
        : p,
    );
  };
  const toggleReaction = async (msg: any, emoji: string) => {
    if (!firestore || !tenantId || !activeStaffId) return;
    const current: Record<string, string[]> = msg.reactions || {};
    const list: string[] = current[emoji] || [];
    const has = list.includes(activeStaffId);
    const next: Record<string, string[]> = { ...current, [emoji]: has ? list.filter((id) => id !== activeStaffId) : [...list, activeStaffId] };
    if (next[emoji].length === 0) delete next[emoji];
    await updateDoc(doc(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`, msg.id), { reactions: next }).catch(() => {});
    setOpenMenuId(null);
  };

  const sendGif = async (gifUrl: string) => {
    setGifPickerOpen(false);
    if (!firestore || !tenantId || !activeStaffId) return;
    const now = new Date().toISOString();
    const msgRef = doc(collection(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`));
    await setDoc(msgRef, { id: msgRef.id, senderId: activeStaffId, body: '', imageUrl: gifUrl, sentAt: now, readBy: [activeStaffId] });
    await setDoc(doc(firestore, `tenants/${tenantId}/staffThreads`, threadId),
      { lastMessageAt: now, lastMessagePreview: '🎬 GIF', lastMessageBy: activeStaffId, readBy: [activeStaffId] }, { merge: true });
  };

  const handleAttachPhoto = async (file: File) => {
    await uploadAndSend(file, file.name, file.type.startsWith('image/') ? 'image' : 'file');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (clientRefArg?: any) => {
    // v34 — a shared client card rides the same send path as text: same
    // thread bump, same readBy reset, same availability-aware notify.
    // Click events land here too, so only treat it as a card when it
    // actually looks like one.
    const clientRef = clientRefArg && clientRefArg.clientId ? clientRefArg : null;
    if ((!messageText.trim() && !clientRef) || !firestore || !tenantId || !activeStaffId || sending) return;
    setSending(true);
    try {
      const previewText = clientRef ? `👤 ${clientRef.name}` : messageText.trim();
      const now = new Date().toISOString();
      const msgRef = doc(collection(firestore, `tenants/${tenantId}/staffThreads/${threadId}/messages`));
      await setDoc(msgRef, {
        id: msgRef.id,
        senderId: activeStaffId,
        body: messageText.trim(),
        sentAt: now,
        readBy: [activeStaffId],
        needsResponse,
        ...(clientRef ? { clientRef } : {}),
      });
      await setDoc(
        doc(firestore, `tenants/${tenantId}/staffThreads`, threadId),
        // v28 — readBy resets to just the sender on every send: that's
        // what makes the thread show as unread to everyone else until
        // they actually open it. Without this, unread badges had nothing
        // real to key off.
        { lastMessageAt: now, lastMessagePreview: previewText.slice(0, 140), lastMessageBy: activeStaffId, readBy: [activeStaffId] },
        { merge: true },
      );

      // v28 — respects the same notificationAvailability model already
      // built for client-message escalation. For the team broadcast,
      // recipients come from the LIVE staff list, not the thread's
      // participantIds — membership was frozen at creation, so anyone
      // hired after the thread first existed would otherwise silently
      // never be notified.
      // v44 — audience-correct broadcasts: team reaches employees (staff
      // now includes mirrored renter docs, so exclude them), building
      // reaches renters + management.
      const recipients = isTeamThread
        ? (staff || []).filter((s: any) => threadId === 'building_broadcast'
            ? (s.isRenter || s.role === 'owner' || s.role === 'admin')
            : !s.isRenter)
          .map((s: any) => s.id).filter((id: string) => id !== activeStaffId)
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
          message: `${staff?.find((s: any) => s.id === activeStaffId)?.name || 'A teammate'}${messageText.toLowerCase().includes('@' + (recipient?.name || ' ').split(' ')[0].toLowerCase()) ? ' mentioned you' : ''}: ${clientRef ? previewText : '"' + previewText.slice(0, 100) + '"'}`,
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
      <AppHeader title={isTeamThread ? (threadId === 'building_broadcast' ? 'Building Announcements' : 'Team Announcements') : isGroupThread ? (groupTitle || 'Group') : (otherPerson?.name || 'Conversation')} />
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
            {(thread as any)?.pinnedMessage && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2.5 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 mb-2">
                <Pin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[8px] font-black uppercase tracking-widest text-amber-600">Pinned · {(thread as any).pinnedMessage.senderName}</p>
                  <p className="text-xs font-bold text-slate-700 truncate">{(thread as any).pinnedMessage.preview}</p>
                </div>
                <button onClick={handleUnpin} className="p-1 rounded-lg hover:bg-amber-100 shrink-0" title="Unpin">
                  <X className="w-3.5 h-3.5 text-amber-600" />
                </button>
              </motion.div>
            )}
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
                <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className={cn('flex gap-2', isMine ? 'justify-end' : 'justify-start', !isGroupStart && '-mt-1.5')}>
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
                      <div className={cn('absolute top-7 z-20 bg-white border-2 rounded-xl shadow-xl overflow-hidden min-w-44', isMine ? 'right-0' : 'left-0')}>
                        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b">
                          {REACTIONS.map(e => (
                            <button key={e} onClick={() => toggleReaction(msg, e)} className="text-base hover:scale-125 transition-transform p-0.5">{e}</button>
                          ))}
                        </div>
                        <button onClick={() => handlePinMessage(msg)} className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase text-slate-700 hover:bg-muted/40">
                          <Pin className="w-3 h-3" /> Pin
                        </button>
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
                          {msg.clientRef && (
                            <a
                              href={`/clients/${msg.clientRef.clientId}`}
                              className={cn(
                                'block rounded-2xl border-2 px-3.5 py-3 my-0.5 transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.99]',
                                isMine ? 'border-white/30 bg-white/10' : 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-white',
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <Avatar className={cn('h-10 w-10 rounded-xl border-2 shrink-0', isMine ? 'border-white/40' : 'border-indigo-200')}>
                                  <AvatarImage src={msg.clientRef.avatarUrl} className="object-cover" />
                                  <AvatarFallback className={cn('font-black text-xs', isMine ? 'bg-white/20 text-white' : 'bg-indigo-600 text-white')}>
                                    {(msg.clientRef.name || '?').charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <p className={cn('text-xs font-black uppercase truncate', isMine ? 'text-white' : 'text-slate-900')}>{msg.clientRef.name}</p>
                                  <p className={cn('text-[10px] font-bold', isMine ? 'text-white/70' : 'text-slate-500')}>{msg.clientRef.phone || 'Client'}</p>
                                </div>
                                <ChevronRight className={cn('w-4 h-4 shrink-0', isMine ? 'text-white/60' : 'text-indigo-400')} />
                              </div>
                              {(msg.clientRef.member || msg.clientRef.careFlag || msg.clientRef.lastVisit) && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {msg.clientRef.member === 'active' && (
                                    <span className={cn('text-[7px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 border', isMine ? 'bg-emerald-400/20 text-emerald-200 border-emerald-300/30' : 'bg-emerald-100 text-emerald-700 border-emerald-300')}>Member</span>
                                  )}
                                  {msg.clientRef.member === 'past_due' && (
                                    <span className={cn('text-[7px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 border', isMine ? 'bg-red-400/20 text-red-200 border-red-300/30' : 'bg-red-100 text-red-700 border-red-300')}>Past due</span>
                                  )}
                                  {msg.clientRef.careFlag && (
                                    <span className={cn('text-[7px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 border', isMine ? 'bg-sky-400/20 text-sky-200 border-sky-300/30' : 'bg-sky-100 text-sky-700 border-sky-300')}>Care notes</span>
                                  )}
                                  {msg.clientRef.lastVisit && (
                                    <span className={cn('text-[7px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 border', isMine ? 'bg-white/10 text-white/60 border-white/20' : 'bg-slate-100 text-slate-500 border-slate-200')}>Last visit {format(parseISO(msg.clientRef.lastVisit), 'MMM d')}</span>
                                  )}
                                </div>
                              )}
                            </a>
                          )}
                          {msg.body && <p>{renderBody(msg.body)}</p>}
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
                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <div className={cn('flex flex-wrap gap-1 mt-1', isMine ? 'justify-end' : 'justify-start')}>
                        {Object.entries(msg.reactions as Record<string, string[]>).map(([emoji, ids]) => (
                          <motion.button
                            key={emoji}
                            initial={{ scale: 0.4 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                            onClick={() => toggleReaction(msg, emoji)}
                            className={cn('h-6 px-1.5 rounded-full border-2 text-[11px] font-bold flex items-center gap-1 bg-white transition-colors', (ids as string[]).includes(activeStaffId || '') ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300')}
                          >
                            <span>{emoji}</span>
                            <span className="text-[9px] text-slate-500">{(ids as string[]).length}</span>
                          </motion.button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
            {typers.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
                <div className="bg-white border-2 border-slate-200 rounded-2xl rounded-bl-md px-4 py-2.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-[9px] font-black uppercase text-slate-400">{typers.join(' & ')} {typers.length === 1 ? 'is' : 'are'} typing</p>
              </motion.div>
            )}
            <div ref={scrollRef} />
          </CardContent>
          <CardFooter className="p-4 border-t bg-muted/5 flex-col gap-2">
            {clientPickerOpen && (
              <div className="w-full rounded-xl border-2 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Share a client — your message text rides along as the note</p>
                  <button onClick={() => setClientPickerOpen(false)} className="text-[9px] font-black uppercase text-muted-foreground hover:text-slate-700">Close</button>
                </div>
                <Input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Search clients..." className="h-9 rounded-lg border-2 text-xs font-bold" />
                <div className="max-h-44 overflow-y-auto space-y-1">
                  {shareClients === null && <p className="text-center py-3 text-[9px] font-black uppercase text-slate-400">Loading...</p>}
                  {(shareClients || []).filter((cl: any) => (cl.name || '').toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 25).map((cl: any) => (
                    <button key={cl.id} onClick={() => shareClientCard(cl)} className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-indigo-50 text-left">
                      <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 font-black text-[10px] flex items-center justify-center shrink-0">{(cl.name || '?').charAt(0)}</div>
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase truncate">{cl.name || 'Unnamed'}</p>
                        <p className="text-[10px] font-bold text-slate-400">{cl.phone || ''}</p>
                      </div>
                    </button>
                  ))}
                  {shareClients !== null && (shareClients || []).filter((cl: any) => (cl.name || '').toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                    <p className="text-center py-3 text-[9px] font-black uppercase text-slate-400">No matches</p>
                  )}
                </div>
              </div>
            )}
            {gifPickerOpen && (
              <GifPicker className="w-full" onSelect={sendGif} onClose={() => setGifPickerOpen(false)} />
            )}
            {recording && (
              <div className="w-full flex items-center gap-3 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <p className="text-[10px] font-black uppercase text-red-700 w-10 shrink-0">
                  {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}
                </p>
                <div className="flex items-end gap-0.5 h-6 flex-1">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span
                      key={i}
                      className="flex-1 rounded-sm bg-red-400 transition-all duration-75"
                      style={{
                        height: `${Math.max(10, Math.min(100, micLevel * 320 * (0.5 + (((i * 37) % 17) / 17) * 0.5)))}%`,
                        opacity: micLevel > 0.015 ? 1 : 0.25,
                      }}
                    />
                  ))}
                </div>
                <p className="text-[8px] font-bold uppercase text-red-400 shrink-0 hidden sm:block">
                  {micLevel > 0.015 ? 'Hearing you' : 'Speak up...'}
                </p>
                <button onClick={cancelRecording} className="text-[9px] font-black uppercase text-slate-500 hover:text-slate-800 px-1 shrink-0">Cancel</button>
              </div>
            )}
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
                variant="outline"
                onClick={openClientPicker}
                disabled={uploading || recording}
                className="h-12 w-12 rounded-xl shrink-0 p-0 border-2"
                title="Share a client profile"
              >
                <User className="w-4 h-4" />
              </Button>
              {GIF_ENABLED && (
                <Button
                  variant="outline"
                  onClick={() => setGifPickerOpen(v => !v)}
                  disabled={uploading || recording}
                  className="h-12 w-12 rounded-xl shrink-0 p-0 border-2 font-black text-[9px] tracking-widest"
                  title="Send a GIF"
                >
                  GIF
                </Button>
              )}
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
                onChange={e => { setMessageText(e.target.value); recordTyping(); }}
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
