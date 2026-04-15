'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, addDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { PartyPopper, Plus, Layers, Users, Calendar, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function EventsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const router = useRouter();

  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newEvent, setNewEvent] = useState({ name: '', date: '', venue: '', description: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(collection(firestore, `tenants/${tenantId}/events`));
    const unsub = onSnapshot(q, snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setLoading(false);
    });
    return unsub;
  }, [firestore, tenantId]);

  const handleCreate = async () => {
    if (!firestore || !tenantId || !newEvent.name || !newEvent.date) return;
    setSaving(true);
    const ref = await addDoc(collection(firestore, `tenants/${tenantId}/events`), {
      ...newEvent,
      tenantId,
      createdAt: new Date().toISOString(),
      status: 'upcoming',
      courses: [],
    });
    setSaving(false);
    setIsCreating(false);
    setNewEvent({ name: '', date: '', venue: '', description: '' });
    router.push(`/events/${ref.id}/manifest`);
  };

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
        <Button onClick={() => setIsCreating(true)}
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
          <Button onClick={() => setIsCreating(true)} variant="outline"
            className="h-10 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest border-2">
            Create your first event
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event: any) => (
            <div key={event.id}
              className="flex items-center justify-between p-5 rounded-2xl border-2 border-border hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group"
              onClick={() => router.push(`/events/${event.id}/manifest`)}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <PartyPopper className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-black uppercase tracking-tight text-slate-900">{event.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {event.date && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(event.date), 'MMM d, yyyy')}
                      </span>
                    )}
                    {event.venue && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{event.venue}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-2">
                  <button onClick={e => { e.stopPropagation(); router.push(`/events/${event.id}/manifest`); }}
                    className="h-8 px-3 rounded-xl border-2 border-border font-black uppercase text-[9px] tracking-widest hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center gap-1.5">
                    <Layers className="w-3 h-3" /> Manifest
                  </button>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create event dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
              <PartyPopper className="w-5 h-5 text-primary" /> New Event
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Event Name</Label>
              <Input value={newEvent.name} onChange={e => setNewEvent(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Spring Nail Night" className="h-12 rounded-xl border-2" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Date</Label>
              <input type="date" value={newEvent.date} onChange={e => setNewEvent(p => ({ ...p, date: e.target.value }))}
                className="w-full h-12 rounded-xl border-2 px-3 font-bold text-sm bg-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Venue (optional)</Label>
              <Input value={newEvent.venue} onChange={e => setNewEvent(p => ({ ...p, venue: e.target.value }))}
                placeholder="Studio, rooftop, etc." className="h-12 rounded-xl border-2" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={() => setIsCreating(false)} variant="outline"
                className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || !newEvent.name || !newEvent.date}
                className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
                {saving ? 'Creating…' : 'Create Event →'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}