'use client';
// /practice — PRACTICE A SHIFT. A playable Saturday morning in a full-service salon, built on ClarityFlow's own rules
// (lib/practice/sim). Tap a person to see what they need; tap a glowing place to send them there. Decisions appear next
// to the people involved and pause time. Nothing here touches real data: no clients, texts or payments.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as G from '@/lib/practice/sim';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const MOOD_HEX: Record<G.Mood, string> = { ok: '#2f9e63', warn: '#e0911f', bad: '#d6453a' };
const GAME_MIN_SEC = 1.4;   // one game minute takes 1.4 seconds at 1×
const TEST_SPEED = typeof window !== 'undefined' ? Math.max(1, Math.min(20, Number(new URLSearchParams(window.location.search).get('fast')) || 1)) : 1;   // ?fast=8 for quick checks
type Mode = null | { kind: 'move'; personId: string } | { kind: 'serve'; clientId: string };
type Pt = { x: number; y: number; on: boolean };

export default function PracticePage() {
  const host = useRef<HTMLDivElement>(null);
  const sim = useRef<G.State>(G.newShift());
  const eng = useRef<any>(null);
  const ui = useRef({ started: false, paused: false, speed: 1, sel: null as string | null, mode: null as Mode, focusOn: false });
  const [, setFrame] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showTexts, setShowTexts] = useState(false);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [ready, setReady] = useState(false);
  const [webglError, setWebglError] = useState(false);
  ui.current.started = started; ui.current.paused = paused; ui.current.speed = speed; ui.current.sel = sel; ui.current.mode = mode;

  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600); }, []);

  // ── The 3D salon ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true, raf = 0;
    (async () => {
      const el = host.current; if (!el) return;
      let S: any; try { const { createSalon } = await import('@/lib/practice/scene'); S = createSalon(el); } catch { setWebglError(true); return; }
      if (!alive) { S.renderer.dispose(); return; }
      const THREE = S.THREE; const scene = S.scene;
      const [w0, h0] = S.getSize(); setSize({ w: w0, h: h0 });
      // Camera: an angled view from above, which glides in for decisions.
      const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 200);
      const DIR = new THREE.Vector3(24, 26, 24).normalize().multiplyScalar(70);
      const view = { tx: 14.8, tz: 9.0, zoom: 1, goalX: 14.8, goalZ: 9.0, goalZoom: 1, userX: 14.8, userZ: 9.0, userZoom: 1 };
      const fit = () => { const [w, h] = S.getSize(); const a = w / h; const s = Math.max(11.0, 20.5 / a); cam.left = -s * a; cam.right = s * a; cam.top = s; cam.bottom = -s; cam.updateProjectionMatrix(); };
      fit();
      // People, their rings and invisible tap targets
      const groups = new Map<string, { g: any; key: string; ring: any; arc: any; arcP: number; hit: any; sel: any }>();
      const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const ringGeo = new THREE.RingGeometry(0.4, 0.5, 48);
      const selGeo = new THREE.CircleGeometry(0.62, 40);
      // Places you can send someone (shown while choosing where)
      const spotDiscs = new Map<string, any>();
      const discGeo = new THREE.RingGeometry(0.44, 0.54, 40), discFill = new THREE.CircleGeometry(0.36, 32);
      for (const sp of Object.values(sim.current.spots)) {
        const m = new THREE.Group(); m.position.set(sp.x, 0.03, sp.z); m.visible = false;
        const r = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.6 })); r.rotation.x = -Math.PI / 2;
        const f = new THREE.Mesh(discFill, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 })); f.rotation.x = -Math.PI / 2;
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 16), hitMat); hit.position.y = 0.8; hit.userData.spotId = sp.id;
        m.add(r, f, hit); m.userData = { spotId: sp.id, ring: r, hit }; scene.add(m); spotDiscs.set(sp.id, m);
      }
      const look = (p: G.Person, sp: G.Spot | null, walking: boolean) => {
        const pose = p.look.wheelchair ? 'chair' : walking || !sp ? 'stand' : sp.pose;
        return { ...p.look, staff: p.role === 'staff', pose, seat: p.look.wheelchair ? 0.6 : sp?.seat ?? 0.7, tilt: sp?.tilt, ry: sp?.ry ?? 0 };
      };
      const anchorOf = (p: G.Person) => {
        const sp = p.at ? sim.current.spots[p.at] : null; const walking = p.path.length > 0 || !sp;
        if (walking || !sp) return { x: p.x, y: 2.15, z: p.z, rx: p.x, rz: p.z };
        const s = Math.sin(sp.ry), c = Math.cos(sp.ry);
        if (sp.pose === 'lie') return { x: sp.x - s * 0.9, y: sp.seat + 0.9, z: sp.z - c * 0.9, rx: sp.x + s * 0.5, rz: sp.z + c * 0.5 };
        if (sp.pose === 'sit') return { x: sp.x, y: sp.seat + 1.5, z: sp.z, rx: sp.x + s * 1.05, rz: sp.z + c * 1.05 };
        return { x: sp.x, y: p.look.wheelchair ? 1.95 : 2.15, z: sp.z, rx: sp.x, rz: sp.z };
      };
      const sync = (time: number) => {
        const st = sim.current;
        for (const p of Object.values(st.people)) {
          let rec = groups.get(p.id);
          if (p.state === 'gone') { if (rec) { scene.remove(rec.g, rec.ring, rec.arc, rec.hit, rec.sel); groups.delete(p.id); } continue; }
          const sp = p.at ? st.spots[p.at] : null; const walking = p.path.length > 0 || !p.at;
          const key = `${walking ? 'walk' : p.at}`;
          if (!rec || rec.key !== key) {
            if (rec) scene.remove(rec.g);
            const g = S.person(walking || !sp ? p.x : sp.x, walking || !sp ? p.z : sp.z, look(p, sp, walking)); S.fixEnv(g);
            if (!rec) {
              const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })); ring.rotation.x = -Math.PI / 2;
              const arc = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: MOOD_HEX.ok, transparent: true, opacity: 0.95, depthWrite: false })); arc.rotation.x = -Math.PI / 2;
              const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.0, 12), hitMat); hit.userData.personId = p.id;
              const selM = new THREE.Mesh(selGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false })); selM.rotation.x = -Math.PI / 2;
              scene.add(ring, arc, hit, selM); rec = { g, key, ring, arc, arcP: -1, hit, sel: selM }; groups.set(p.id, rec);
            } else { rec.g = g; rec.key = key; }
          }
          const g = rec.g; const a = anchorOf(p);
          if (walking) {
            g.position.x = p.x; g.position.z = p.z; const n = p.path[0];
            if (n) g.rotation.y = Math.atan2(n.x - p.x, n.z - p.z);
            const legs = g.userData.legs || []; legs.forEach((l: any, i: number) => { l.rotation.x = Math.sin(time * 9 + i * Math.PI) * 0.45; });
            g.position.y = p.look.wheelchair ? 0 : Math.abs(Math.sin(time * 9)) * 0.03;
          }
          // Ring: clients show patience; the team shows a quiet white ring
          const showRing = p.role === 'client';
          rec.ring.visible = showRing; rec.arc.visible = showRing;
          rec.ring.position.set(a.rx, 0.015, a.rz); rec.arc.position.set(a.rx, 0.02, a.rz);
          if (showRing) {
            const pp = Math.round(Math.max(0.02, p.patience) * 50) / 50;
            if (pp !== rec.arcP) { rec.arc.geometry = new THREE.RingGeometry(0.4, 0.5, 48, 1, Math.PI / 2, Math.PI * 2 * pp); rec.arcP = pp; }
            rec.arc.material.color.set(MOOD_HEX[G.moodOf(p)]);
          }
          rec.hit.position.set(a.x, 1.0, a.z);
          const isSel = ui.current.sel === p.id || (ui.current.mode?.kind === 'move' && ui.current.mode.personId === p.id);
          rec.sel.position.set(a.rx, 0.012, a.rz); rec.sel.material.opacity = isSel ? 0.55 + Math.sin(time * 5) * 0.2 : 0;
        }
        // Places to send someone
        const m = ui.current.mode; const moving = m?.kind === 'move' ? st.people[m.personId] : null;
        const prompted = new Set(st.prompts.filter((q) => q.to).map((q) => q.to as string));
        for (const [id, d] of spotDiscs) {
          const sp = st.spots[id]; let on = false;
          if (moving) on = validTarget(st, moving, sp);
          else on = prompted.has(id);
          d.visible = on; if (on) { const k = 1 + Math.sin(time * 4) * 0.08; d.userData.ring.scale.set(k, k, k); d.userData.ring.material.color.set(prompted.has(id) ? '#1f7a4d' : INK); }
        }
      };
      // Camera glide
      const placeCam = (dt: number) => {
        const st = sim.current; const d = st.open.find((x) => x.pause);
        if (d && d.who.length) {
          const ps = d.who.map((id) => st.people[id]).filter(Boolean);
          view.goalX = ps.reduce((a, p) => a + p.x, 0) / ps.length; view.goalZ = ps.reduce((a, p) => a + p.z, 0) / ps.length; view.goalZoom = 1.75; ui.current.focusOn = true;
          const [w, h] = S.getSize(); if (w < 720) { // on a phone the choice sits at the bottom: keep the people in the top part of the screen
            const k = (0.24 * h * ((cam.top - cam.bottom) / view.goalZoom / h)) / Math.sin(Math.atan2(26, Math.hypot(24, 24))) * Math.SQRT1_2; view.goalX += k; view.goalZ += k; }
        } else { view.goalX = view.userX; view.goalZ = view.userZ; view.goalZoom = view.userZoom; ui.current.focusOn = false; }
        const k = 1 - Math.exp(-dt * 3.2);
        view.tx += (view.goalX - view.tx) * k; view.tz += (view.goalZ - view.tz) * k; view.zoom += (view.goalZoom - view.zoom) * k;
        cam.position.set(view.tx + DIR.x, DIR.y, view.tz + DIR.z); cam.lookAt(view.tx, 0.6, view.tz); cam.zoom = view.zoom; cam.updateProjectionMatrix();
      };
      // Input: tap to pick, drag to look around, wheel or pinch to zoom
      const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
      const pick = (cx: number, cy: number) => {
        const r = S.renderer.domElement.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
        const targets: any[] = []; for (const d of spotDiscs.values()) if (d.visible) targets.push(d.userData.hit); for (const rec of groups.values()) targets.push(rec.hit);
        const hit = ray.intersectObjects(targets, false)[0]; return hit?.object.userData || null;
      };
      const pointers = new Map<number, { x: number; y: number }>(); let drag = { x: 0, y: 0, moved: 0, pinch: 0 };
      const canvas = S.renderer.domElement;
      const worldPerPx = () => (cam.top - cam.bottom) / cam.zoom / S.getSize()[1];
      const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX, y: e.clientY, moved: 0, pinch: pointers.size === 2 ? dist() : 0 }; };
      const dist = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
      const move = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) { const d = dist(); if (drag.pinch) { view.userZoom = Math.max(0.8, Math.min(3, view.userZoom * (d / drag.pinch))); } drag.pinch = d; drag.moved += 10; return; }
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
        if (drag.moved > 6 && !ui.current.focusOn) {
          const k = worldPerPx(), sinE = Math.sin(Math.atan2(26, Math.hypot(24, 24))), r2 = Math.SQRT1_2;
          view.userX += -dx * k * r2 - (dy * k * r2) / sinE; view.userZ += dx * k * r2 - (dy * k * r2) / sinE;
          view.userX = Math.max(2, Math.min(28, view.userX)); view.userZ = Math.max(1, Math.min(17, view.userZ));
        }
      };
      const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (drag.moved <= 6 && pointers.size === 0) onTap(pick(e.clientX, e.clientY)); };
      const wheel = (e: WheelEvent) => { e.preventDefault(); if (ui.current.focusOn) return; view.userZoom = Math.max(0.8, Math.min(3, view.userZoom * (e.deltaY > 0 ? 0.9 : 1.1))); };
      canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false });
      const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (w && h) { S.setSize(w, h); fit(); setSize({ w, h }); } }); ro.observe(el);
      eng.current = { S, cam, groups, spotDiscs, project: (x: number, y: number, z: number): Pt => { const v = new THREE.Vector3(x, y, z).project(cam); const [w, h] = S.getSize(); return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, on: v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1 }; }, anchorOf,
        reset: () => { for (const rec of groups.values()) scene.remove(rec.g, rec.ring, rec.arc, rec.hit, rec.sel); groups.clear(); view.userX = 14.8; view.userZ = 9; view.userZoom = 1; },
        dispose: () => { ro.disconnect(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); S.renderer.dispose(); canvas.remove(); } };
      let last = performance.now(), n = 0;
      const loop = (now: number) => {
        if (!alive) return; const dt = Math.min(0.5, (now - last) / 1000); last = now;
        if (ui.current.started && !ui.current.paused) G.advance(sim.current, (dt * ui.current.speed * TEST_SPEED) / GAME_MIN_SEC);
        sync(now / 1000); placeCam(dt); S.renderer.render(scene, cam);
        setFrame((f) => (f + 1) % 1e6); n++;
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop); setReady(true);
      if (TEST_SPEED > 1) (window as any).__practice = { sim: () => sim.current, G, tapSpot: (id: string) => onTap({ spotId: id }) };
    })();
    return () => { alive = false; cancelAnimationFrame(raf); eng.current?.dispose?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Taps ────────────────────────────────────────────────────────────
  const onTapRef = useRef<(h: any) => void>(() => {});
  function onTap(h: any) { onTapRef.current(h); }
  onTapRef.current = (h: any) => {
    const st = sim.current; const m = ui.current.mode;
    if (!ui.current.started || st.ended) return;
    if (h?.spotId) {
      const who = m?.kind === 'move' ? m.personId : st.prompts.find((q) => q.to === h.spotId)?.personId;
      if (!who) return;
      const r = G.moveTo(st, who, h.spotId);
      if (!r.ok) flash(r.error || 'They can’t go there.'); else { setMode(null); setSel(null); }
      return;
    }
    if (h?.personId) {
      if (m?.kind === 'serve') { const p = st.people[h.personId]; if (p?.role === 'staff') { const r = G.serve(st, h.personId, m.clientId); if (!r.ok) flash(r.error || ''); else { setMode(null); setSel(null); } } return; }
      setSel(h.personId); setMode(null); return;
    }
    setSel(null); setMode(null);
  };

  const act = (pid: string, a: string) => {
    const st = sim.current; const p = st.people[pid];
    if (a === 'move') { setMode({ kind: 'move', personId: pid }); setSel(null); return; }
    if (a === 'serve') { setMode({ kind: 'serve', clientId: pid }); return; }
    if (a === 'check_in') { const r = G.checkIn(st, pid); if (!r.ok) flash(r.error || ''); else setSel(null); return; }
    if (a === 'walk_in') { setSel(null); flash('Choose how to help Ben in the card.'); return; }
    if (a === 'cover_desk') { const r = G.moveTo(st, pid, 'desk'); if (!r.ok) flash(r.error || ''); else { setSel(null); flash(`${p.name} is heading to the front desk.`); } }
  };
  const restart = () => { eng.current?.reset(); sim.current = G.newShift(); setSel(null); setMode(null); setStarted(true); setPaused(false); };

  // ── Overlay (all of it stays on the screen) ─────────────────────────────
  const st = sim.current; const E = eng.current; const W = size.w, H = size.h; const narrow = W < 720;
  const P = (id: string) => (E ? E.project(...(Object.values(E.anchorOf(st.people[id])).slice(0, 3) as [number, number, number])) : { x: 0, y: 0, on: false });
  const clients = Object.values(st.people).filter((p) => p.role === 'client');
  const happy = clients.length ? Math.round((clients.reduce((a, c) => a + c.patience, 0) / clients.length) * 100) : 100;
  const onTime = st.onTime.ok + st.onTime.late ? Math.round((st.onTime.ok / (st.onTime.ok + st.onTime.late)) * 100) : 100;
  const team = Object.values(st.people).filter((p) => p.role === 'staff'); const load = Math.round((team.filter((p) => p.state !== 'idle').length / team.length) * 100);
  const decision = st.open[0] || null;
  const selP = sel ? st.people[sel] : null;
  const report = st.ended ? G.report(st) : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#efe8df', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, overflow: 'hidden', userSelect: 'none' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {webglError && <Center><Card w={420}><H2>This device can’t show 3D</H2><Muted>Practice a shift needs a browser with 3D graphics turned on. Please try a recent Chrome, Safari or Edge.</Muted></Card></Center>}

      {/* Top bar */}
      {ready && (
        <div style={{ position: 'absolute', left: 12, right: 12, top: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'rgba(255,255,255,.92)', border: `1px solid ${LINE}`, borderRadius: 18, padding: '10px 14px', boxShadow: '0 10px 30px -20px rgba(22,23,26,.4)', zIndex: 5 }}>
          <b style={{ fontSize: 14 }}>Opal Salon</b>
          <Pill ink>{`Saturday · ${G.clock(st.t)}`}</Pill>
          {!narrow && <Pill>Practice shift · A provider calls out</Pill>}
          <div style={{ flex: 1 }} />
          <Meter name="Happy clients" v={`${happy}%`} pct={happy} c={happy >= 70 ? GREEN : happy >= 45 ? AMBER : RED} />
          {!narrow && <Meter name="On time" v={`${onTime}%`} pct={onTime} c={onTime >= 80 ? GREEN : AMBER} />}
          {!narrow && <Meter name="Team busy" v={`${load}%`} pct={load} c={load > 85 ? RED : INK} />}
          <Meter name="Takings" v={`$${st.takings.toLocaleString()}`} pct={Math.min(100, st.takings / 12)} c={INK} />
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn small ghost onClick={() => setPaused((x) => !x)}>{paused ? 'Play' : 'Pause'}</Btn>
            <Btn small ghost={speed !== 1} onClick={() => setSpeed(1)}>1×</Btn>
            <Btn small ghost={speed !== 2} onClick={() => setSpeed(2)}>2×</Btn>
          </div>
        </div>
      )}

      {/* Names, needs and prompts above people */}
      {ready && started && !st.ended && Object.values(st.people).filter((p) => p.state !== 'gone' && (!narrow || p.id === sel || p.need || G.moodOf(p) !== 'ok' || st.prompts.some((q) => q.personId === p.id) || decision?.who.includes(p.id))).map((p) => {
        const pt = P(p.id); if (!pt.on) return null;
        const prompt = st.prompts.find((q) => q.personId === p.id);
        const need = p.need === 'water' ? 'Wants water' : p.need === 'check_in' ? 'Needs check-in' : p.need === 'walk_in' ? 'Walk-in' : null;
        const mood = G.moodOf(p);
        return (
          <div key={p.id} onClick={() => { setSel(p.id); setMode(null); }} style={{ position: 'absolute', left: pt.x, top: pt.y, transform: 'translate(-50%,-100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', zIndex: sel === p.id ? 4 : 2 }}>
            {prompt && <div onClick={(e) => { e.stopPropagation(); setMode({ kind: 'move', personId: p.id }); setSel(null); }} style={{ background: INK, color: '#fff', borderRadius: 12, padding: '6px 10px', fontSize: 12, fontWeight: 700, maxWidth: 220, textAlign: 'center', animation: 'pulse 1.6s ease-in-out infinite', boxShadow: '0 8px 20px -10px rgba(0,0,0,.5)' }}>{prompt.text}</div>}
            {need && <div style={{ background: '#fdecec', color: RED, border: '1px solid #f3c5c0', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 700 }}>{need}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: p.role === 'staff' ? INK : 'rgba(255,255,255,.95)', color: p.role === 'staff' ? '#fff' : INK, border: `1px solid ${p.role === 'staff' ? INK : LINE}`, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {p.role === 'client' && <span style={{ width: 6, height: 6, borderRadius: 3, background: MOOD_HEX[mood] }} />}{p.name}
            </div>
          </div>
        );
      })}

      {/* What to do while choosing a place */}
      {mode?.kind === 'move' && (
        <Banner>Tap a glowing place for <b>{st.people[mode.personId]?.name}</b>. <Btn small ghost onClick={() => setMode(null)}>Cancel</Btn></Banner>
      )}
      {mode?.kind === 'serve' && (() => {
        const c = st.people[mode.clientId]; const free = G.freeTeam(st, c);
        const pt = P(mode.clientId);
        return <Anchored pt={pt} w={300} h={260} W={W} H={H} narrow={narrow}>
          <H2>Who brings {c.name} her water?</H2>
          {free.length ? free.slice(0, 4).map((s) => (
            <Row key={s.id} onClick={() => { const r = G.serve(st, s.id, c.id); if (!r.ok) flash(r.error || ''); else { setMode(null); setSel(null); } }}>
              <b>{s.name}</b><Muted>{s.job}{s.at === 'desk' ? ' · leaves the desk' : ''} · {Math.round(Math.hypot(s.x - c.x, s.z - c.z) / 4.5)} min away</Muted>
            </Row>)) : <Muted>Everyone is busy. Try again when someone is free.</Muted>}
          <Muted>Or tap a team member in the salon.</Muted>
          <Btn small ghost onClick={() => setMode(null)}>Cancel</Btn>
        </Anchored>;
      })()}

      {/* The person you tapped */}
      {selP && !mode && !decision?.pause && (() => {
        const pt = P(selP.id); const acts = G.actionsFor(st, selP.id);
        const status = selP.state === 'service' ? `In service${selP.provider ? ` with ${st.people[selP.provider]?.name || ''}` : ''}${selP.serviceUntil != null ? ` · done ${G.clock(selP.serviceUntil)}` : ''}`
          : selP.state === 'walking' ? 'On the way' : selP.state === 'busy' ? 'With a client' : selP.state === 'away' ? 'Away from the floor' : selP.role === 'staff' ? 'Free' : selP.bookedAt != null ? `Booked for ${G.clock(selP.bookedAt)}${selP.provider ? ` with ${st.people[selP.provider]?.name || (selP.provider === 'maya' ? 'Maya' : '')}` : ''}` : 'Waiting';
        return <Anchored pt={pt} w={290} h={250} W={W} H={H} narrow={narrow}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><H2>{selP.name}</H2><Pill>{selP.role === 'staff' ? selP.job || 'Team' : 'Client'}</Pill></div>
          <Muted>{status}</Muted>
          {selP.role === 'client' && <div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: MUTED }}><span>Patience</span><span>{Math.round(selP.patience * 100)}%</span></div><Bar pct={selP.patience * 100} c={MOOD_HEX[G.moodOf(selP)]} /></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {acts.map((a) => <Btn key={a.id} ghost={!a.primary} onClick={() => act(selP.id, a.id)}>{a.label}</Btn>)}
            {!acts.length && <Muted>Nothing to do here right now.</Muted>}
          </div>
        </Anchored>;
      })()}

      {/* Decision: next to the people involved; time is paused */}
      {decision && started && (() => {
        const pt = decision.who.length ? P(decision.who[0]) : { x: W / 2, y: H / 2, on: true };
        return <Anchored pt={pt} w={400} h={460} W={W} H={H} narrow={narrow} sheet>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Pill tone="red">{decision.pause ? 'Needs you now' : 'Needs you soon'}</Pill><span style={{ fontSize: 12, color: MUTED }}>{G.clock(decision.at)}{decision.pause ? ' · time paused' : ''}</span></div>
          <div style={{ fontSize: 17, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{decision.title}</div>
          <Muted>{decision.body}</Muted>
          {decision.options.map((o) => (
            <button key={o.id} onClick={() => { G.decide(st, decision.id, o.id); setSel(null); }} style={{ textAlign: 'left', background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5, font: 'inherit', color: INK }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = INK)} onMouseLeave={(e) => (e.currentTarget.style.borderColor = LINE)}>
              <b style={{ fontSize: 13.5 }}>{o.label}</b><span style={{ fontSize: 12.3, color: MUTED, lineHeight: 1.4 }}>{o.what}</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{o.tags.map(([t, tone]) => <Pill key={t} tone={tone === 'green' ? 'green' : tone === 'amber' ? 'amber' : 'red'}>{t}</Pill>)}</span>
            </button>
          ))}
        </Anchored>;
      })()}

      {/* What just happened, and the texts that went out */}
      {ready && started && !st.ended && (
        <div style={{ position: 'absolute', left: 12, bottom: 12, width: narrow ? 'calc(100% - 24px)' : 360, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 3, pointerEvents: 'none' }}>
          {st.log.slice(-3).map((l, i) => <div key={i} style={{ background: 'rgba(255,255,255,.93)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '7px 11px', fontSize: 12.3, color: l.tone === 'bad' ? RED : l.tone === 'warn' ? AMBER : INK }}><span style={{ color: MUTED, marginRight: 6 }}>{G.clock(l.t)}</span>{l.text}</div>)}
          <div style={{ pointerEvents: 'auto' }}><Btn small ghost onClick={() => setShowTexts((x) => !x)}>{showTexts ? 'Hide texts' : `Texts sent (${st.texts.length})`}</Btn></div>
        </div>
      )}
      {showTexts && (
        <div style={{ position: 'absolute', left: 12, bottom: narrow ? 150 : 140, width: narrow ? 'calc(100% - 24px)' : 380, maxHeight: '40vh', overflow: 'auto', zIndex: 6 }}>
          <Card w={narrow ? undefined : 380}>
            <H2>Texts sent</H2><Muted>The same wording the app sends. In practice, nothing is really sent.</Muted>
            {st.texts.length ? st.texts.slice().reverse().map((t, i) => <div key={i} style={{ background: SOFT, borderRadius: 12, padding: '8px 10px', fontSize: 12.5 }}><b>{t.to}</b> <span style={{ color: MUTED }}>· {G.clock(t.t)}</span><div style={{ marginTop: 3, lineHeight: 1.45 }}>Opal Salon: {t.body}</div></div>) : <Muted>None yet.</Muted>}
          </Card>
        </div>
      )}
      {toast && <div style={{ position: 'absolute', left: '50%', top: narrow ? 120 : 84, transform: 'translateX(-50%)', background: INK, color: '#fff', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, zIndex: 9, maxWidth: '90vw', textAlign: 'center' }}>{toast}</div>}

      {/* Start */}
      {ready && !started && (
        <Center><Card w={520}>
          <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>PRACTICE A SHIFT</div>
          <div style={{ fontSize: 26, letterSpacing: '-0.02em' }}>Saturday morning at Opal Salon</div>
          <Muted>It’s 10:30 and the salon is full. Keep clients happy, keep the team on time, and handle what comes up. Everything runs on ClarityFlow’s own rules; nothing real is sent or charged.</Muted>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: 8 }}>
            {[['Tap a person', 'See what they need and what you can do.'], ['Tap a glowing place', 'Send them there. They walk the aisles.'], ['Rings show patience', 'Green is fine, amber is waiting, red needs you now.'], ['Big moments pause time', 'The choice appears next to the people involved.']].map(([a, b]) =>
              <div key={a} style={{ background: SOFT, borderRadius: 12, padding: '9px 11px' }}><b style={{ fontSize: 13 }}>{a}</b><div style={{ fontSize: 12.3, color: MUTED, marginTop: 2 }}>{b}</div></div>)}
          </div>
          <Muted>Drag to look around. Scroll or pinch to zoom.</Muted>
          <Btn onClick={() => setStarted(true)}>Start the shift</Btn>
        </Card></Center>
      )}

      {/* End-of-shift report */}
      {report && (
        <Center><Card w={560}>
          <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>END OF SHIFT · 12:00 PM</div>
          <div style={{ fontSize: 24, letterSpacing: '-0.02em' }}>{report.stars >= 3 ? 'A great Saturday.' : report.stars === 2 ? 'A good Saturday.' : 'A tough Saturday.'} <b>{report.stars} {report.stars === 1 ? 'star' : 'stars'}</b></div>
          <Score n="Clients happy" v={`${report.happy}%`} tone={report.happy >= 75 ? 'green' : 'amber'} note={report.unhappy.length ? `Left unhappy: ${report.unhappy.join(', ')}.` : 'Nobody left unhappy.'} />
          <Score n="On time" v={`${report.onTime}%`} tone={report.onTime >= 80 ? 'green' : 'amber'} note="Services that started within 10 minutes of the booked time." />
          <Score n="Takings" v={`$${report.takings.toLocaleString()}`} tone="soft" note="Services finished before noon." />
          <Score n="Fair to the team" v={report.fair} tone={report.fair === 'Good' ? 'green' : 'amber'} note={report.fair === 'Good' ? 'Nobody was double-booked.' : 'Tia was double-booked this afternoon.'} />
          <Score n="Policy, kindly" v={report.policy} tone={report.policy === 'Needs work' ? 'amber' : 'green'} note="Courtesies and choices used the way the app would." />
          {report.coach.length > 0 && <><div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>What happened</div>
            {report.coach.map((c, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.5, display: 'flex', gap: 8 }}><span style={{ color: MUTED }}>•</span><span>{c}</span></div>)}</>}
          <div style={{ display: 'flex', gap: 8 }}><Btn onClick={restart}>Play again</Btn></div>
        </Card></Center>
      )}
      <style>{`@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}`}</style>
    </div>
  );
}

/** Can this person be sent to that place? (Mirrors G.moveTo's checks without changing anything.) */
function validTarget(s: G.State, p: G.Person, sp: G.Spot) {
  if (p.state === 'gone' || p.state === 'service') return false;
  if (sp.role !== p.role && !(p.role === 'staff' && sp.kind === 'lounge')) return false;
  if (p.look.wheelchair && sp.pose !== 'stand' && !sp.accessible && !['hair', 'barber', 'desk', 'door'].includes(sp.kind)) return false;
  if (sp.kind === 'door' || sp.kind === 'office' && p.role === 'client') return false;
  return !Object.values(s.people).some((o) => o.id !== p.id && (o.at === sp.id || o.to === sp.id) && o.state !== 'gone');
}

// ── Small pieces in the app's style ───────────────────────────────────────
function Anchored({ pt, w, h, W, H, narrow, sheet, children }: { pt: Pt; w: number; h: number; W: number; H: number; narrow: boolean; sheet?: boolean; children: ReactNode }) {
  if (narrow) return (
    <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, maxHeight: sheet ? '58vh' : '45vh', overflow: 'auto', zIndex: 8 }}>
      <Card>{children}</Card>
    </div>);
  // Beside the person: to the right if it fits, otherwise to the left; always inside the screen.
  let left = pt.x + 34; if (left + w > W - 12) left = pt.x - 34 - w; left = Math.max(12, Math.min(W - w - 12, left));
  const maxH = H - 96; const hh = Math.min(h, maxH); let top = pt.y - hh / 2; top = Math.max(84, Math.min(H - hh - 12, top));
  return (
    <div style={{ position: 'absolute', left, top, width: w, maxHeight: maxH, overflow: 'auto', zIndex: 8, transition: 'left .15s, top .15s' }}>
      <Card>{children}</Card>
    </div>);
}
function Card({ w, children }: { w?: number; children: ReactNode }) {
  return <div style={{ width: w, maxWidth: '100%', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 24px 60px -30px rgba(22,23,26,.45)' }}>{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(239,232,223,.35)', zIndex: 10, overflow: 'auto' }}>{children}</div>;
}
function Banner({ children }: { children: ReactNode }) {
  return <div style={{ position: 'absolute', left: '50%', top: 84, transform: 'translateX(-50%)', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 8px 6px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, zIndex: 7, boxShadow: '0 10px 30px -18px rgba(22,23,26,.5)', whiteSpace: 'nowrap', maxWidth: '94vw' }}>{children}</div>;
}
function H2({ children }: { children: ReactNode }) { return <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>; }
function Muted({ children }: { children: ReactNode }) { return <div style={{ fontSize: 12.8, color: MUTED, lineHeight: 1.45 }}>{children}</div>; }
function Row({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ textAlign: 'left', background: SOFT, border: 'none', borderRadius: 12, padding: '8px 11px', cursor: 'pointer', font: 'inherit', color: INK, display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</button>;
}
function Btn({ children, onClick, ghost, small }: { children: ReactNode; onClick?: () => void; ghost?: boolean; small?: boolean }) {
  return <button onClick={onClick} style={{ padding: small ? '6px 12px' : '10px 18px', borderRadius: 999, fontSize: small ? 12.5 : 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.2, background: ghost ? '#fff' : INK, color: ghost ? INK : '#fff', border: `1px solid ${ghost ? LINE : INK}` }}>{children}</button>;
}
function Pill({ children, ink, tone }: { children: ReactNode; ink?: boolean; tone?: 'green' | 'amber' | 'red' }) {
  const [bg, fg] = ink ? [INK, '#fff'] : tone === 'green' ? ['#e8f3ec', GREEN] : tone === 'amber' ? ['#fdf1e3', AMBER] : tone === 'red' ? ['#fdecec', RED] : [SOFT, INK];
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}
function Bar({ pct, c }: { pct: number; c: string }) { return <div style={{ height: 6, borderRadius: 3, background: SOFT }}><div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 6, borderRadius: 3, background: c }} /></div>; }
function Meter({ name, v, pct, c }: { name: string; v: string; pct: number; c: string }) {
  return <div style={{ minWidth: 112, display: 'flex', flexDirection: 'column', gap: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}><span style={{ color: MUTED }}>{name}</span><b>{v}</b></div><Bar pct={pct} c={c} /></div>;
}
function Score({ n, v, tone, note }: { n: string; v: string; tone: 'green' | 'amber' | 'soft'; note: string }) {
  return <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><div style={{ fontSize: 13.5 }}>{n}</div><div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{note}</div></div><div><Pill tone={tone === 'soft' ? undefined : tone}>{v}</Pill></div></div>;
}
