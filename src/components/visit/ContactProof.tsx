'use client';
// src/components/visit/ContactProof.tsx — the short answer to "did they get it?" at the top of a visit's
// Communications, and the printable contact record (lib/contact-record) behind it.
import * as React from 'react';
import { FileText } from 'lucide-react';
import { contactRecord, contactSummary, contactRecordHtml } from '@/lib/contact-record';

const when = (t: string, tz?: string) => { try { return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }); } catch { return ''; } };

export function ContactProof({ appointment, messages, studio, tz }: { appointment: any; messages: any[]; studio: string; tz?: string }) {
  const rows = React.useMemo(() => contactRecord(appointment, messages), [appointment, messages]);
  const s = contactSummary(rows);
  if (!rows.length) return null;
  const line = s.firstAction
    ? `${s.firstAction.what} · ${when(s.firstAction.at, tz)}`
    : s.delivered ? 'Delivered, no reply or link opened yet' : s.sent ? 'Sent, no delivery report yet' : 'Nothing delivered yet';
  const open = () => {
    const start = appointment?.startTime ? when(String(appointment.startTime), tz) : '';
    const html = contactRecordHtml({ studio, clientName: String(appointment?.clientName || 'Client'), visitWhen: start, service: appointment?.serviceName, appointmentId: String(appointment?.id || ''), rows, tz });
    const w = window.open('', '_blank'); if (!w) return; w.document.open(); w.document.write(html); w.document.close();
  };
  return (
    <div className="rounded-xl border p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-tight">{s.acted ? 'The client has seen this visit' : 'Has the client seen it?'}</p>
        <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{line}</p>
        <p className="text-[12px] text-muted-foreground mt-0.5">{s.sent} sent · {s.delivered} delivered · {s.acted} client action{s.acted === 1 ? '' : 's'}{s.problems ? ` · ${s.problems} not delivered` : ''}</p>
      </div>
      <button type="button" onClick={open} className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-[12px] font-semibold hover:bg-muted">
        <FileText className="w-3.5 h-3.5" /> Contact record
      </button>
    </div>
  );
}
