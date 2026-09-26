'use client';
// src/components/academy/AiCreditsMeter.tsx — this month's AI credits (Academy → Settings).
import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';

const LABELS: Record<string, string> = { 'ai-interactive': 'Interactives', 'ai-cases': 'Client cases', 'ai-video-questions': 'Video questions', 'ai-hotspots': 'Hotspots', 'ai-course': 'Course builder', 'qbank-ai': 'Questions', 'ai-plan': 'Lesson plans', 'worksheet-ai': 'Worksheets', 'ai-assignment': 'Assignments', 'ai-draft': 'Quizzes & flashcards', 'submission-ai': 'Grading feedback' };
export function AiCreditsMeter({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { (async () => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : ''; const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: 'ai-credits', tenantId }) }); const j = await r.json().catch(() => null); if (j?.ok) setD(j); })(); }, [tenantId]);
  if (!d) return null;
  const pct = Math.min(100, Math.round((d.used / Math.max(1, d.allowance)) * 100));
  return (
    <section className="space-y-2 rounded-2xl bg-muted/40 p-4">
      <div className="flex items-baseline justify-between"><p className="font-black">✨ AI credits this month</p><p className="text-sm"><b>{d.left}</b> of {d.allowance} left</p></div>
      <div className="h-3 rounded-full bg-background"><div className={`h-3 rounded-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-violet-600'}`} style={{ width: `${pct}%` }} /></div>
      <p className="text-[12px] text-muted-foreground">Resets {new Date(d.resetsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}. Interactive (Claude Opus) {d.weights['ai-interactive']} · course builder {d.weights['ai-course']} · questions {d.weights['qbank-ai']} · lesson plan, worksheet, assignment {d.weights['ai-plan']} · grading feedback {d.weights['submission-ai']}. Saved materials reprint free. Failed attempts are refunded; students’ AI tutor doesn’t use these.</p>
      {Object.keys(d.byPurpose).length > 0 && <p className="text-[12px]">{Object.entries(d.byPurpose).filter(([, n]: any) => n > 0).map(([k, n]: any) => `${LABELS[k] || k} ${n}`).join(' · ')}</p>}
    </section>
  );
}
