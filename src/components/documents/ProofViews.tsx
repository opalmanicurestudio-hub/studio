// src/components/documents/ProofViews.tsx — THE TWO READ-ONLY PROOF PAGES' LAYOUTS (lib/training-proof): the
// proof-of-training page for one document, and the inspector view. The pages check the link and load the data; these
// draw it (kept apart so they can be previewed with sample data).
import { PrintButton } from '@/components/documents/PrintButton';
import { DocBlocks } from '@/components/documents/DocBlocks';

const SOFT = '#f3f3f5', GREEN = '#1f7a4d', BLUE = '#3d5a99';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: '#16171a', letterSpacing: '-0.01em' } as const;
const INK = '#16171a', MUTED = '#6d7075', LINE = '#e3e3e6', ILINE = '#ececee', AMBER = '#b45309', RED = '#b42318';
const when = (iso?: string, tz?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '');


export function ProofView({ data }: { data: any }) {
  const { business, d, v, col, roster, signed, total, runs, month } = data; const tz = business.tz;
  const history = (Array.isArray(d.history) ? [...d.history] : []).reverse();
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, background: '#f4f4f5', minHeight: '100vh', letterSpacing: '-0.01em' }}>
      <style>{`@page { size: letter; margin: 0.5in; } @media print { .no-print { display: none !important; } .sheet { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; padding: 0 !important; } body { background: #fff; } } .row { break-inside: avoid; }`}</style>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 20px', maxWidth: 816, margin: '0 auto' }}><span style={{ fontSize: 13, color: MUTED }}>Proof of training · read-only</span><PrintButton /></div>
      <div className="sheet" style={{ maxWidth: 816, margin: '0 auto 40px', background: '#fff', borderRadius: 18, padding: '48px 56px', boxShadow: '0 1px 3px rgba(22,23,26,.1)', fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{business.logo ? <img src={business.logo} alt="" style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'cover' }} /> : <span style={{ width: 40, height: 40, borderRadius: 12, background: INK, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>{business.name.slice(0, 1)}</span>}
            <div><div style={{ fontSize: 14, fontWeight: 700 }}>{business.name}</div><div style={{ color: MUTED }}>{[business.address, business.license ? `License ${business.license}` : ''].filter(Boolean).join(' · ')}</div></div></div>
          <div style={{ textAlign: 'right', color: MUTED }}>Printed {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz })}</div>
        </div>
        <div style={{ marginTop: 22 }}><div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>proof of training</div><div style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-.03em' }}>{d.title}</div>
          <div style={{ color: MUTED, marginTop: 2 }}>{col.name} · version {v}{d.publishedAt ? `, published ${when(d.publishedAt, tz).split(',').slice(0, 2).join(',')}` : ''}{d.updatedBy ? ` by ${d.updatedBy}` : ''}{d.reviewEveryMonths ? ` · reviewed every ${d.reviewEveryMonths} months` : ''}</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 18 }}>
          {[['Signed version ' + v, `${signed} of ${total}`], ['Quick check', Array.isArray(d.quiz) && d.quiz.length ? `${d.quiz.length} question${d.quiz.length === 1 ? '' : 's'}` : 'None'], ['Signature', d.requireSignature ? 'Drawn on their phone' : 'Confirmed in the app']].map(([a, b]) => <div key={a} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}><div style={{ color: MUTED }}>{a}</div><div style={{ fontSize: 17 }}>{b}</div></div>)}
        </div>
        <div style={{ marginTop: 20 }}><div style={{ fontSize: 13, fontWeight: 700, paddingBottom: 4 }}>Sign-offs</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .8fr 1.5fr .5fr .6fr 1fr', color: MUTED, fontSize: 11, paddingBottom: 4 }}><span>Name</span><span>Role</span><span>Signed</span><span>Ver.</span><span>Check</span><span>Signature</span></div>
          {roster.map((r: any) => <div key={r.name} className="row" style={{ display: 'grid', gridTemplateColumns: '1.3fr .8fr 1.5fr .5fr .6fr 1fr', padding: '8px 0', borderTop: `1px solid ${LINE}`, fontSize: 11.5, alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>{r.name}</span><span style={{ textTransform: 'capitalize' }}>{r.role.replace(/_/g, ' ')}</span>
            <span>{r.ack ? when(r.ack.acknowledgedAt, tz) : '—'}</span><span>{r.ack ? `v${r.ack.version}` : '—'}</span><span>{r.ack?.quiz ? `${r.ack.quiz.right}/${r.ack.quiz.total}` : '—'}</span>
            <span>{r.current && r.ack?.signatureUrl ? <img src={r.ack.signatureUrl} alt={`${r.name} signature`} style={{ height: 24, maxWidth: 110, objectFit: 'contain' }} /> : r.current ? 'Confirmed' : r.ack ? <span style={{ color: AMBER }}>Signed v{r.ack.version} — asked to sign again</span> : <span style={{ color: RED }}>Not signed{d.signBy ? ` · due ${new Date(`${d.signBy}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}</span>}</span></div>)}
        </div>
        {history.length > 0 && <div style={{ marginTop: 20 }}><div style={{ fontSize: 13, fontWeight: 700, paddingBottom: 4 }}>Version history</div>
          {history.slice(0, 10).map((h: any) => <div key={`${h.version}-${h.at}`} className="row" style={{ display: 'grid', gridTemplateColumns: '50px 120px 1fr', padding: '7px 0', borderTop: `1px solid ${LINE}` }}><b>v{h.version}</b><span>{when(h.at, tz).split(',').slice(0, 2).join(',')}</span><span>{h.note || '—'}</span></div>)}</div>}
        {runs.count > 0 && <div style={{ marginTop: 20 }}><div style={{ fontSize: 13, fontWeight: 700, paddingBottom: 4 }}>Checklist runs · {monthName}</div><div style={{ color: MUTED }}>{runs.count} run{runs.count === 1 ? '' : 's'} on {runs.days} day{runs.days === 1 ? '' : 's'} · {runs.complete} finished · {runs.photos} photo{runs.photos === 1 ? '' : 's'} on file</div></div>}
        <div style={{ marginTop: 28, borderTop: `1px solid ${LINE}`, paddingTop: 10, color: MUTED, fontSize: 10.5 }}>Each sign-off was made by the person in the app{d.quiz?.length ? ' after a quick check' : ''}. Times are the business’s local time. Photos and the full record are kept in ClarityFlow.</div>
      </div>
    </div>);
}

export function InspectorView({ data, link, base, open }: { data: any; link: any; base: string; open?: { d: any; row: any } | null }) {
  const { business } = data;
  const self = (extra = '') => `${base}${extra}`;
  const exp = new Date(link.expiresAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: business.tz });
  const header = <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>{business.logo ? <img src={business.logo} alt="" style={{ width: 46, height: 46, borderRadius: 14, objectFit: 'cover' }} /> : <span style={{ width: 46, height: 46, borderRadius: 14, background: INK, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>{business.name.slice(0, 1)}</span>}
      <div><div style={{ fontSize: 15, fontWeight: 700 }}>{business.name}</div><div style={{ fontSize: 13, color: MUTED }}>{[business.license ? `License ${business.license}` : '', business.address].filter(Boolean).join(' · ')}</div></div></div>
    <div style={{ textAlign: 'right' }}><span style={{ display: 'inline-flex', height: 26, alignItems: 'center', padding: '0 10px', borderRadius: 13, background: '#e6ecf7', color: BLUE, fontSize: 12, fontWeight: 600 }}>Read-only</span><div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>Shared by {link.createdBy || 'the business'} · open until {exp}</div></div></div>;

  if (open) {
    const { d, row } = open;
    return <div style={{ ...font, background: '#f7f7f8', minHeight: '100vh' }}><style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 60px', display: 'flex', flexDirection: 'column', gap: 18 }}>{header}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><a href={self()} style={{ fontSize: 14, color: MUTED }}>‹ All records</a><PrintButton label="Print this procedure" /></div>
        <div style={{ background: '#fff', border: `1px solid ${ILINE}`, borderRadius: 18, padding: '26px 28px' }}>
          <div style={{ fontSize: 13, color: MUTED }}>{row.collection} · version {row.version}{row.publishedAt ? ` · ${new Date(row.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''} · {row.trained} of {row.total} trained</div>
          <h1 style={{ margin: '4px 0 18px', fontSize: 30, fontWeight: 400, letterSpacing: '-.03em' }}>{row.title}</h1>
          <DocBlocks sections={d.sections || []} /></div></div></div>;
  }
  const log = !!data.log; const [y, m] = data.month.split('-').map(Number); const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return (
    <div style={{ ...font, background: '#f7f7f8', minHeight: '100vh' }}>
      <style>{`@media print { .no-print { display: none !important; } } @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr !important; } }`}</style>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '30px 20px 60px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {header}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}><div><h1 style={{ margin: 0, fontSize: 34, fontWeight: 400, letterSpacing: '-.03em' }}>Safety records</h1><div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>Current procedures{data.collections.length ? ` (${data.collections.join(', ')})` : ''} and who has been trained on them{log ? ', with the sterilization log' : ''}.</div></div><PrintButton label="Print or save as PDF" /></div>
        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: log ? '1.2fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ background: '#fff', border: `1px solid ${ILINE}`, borderRadius: 18, overflow: 'hidden' }}>
            {!data.rows.length ? <p style={{ padding: 20, color: MUTED }}>No published procedures in this link.</p> : data.rows.map((r: any, i: number) => <a key={r.id} href={self(`&doc=${encodeURIComponent(r.id)}`)} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, alignItems: 'center', padding: '14px 18px', borderTop: i ? `1px solid ${ILINE}` : undefined, color: INK, textDecoration: 'none' }}>
              <span><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{r.title}</span><span style={{ fontSize: 12.5, color: MUTED }}>{r.collection} · v{r.version}{r.publishedAt ? ` · ${new Date(r.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span></span>
              <span style={{ fontSize: 13, color: r.total && r.trained === r.total ? GREEN : INK }}>{r.trained} of {r.total} trained</span><span style={{ fontSize: 13, textDecoration: 'underline' }}>Open</span></a>)}
          </div>
          {log && <div style={{ background: '#fff', border: `1px solid ${ILINE}`, borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Sterilization log · {new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <span key={i} style={{ fontSize: 11, textAlign: 'center', color: MUTED }}>{x}</span>)}
              {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: days }, (_, i) => { const key = `${data.month}-${String(i + 1).padStart(2, '0')}`; const e = data.byDay[key]; const future = key > data.today;
                const bg = !e ? SOFT : e.failed ? '#fdecec' : '#e9f3ed'; const fg = !e ? MUTED : e.failed ? RED : GREEN;
                return <span key={key} title={e ? `${e.passed} passed${e.failed ? `, ${e.failed} failed` : ''}${e.spore ? ', spore test' : ''}` : future ? '' : 'No cycle logged'} style={{ aspectRatio: '1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, background: future ? 'transparent' : bg, color: future ? '#b6b8bd' : fg, fontWeight: e ? 600 : 400, outline: e?.spore ? `2px solid ${BLUE}` : undefined }}>{i + 1}</span>; })}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED }}>{data.cycleCount} cycle{data.cycleCount === 1 ? '' : 's'} this month. Green: cycles passed that day. Red: a cycle failed. Outlined: spore test recorded.</div>
          </div>}
        </div>
      </div>
    </div>);
}
