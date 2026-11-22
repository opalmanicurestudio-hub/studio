'use client';
// src/components/menu/LaneEntrySettings.tsx — THE LINE BEFORE THE SPEAKER, on the Menu page (a manager; design board
// "Rush and the lane entry"): a link per lane for a sensor at the lane entry to call each time a car passes (shown once:
// a new one stops the old), when it last counted a car, and when the kitchen sees orders as they're said.
// api/menu 'laneSettings' (sensor, kitchenEarly); lib/lane-entry, lib/lane-entry-server. With more than one location,
// each location's lanes have their own link (and one set up before there were locations shows until it's turned off).
import { useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', RED = '#b42318';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const QUIET = { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` } as const;
export type SensorRow = { lane: 1 | 2; on: boolean; lastAt: string | null; locationId?: string | null; place?: string | null };
export type EarlyMode = 'rush' | 'always' | 'off';

/** How long ago, in words ("12 sec ago", "4 min ago", "Nov 20"). */
function ago(iso: string | null, now: number): string {
  const t = Date.parse(String(iso || '')); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} sec ago`; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function LaneEntrySettings({ sensors: start, early: startEarly, two, call }: { sensors: SensorRow[]; early: EarlyMode; two: boolean; call: (body: any) => Promise<any> }) {
  const [sensors, setSensors] = useState<SensorRow[]>(start);
  const [early, setEarly] = useState<EarlyMode>(startEarly);
  const [link, setLink] = useState<{ lane: 1 | 2; at?: string | null; link: string } | null>(null);
  const several = sensors.some((x) => !!x.locationId);
  const same = (l: { lane: 1 | 2; at?: string | null } | null, x: SensorRow) => !!l && l.lane === x.lane && (l.at || null) === (x.locationId || null);
  const nameOf = (x: SensorRow) => (several ? `${x.place || 'Every location'}${two ? `, lane ${x.lane}` : ''}` : two ? `Lane ${x.lane}` : '');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const sensor = async (x: SensorRow, what: 'new' | 'stop' | 'check') => {
    setBusy(`${what}${x.locationId || ''}${x.lane}`); setErr('');
    const d = await call({ action: 'laneSettings', sensor: what, lane: x.lane, at: x.locationId || null });
    setBusy(''); setNow(Date.now());
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    if (Array.isArray(d.lane?.sensors)) setSensors(d.lane.sensors);
    setLink(what === 'new' && d.sensorLink?.link ? d.sensorLink : what === 'stop' && same(link, x) ? null : link);
  };
  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr('Couldn’t copy. Select the link and copy it.'); } };
  const pickEarly = async (v: EarlyMode) => {
    const was = early; setEarly(v); setBusy('early'); setErr('');
    const d = await call({ action: 'laneSettings', kitchenEarly: v });
    setBusy(''); if (!d.ok) { setEarly(was); setErr(d.error || 'That didn’t save.'); }
  };

  return (
    <>
      <div role="group" aria-labelledby="lane-entry" className="space-y-2.5 border-t pt-3" style={{ borderColor: LINE }}>
        <span><span id="lane-entry" className="block text-[15px] font-medium">Lane entry sensor</span>
          <span className="block text-[13px]" style={{ color: MUTED }}>Counts cars as they join the line, so the lane screen shows how many are waiting to order and a rush starts sooner. Any sensor that can call a web link when a car passes works: a vehicle loop or a driveway sensor through a smart relay, or a camera with line crossing.</span></span>
        {sensors.filter((x) => two || x.lane === 1).map((x) => (
          <div key={`${x.locationId || ''}${x.lane}`} className="space-y-2 rounded-xl p-3" style={{ boxShadow: `inset 0 0 0 1px ${LINE}`, background: '#fff' }}>
            <p className="text-[14px]">{nameOf(x) && <b className="font-semibold">{nameOf(x)}: </b>}{x.on ? <><span className="font-semibold" style={{ color: GREEN }}>Set up.</span> {x.lastAt ? `Last car ${ago(x.lastAt, now)}.` : 'No car counted yet.'}</> : <span style={{ color: MUTED }}>Not set up.</span>}</p>
            {several && !x.locationId && <p className="text-[13px]" style={{ color: MUTED }}>Set up before there were locations, so it counts for screens that aren’t set up for one. Make a link for the location it’s at, then turn this one off.</p>}
            {link && same(link, x) && (
              <div className="space-y-1.5">
                <p className="text-[13px]" style={{ color: MUTED }}>Give this link to the sensor. It’s shown only now; make a new one if it’s lost.</p>
                <div className="flex flex-wrap gap-2">
                  <input readOnly value={link.link} onFocus={(e) => e.currentTarget.select()} aria-label={`The link for ${nameOf(x) || `lane ${x.lane}`}’s sensor`} className="min-h-[44px] min-w-0 flex-1 rounded-xl px-3 text-[13px]" style={{ background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }} />
                  <button type="button" onClick={copy} className={BTN} style={{ background: INK, color: '#fff' }}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => void sensor(x, 'new')} className={BTN} style={x.on ? QUIET : { background: INK, color: '#fff' }}>{x.on ? 'Make a new link' : 'Set up a sensor'}</button>
              {x.on && <button type="button" disabled={!!busy} onClick={() => void sensor(x, 'check')} className={BTN} style={QUIET}>Check it</button>}
              {x.on && <button type="button" disabled={!!busy} onClick={() => void sensor(x, 'stop')} className={BTN} style={{ ...QUIET, color: RED }}>Turn off</button>}
            </div>
          </div>
        ))}
        {sensors.some((x) => x.on && (two || x.lane === 1)) && <p className="text-[13px]" style={{ color: MUTED }}>To check it, pass the sensor (or drive past it), then tap Check it.</p>}
      </div>
      <div role="group" aria-labelledby="kitchen-early" className="space-y-2 border-t pt-3" style={{ borderColor: LINE }}>
        <span><span id="kitchen-early" className="block text-[15px] font-medium">Show the kitchen orders as they’re taken</span>
          <span className="block text-[13px]" style={{ color: MUTED }}>What’s said at the speaker shows on the kitchen screen before it’s sent, so the grill can start. Only shown: nothing comes out of stock until it’s sent.</span></span>
        <span className="flex flex-wrap gap-2">
          {([['rush', 'In a rush'], ['always', 'Always'], ['off', 'Never']] as [EarlyMode, string][]).map(([v, label]) => { const on = early === v; return (
            <button key={v} type="button" aria-pressed={on} aria-disabled={busy === 'early'} onClick={() => { if (!on && busy !== 'early') void pickEarly(v); }} className={`${BTN} aria-disabled:opacity-50`}
              style={on ? { background: INK, color: '#fff' } : QUIET}>{label}</button>); })}
        </span>
      </div>
      {err && <p className="text-[13.5px]" style={{ color: 'var(--bad-ink, #b42318)' }} role="alert">{err}</p>}
    </>
  );
}
