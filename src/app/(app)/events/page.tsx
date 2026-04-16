'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { PartyPopper, Plus, Layers, Calendar, ChevronRight, Pencil, Trash2, Clock, Users, Lock, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

type EventFormData = {
  title: string;
  date: string;
  time: string;
  venue: string;
  description: string;
  accessPin: string;
  orderingDeadlineDate: string;
  orderingDeadlineTime: string;
  capacity: string;
  menuNote: string;
  eventType: string;
};

const BLANK_FORM: EventFormData = {
  title: '', date: '', time: '19:00', venue: '', description: '',
  accessPin: '', orderingDeadlineDate: '', orderingDeadlineTime: '17:00',
  capacity: '', menuNote: '', eventType: 'dinner',
};

const EVENT_TYPES = [
  { value: 'dinner', label: 'Dinner' },
  { value: 'reception', label: 'Reception' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'party', label: 'Party' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'other', label: 'Other' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  upcoming:  { label: 'Upcoming',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
  active:    { label: 'Live',      color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed: { label: 'Completed', color: 'bg-slate-100 text-slate-500 border-slate-200' },
  cancelled: { label: 'Cancelled', color: 'bg-red-50 text-red-500 border-red-200' },
};

export default function EventsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const router = useRouter();
  const { toast } = useToast();

  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null);
  const [form, setForm] = useState<EventFormData>(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
      collection(firestore, `tenants/${tenantId}/studioEvents`),
      snap => {
        setEvents(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        );
        setLoading(false);
      }
    );
    return unsub;
  }, [firestore, tenantId]);

  const openCreate = () => {
    setEditingEvent(null);
    setForm(BLANK_FORM);
    setIsDialogOpen(true);
  };

  const openEdit = (event: any) => {
    setEditingEvent(event);
    let deadlineDate = '';
    let deadlineTime = '17:00';
    if (event.orderingDeadline) {
      const d = new Date(event.orderingDeadline);
      deadlineDate = format(d, 'yyyy-MM-dd');
      deadlineTime = format(d, 'HH:mm');
    }
    setForm({
      title: event.title || event.name || '',
      date: event.date || '',
      time: event.time || '19:00',
      venue: event.venue || '',
      description: event.description || '',
      accessPin: event.accessPin || '',
      orderingDeadlineDate: deadlineDate,
      orderingDeadlineTime: deadlineTime,
      capacity: event.capacity ? String(event.capacity) : '',
      menuNote: event.menuNote || '',
      eventType: event.eventType || 'dinner',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!firestore || !tenantId || !form.title || !form.date) return;
    setSaving(true);

    const orderingDeadline = form.orderingDeadlineDate
      ? new Date(`${form.orderingDeadlineDate}T${form.orderingDeadlineTime}:00`).toISOString()
      : null;

    const data = {
      // FIX: save as 'title' so manifest page can read event.title correctly
      title: form.title.trim(),
      name: form.title.trim(), // keep name in sync for backwards compat
      date: form.date,
      time: form.time,
      venue: form.venue.trim() || null,
      description: form.description.trim() || null,
      accessPin: form.accessPin.trim() || null,
      orderingDeadline,
      capacity: form.capacity ? parseInt(form.capacity) : null,
      menuNote: form.menuNote.trim() || null,
      eventType: form.eventType,
      tenantId,
    };

    try {
      if (editingEvent) {
        await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, editingEvent.id), data);
        toast({ title: 'Event updated' });
      } else {
        const ref = await addDoc(
          collection(firestore, `tenants/${tenantId}/studioEvents`),
          { ...data, createdAt: new Date().toISOString(), status: 'upcoming', courses: [], menuItems: [] }
        );
        toast({ title: 'Event created' });
        setIsDialogOpen(false);
        setSaving(false);
        router.push(`/events/${ref.id}/manifest`);
        return;
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'Save failed' });
    } finally {
      setSaving(false);
      setIsDialogOpen(false);
      setEditingEvent(null);
    }
  };

  const handleDelete = async (event: any) => {
    if (!firestore || !tenantId) return;
    const ok = window.confirm(`Delete "${event.title || event.name}"? This cannot be undone.`);
    if (!ok) return;
    await deleteDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, event.id));
    toast({ title: 'Event deleted' });
  };

  const f = (key: keyof EventFormData, value: string) =>
    setForm(p => ({ ...p, [key]: value }));

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 flex items-center gap-3">
            <PartyPopper className="w-8 h-8 text-primary" /> Events
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 mt-1">
            Manage events, guest orders, and floor service
          </p>
        </div>
        <Button onClick={openCreate}
          className="h-11 px-6 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20 gap-2">
          <Plus className="w-4 h-4" /> New Event
        </Button>
      </div>

      {/* Events list */}
      {loading ? (
        <div className="text-center py-20 text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed rounded-3xl space-y-3">
          <PartyPopper className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="font-black uppercase text-[10px] tracking-widest text-muted-foreground opacity-40">No events yet</p>
          <Button onClick={openCreate} variant="outline"
            className="h-10 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest border-2">
            Create your first event
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event: any) => {
            const statusCfg = STATUS_CONFIG[event.status] || STATUS_CONFIG.upcoming;
            const displayName = event.title || event.name || 'Untitled Event';
            return (
              <div key={event.id}
                className="flex items-center justify-between p-5 rounded-2xl border-2 border-border hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group"
                onClick={() => router.push(`/events/${event.id}/manifest`)}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <PartyPopper className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black uppercase tracking-tight text-slate-900">{displayName}</p>
                      <Badge className={cn('font-black text-[8px] border', statusCfg.color)}>
                        {statusCfg.label}
                      </Badge>
                      {event.accessPin && (
                        <span className="flex items-center gap-1 text-[8px] font-black uppercase text-slate-400">
                          <Lock className="w-2.5 h-2.5" /> Private
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {event.date && (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(event.date), 'MMM d, yyyy')}
                          {event.time && ` · ${event.time}`}
                        </span>
                      )}
                      {event.venue && (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{event.venue}</span>
                      )}
                      {event.capacity && (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                          <Users className="w-3 h-3" /> {event.capacity} cap
                        </span>
                      )}
                      {event.orderingDeadline && (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Orders close {format(new Date(event.orderingDeadline), 'MMM d, h:mm a')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); openEdit(event); }}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(event); }}
                    className="p-2 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); router.push(`/events/${event.id}/manifest`); }}
                    className="h-8 px-3 rounded-xl border-2 border-border font-black uppercase text-[9px] tracking-widest hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center gap-1.5">
                    <Layers className="w-3 h-3" /> Manifest
                  </button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={v => { if (!v) { setIsDialogOpen(false); setEditingEvent(null); } }}>
        <DialogContent className="sm:max-w-xl rounded-[2rem] border-4 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
              <PartyPopper className="w-5 h-5 text-primary" />
              {editingEvent ? 'Edit Event' : 'New Event'}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-5">

            {/* Title + type */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Event Name *</Label>
                <Input value={form.title} onChange={e => f('title', e.target.value)}
                  placeholder="e.g. Spring Nail Night" className="h-12 rounded-xl border-2" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Event Type</Label>
                <select value={form.eventType} onChange={e => f('eventType', e.target.value)}
                  className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white">
                  {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Venue</Label>
                <Input value={form.venue} onChange={e => f('venue', e.target.value)}
                  placeholder="Studio, rooftop, etc." className="h-12 rounded-xl border-2" />
              </div>
            </div>

            {/* Date + time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Date *</Label>
                <input type="date" value={form.date} onChange={e => f('date', e.target.value)}
                  className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Start Time</Label>
                <input type="time" value={form.time} onChange={e => f('time', e.target.value)}
                  className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white" />
              </div>
            </div>

            {/* Capacity + description */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Max Capacity</Label>
                <Input type="number" min="1" value={form.capacity} onChange={e => f('capacity', e.target.value)}
                  placeholder="e.g. 40" className="h-12 rounded-xl border-2" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Access PIN (private events)</Label>
                <Input type="password" inputMode="numeric" maxLength={6}
                  value={form.accessPin} onChange={e => f('accessPin', e.target.value.replace(/\D/g, ''))}
                  placeholder="Leave blank for public" className="h-12 rounded-xl border-2 tracking-widest text-center font-black" />
              </div>
            </div>

            {/* Ordering deadline */}
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Order Submission Deadline
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={form.orderingDeadlineDate}
                  onChange={e => f('orderingDeadlineDate', e.target.value)}
                  className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white" />
                <input type="time" value={form.orderingDeadlineTime}
                  onChange={e => f('orderingDeadlineTime', e.target.value)}
                  className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white" />
              </div>
              <p className="text-[9px] text-muted-foreground font-bold">After this time guests can no longer submit orders.</p>
            </div>

            {/* Menu note */}
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Menu Note (shown to guests on order form)
              </Label>
              <Input value={form.menuNote} onChange={e => f('menuNote', e.target.value)}
                placeholder="e.g. All dishes are gluten-free. Please note any additional restrictions."
                className="h-12 rounded-xl border-2" />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Description (internal)</Label>
              <Input value={form.description} onChange={e => f('description', e.target.value)}
                placeholder="Internal notes about the event" className="h-12 rounded-xl border-2" />
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={() => { setIsDialogOpen(false); setEditingEvent(null); }} variant="outline"
                className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !form.title || !form.date}
                className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
                {saving ? 'Saving…' : editingEvent ? 'Save Changes' : 'Create Event →'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}