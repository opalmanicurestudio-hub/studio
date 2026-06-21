'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader, CheckCircle2, AlertTriangle, Calendar, Ban, Phone } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const CLIENT_REASON_OPTIONS = [
  { value: 'schedule_conflict', label: 'Schedule Conflict' },
  { value: 'changed_mind', label: 'Changed Mind' },
  { value: 'found_alternative', label: 'Found Alternative' },
  { value: 'price_concern', label: 'Price Concern' },
  { value: 'health_or_childcare', label: 'Health / Childcare' },
  { value: 'other', label: 'Other' },
];

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  return new Date(val);
};

export default function SelfCancelPage() {
  const params = useParams<{ tenantId: string; appointmentId: string }>();
  const { tenantId, appointmentId } = params;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<any>(null);
  const [reason, setReason] = useState('schedule_conflict');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!tenantId || !appointmentId) return;
    fetch(`/api/appointments/self-cancel?tenantId=${tenantId}&appointmentId=${appointmentId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.ok) { setError(data.error || 'This appointment could not be found.'); return; }
        setDetails(data);
      })
      .catch(() => setError('Something went wrong loading your appointment.'))
      .finally(() => setIsLoading(false));
  }, [tenantId, appointmentId]);

  const handleCancel = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/appointments/self-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, appointmentId, clientReason: reason }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || 'Could not cancel this appointment.'); return; }
      setResult(data);
    } catch {
      setError('Something went wrong. Please call the studio directly.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="max-w-md w-full border-2 rounded-[2rem] shadow-xl">
          <CardContent className="p-8 text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
            <p className="font-black uppercase text-sm text-slate-900">{error}</p>
            {details?.studioPhone && (
              <a href={`tel:${details.studioPhone}`} className="text-xs font-bold text-primary flex items-center justify-center gap-1.5">
                <Phone className="w-3 h-3" /> {details.studioPhone}
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="max-w-md w-full border-2 rounded-[2rem] shadow-xl">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-black uppercase text-lg text-slate-900">
              {result.alreadyCancelled ? 'Already Cancelled' : 'Appointment Cancelled'}
            </p>
            {!result.alreadyCancelled && (
              result.feeCharged ? (
                <p className="text-sm text-muted-foreground">
                  Since this is within the studio's {details?.windowHours}-hour cancellation window, a ${Number(result.feeAmount).toFixed(2)} cancellation fee applies.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No cancellation fee applies — thanks for the advance notice.</p>
              )
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <Card className="max-w-md w-full border-4 rounded-[2.5rem] shadow-2xl overflow-hidden">
        <CardHeader className="bg-muted/5 border-b p-6 text-left">
          <CardTitle className="text-xl font-black uppercase tracking-tighter text-slate-900 flex items-center gap-2">
            <Ban className="w-5 h-5 text-destructive" /> Cancel Appointment
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6 text-left">
          <div className="p-4 rounded-2xl border-2 bg-muted/5 space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{details?.studioName}</p>
            <p className="font-black text-sm text-slate-900">{details?.appointment?.serviceName}</p>
            <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              {details?.appointment?.startTime ? format(safeDate(details.appointment.startTime), 'MMMM d, yyyy · h:mm a') : ''}
            </p>
          </div>

          {details?.isLate ? (
            <div className="p-4 rounded-2xl border-2 border-amber-200 bg-amber-50 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs font-bold text-amber-700">
                This is within the {details.windowHours}-hour cancellation window. A ${Number(details.estimatedFee).toFixed(2)} cancellation fee will apply.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl border-2 border-green-200 bg-green-50">
              <p className="text-xs font-bold text-green-700">No cancellation fee — thanks for the advance notice.</p>
            </div>
          )}

          {details?.cancellationPolicyText && (
            <p className="text-[10px] text-muted-foreground leading-relaxed italic">{details.cancellationPolicyText}</p>
          )}

          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reason (optional)</Label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full h-11 rounded-xl border-2 px-3 text-sm font-bold bg-white"
            >
              {CLIENT_REASON_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs font-bold text-destructive">{error}</p>
          )}

          <Button
            onClick={handleCancel}
            disabled={isSubmitting}
            variant="destructive"
            className="w-full h-14 rounded-2xl font-black uppercase text-sm tracking-widest"
          >
            {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : 'Confirm Cancellation'}
          </Button>

          {details?.studioPhone && (
            <p className="text-center text-[10px] text-muted-foreground">
              Prefer to talk to someone? Call <a href={`tel:${details.studioPhone}`} className="font-bold text-primary">{details.studioPhone}</a>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
