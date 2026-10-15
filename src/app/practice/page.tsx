'use client';
// /practice — PRACTICE A SHIFT. You run the front of a full-service salon: check clients in, seat them, take payment,
// suggest aftercare, rebook, and handle what comes up. The floor stays quiet: one small icon over anyone who needs you,
// and a "Needs you" tray. Nothing opens by itself; time pauses while you decide. Rules: lib/practice/sim.
// Nothing here touches real data: no clients, texts or payments.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as G from '@/lib/practice/sim';
import Pos from './Pos';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', GOLD = '#9a6a00', BLUE = '#2563eb';
const MOOD_HEX: Record<G.Mood, string> = { ok: '#2f9e63', warn: '#e0911f', bad: '#d6453a' };
const GAME_MIN_SEC = 1.6;   // one game minute takes 1.6 seconds at 1×
const TEST_SPEED = typeof window !== 'undefined' ? Math.max(1, Math.min(20, Number(new URLSearchParams(window.location.search).get('fast')) || 1)) : 1;   // ?fast=8 for quick checks
const XP_KEY = 'cf_practice_xp', MUTE_KEY = 'cf_practice_mute', REG_KEY = 'cf_practice_regulars';
const store = { get: (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } } };

// ── Our own icons ──────────────────────────────────────────────────────────
const ICONS: Record<string, string> = {
  drink: '<path d="M8 4h8l-1 15a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2L8 4z"/><path d="M8.5 9h7"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  pay: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
  seat: '<path d="M7 11V5h10v6"/><path d="M5 11h14v4H5z"/><path d="M7 15v5M17 15v5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="M9.5 14.5l2 2 3.5-3.5"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 3v3M12 3v3"/>',
};
const Icon = ({ name, color = INK, size = 18, sw = 1.9 }: { name: string; color?: string; size?: number; sw?: number }) =>
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />;
const NEED_ICON: Record<G.NeedKind, string> = { check_in: 'bell', seat: 'seat', pay: 'pay', drink: 'drink', decide: 'alert', break: 'coffee' };

// ── Sound: tiny synthesized cues (no files), with a mute ─────────────────────
function makeSound() {
  let ctx: AudioContext | null = null;
  const tone = (f: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.08) => {
    if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, ctx.currentTime + at); g.gain.linearRampToValueAtTime(vol, ctx.currentTime + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + dur + 0.05);
  };
  return {
    unlock: () => { try { ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)(); ctx.resume?.(); } catch { ctx = null; } },
    play: (k: string) => {
      if (k === 'bell') { tone(1318, 0, 0.5); tone(1760, 0.08, 0.6); }
      else if (k === 'coin') { tone(988, 0, 0.12, 'triangle', 0.07); tone(1319, 0.07, 0.25, 'triangle', 0.07); }
      else if (k === 'chime') { tone(784, 0, 0.3); tone(988, 0.1, 0.3); tone(1175, 0.2, 0.45); }
      else if (k === 'alert') { tone(440, 0, 0.18, 'triangle', 0.06); tone(660, 0.16, 0.25, 'triangle', 0.06); }
      else if (k === 'ping') tone(1046, 0, 0.25, 'sine', 0.05);
      else if (k === 'tap') tone(660, 0, 0.06, 'sine', 0.03);
      else if (k === 'scan') tone(1760, 0, 0.09, 'square', 0.03);
      if (['coin', 'bell'].includes(k)) try { navigator.vibrate?.(12); } catch { /* no vibration */ }
    },
  };
}

type Pt = { x: number; y: number; on: boolean };
type Panel = null | { kind: 'person' | 'check_in' | 'pay' | 'drink' | 'decide'; pid: string; decision?: string };

export default function PracticePage() {
  const host = useRef<HTMLDivElement>(null);
  const sim = useRef<G.State>(G.newShift('opening'));
  const eng = useRef<any>(null);
  const sound = useRef(makeSound());
  const popSeen = useRef(new Map<number, number>());
  const ui = useRef({ started: false, paused: false, speed: 1, panel: null as Panel, moving: null as string | null, drag: null as null | { pid: string; x: number; y: number }, focus: null as string | null, muted: false });
  const [, setFrame] = useState(0);
  const [screen, setScreen] = useState<'menu' | 'play' | 'report'>('menu');
  const [shift, setShift] = useState<G.ShiftId>('opening');
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [panel, setPanelState] = useState<Panel>(null);
  const [moving, setMovingState] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [showTexts, setShowTexts] = useState(false);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [ready, setReady] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [totalXp, setTotalXp] = useState(0);
  const [muted, setMuted] = useState(false);
  const [coachDone, setCoachDone] = useState(false);
  const saved = useRef(false);
  ui.current.started = screen === 'play'; ui.current.paused = paused; ui.current.speed = speed; ui.current.muted = muted;

  useEffect(() => { setTotalXp(Number(store.get(XP_KEY)) || 0); setMuted(store.get(MUTE_KEY) === '1'); }, []);
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2800); }, []);
  const setPanel = (p: Panel) => { ui.current.panel = p; setPanelState(p); const st = sim.current; st.hold = p?.kind === 'decide' || p?.kind === 'pay'; ui.current.focus = p ? p.pid : null; };
  const setMoving = (pid: string | null) => { ui.current.moving = pid; setMovingState(pid); };

  // ── The 3D salon ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true, raf = 0;
    (async () => {
      const el = host.current; if (!el) return;
      let S: any; try { const { createSalon } = await import('@/lib/practice/scene'); S = createSalon(el); } catch { setWebglError(true); return; }
      if (!alive) { S.renderer.dispose(); return; }
      const THREE = S.THREE; const scene = S.scene;
      const [w0, h0] = S.getSize(); setSize({ w: w0, h: h0 });
      const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 200);
      const DIR = new THREE.Vector3(24, 26, 24).normalize().multiplyScalar(70);
      const SIN_E = Math.sin(Math.atan2(26, Math.hypot(24, 24)));
      const view = { tx: 14.8, tz: 9.4, zoom: 1, userX: 14.8, userZ: 9.4, userZoom: 1 };
      const fit = () => { const [w, h] = S.getSize(); const a = w / h; const s = Math.max(10.6, 20.5 / a); cam.left = -s * a; cam.right = s * a; cam.top = s; cam.bottom = -s; cam.updateProjectionMatrix(); };
      fit();
      { const [w, h] = S.getSize(); if (w / h < 0.8) { view.userZoom = 2.4; view.zoom = 2.4; view.userX = 14.5; view.userZ = 9.6; view.tx = 14.5; view.tz = 9.6; } }
      const groups = new Map<string, any>();
      const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const ringGeo = new THREE.RingGeometry(0.4, 0.5, 48), selGeo = new THREE.CircleGeometry(0.62, 40);
      const spotDiscs = new Map<string, any>();
      const discGeo = new THREE.RingGeometry(0.44, 0.56, 40), discFill = new THREE.CircleGeometry(0.44, 32);
      for (const sp of Object.values(sim.current.spots)) {
        if (sp.kind === 'street') continue;
        const m = new THREE.Group(); m.position.set(sp.x, 0.03, sp.z); m.visible = false;
        const r = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.85 })); r.rotation.x = -Math.PI / 2;
        const f = new THREE.Mesh(discFill, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 })); f.rotation.x = -Math.PI / 2;
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 16), hitMat); hit.position.y = 0.8; hit.userData.spotId = sp.id;
        m.add(r, f, hit); m.userData = { spotId: sp.id, ring: r, fill: f, hit }; scene.add(m); spotDiscs.set(sp.id, m);
      }
      const look = (p: G.Person, sp: G.Spot | null, walking: boolean) => {
        const pose = p.look.wheelchair ? 'chair' : walking || !sp ? 'stand' : sp.pose;
        return { ...p.look, staff: p.role === 'staff', pose, seat: p.look.wheelchair ? 0.6 : sp?.seat ?? 0.7, tilt: sp?.tilt, ry: sp?.ry ?? 0 };
      };
      const anchorOf = (p: G.Person) => {
        const sp = p.at ? sim.current.spots[p.at] : null; const walking = p.path.length > 0 || !sp;
        if (walking || !sp) return { x: p.x, y: 2.15, z: p.z, rx: p.x, rz: p.z };
        const s = Math.sin(sp.ry), c = Math.cos(sp.ry);
        if (sp.pose === 'lie') return { x: sp.x - s * 0.9, y: sp.seat + 0.95, z: sp.z - c * 0.9, rx: sp.x + s * 0.5, rz: sp.z + c * 0.5 };
        if (sp.pose === 'sit') return { x: sp.x, y: sp.seat + 1.5, z: sp.z, rx: sp.x + s * 1.05, rz: sp.z + c * 1.05 };
        return { x: sp.x, y: p.look.wheelchair ? 1.95 : 2.15, z: sp.z, rx: sp.x, rz: sp.z };
      };
      const sync = (time: number) => {
        const st = sim.current;
        for (const [id, rec] of groups) if (!st.people[id]) { scene.remove(rec.g, rec.ring, rec.arc, rec.hit, rec.sel); groups.delete(id); }
        for (const p of Object.values(st.people)) {
          let rec = groups.get(p.id);
          if (p.state === 'gone') { if (rec) { scene.remove(rec.g, rec.ring, rec.arc, rec.hit, rec.sel); groups.delete(p.id); } continue; }
          const sp = p.at ? st.spots[p.at] : null; const walking = p.path.length > 0 || !p.at;
          const key = walking ? 'walk' : p.at;
          if (!rec || rec.key !== key) {
            if (rec) scene.remove(rec.g);
            const g = S.person(walking || !sp ? p.x : sp.x, walking || !sp ? p.z : sp.z, look(p, sp, walking)); S.fixEnv(g);
            if (!rec) {
              const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false })); ring.rotation.x = -Math.PI / 2;
              const arc = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: MOOD_HEX.ok, transparent: true, opacity: 0.9, depthWrite: false })); arc.rotation.x = -Math.PI / 2;
              const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.1, 12), hitMat); hit.userData.personId = p.id;
              const selM = new THREE.Mesh(selGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })); selM.rotation.x = -Math.PI / 2;
              scene.add(ring, arc, hit, selM); rec = { g, key, ring, arc, arcP: -1, hit, sel: selM }; groups.set(p.id, rec);
            } else { rec.g = g; rec.key = key; }
          }
          const g = rec.g; const a = anchorOf(p);
          if (walking) {
            g.position.x = p.x; g.position.z = p.z; const n = p.path[0];
            if (n) g.rotation.y = Math.atan2(n.x - p.x, n.z - p.z);
            (g.userData.legs || []).forEach((l: any, i: number) => { l.rotation.x = Math.sin(time * 9 + i * Math.PI) * 0.45; });
            g.position.y = p.look.wheelchair ? 0 : Math.abs(Math.sin(time * 9)) * 0.03;
          }
          const showRing = p.role === 'client' && !walking;
          rec.ring.visible = showRing; rec.arc.visible = showRing;
          rec.ring.position.set(a.rx, 0.015, a.rz); rec.arc.position.set(a.rx, 0.02, a.rz);
          if (showRing) {
            const pp = Math.round(Math.max(0.02, p.patience) * 50) / 50;
            if (pp !== rec.arcP) { rec.arc.geometry = new THREE.RingGeometry(0.4, 0.5, 48, 1, Math.PI / 2, Math.PI * 2 * pp); rec.arcP = pp; }
            rec.arc.material.color.set(MOOD_HEX[G.moodOf(p)]);
          }
          rec.hit.position.set(a.x, 1.0, a.z);
          const isSel = ui.current.panel?.pid === p.id || ui.current.moving === p.id || ui.current.drag?.pid === p.id;
          rec.sel.position.set(a.rx, 0.012, a.rz); rec.sel.material.opacity = isSel ? 0.55 + Math.sin(time * 5) * 0.2 : 0;
        }
        // Places someone can go: shown while moving or dragging them, and the suggested place for a "seat" need
        const mv = ui.current.drag?.pid || ui.current.moving; const who = mv ? st.people[mv] : null;
        const suggested = who?.need?.kind === 'seat' ? who.need.to : null;
        for (const [id, d] of spotDiscs) {
          const sp = st.spots[id]; const on = !!who && G.canGo(st, who, sp) == null;
          d.visible = on;
          if (on) { const k = 1 + Math.sin(time * 4) * 0.07; d.userData.ring.scale.set(k, k, k); d.userData.ring.material.color.set(id === suggested ? GREEN : INK); d.userData.ring.material.opacity = id === suggested ? 0.95 : 0.45; }
        }
      };
      const placeCam = (dt: number) => {
        const f = ui.current.focus ? sim.current.people[ui.current.focus] : null;
        let gx = view.userX, gz = view.userZ, gzoom = view.userZoom;
        if (f && f.state !== 'gone') {
          gx = f.x; gz = f.z; gzoom = Math.max(view.userZoom, 1.55);
          const [w, h] = S.getSize(); if (w < 720) { const k = (0.22 * h * ((cam.top - cam.bottom) / gzoom / h)) / SIN_E * Math.SQRT1_2; gx += k; gz += k; }
        }
        const k = 1 - Math.exp(-dt * 3.2);
        view.tx += (gx - view.tx) * k; view.tz += (gz - view.tz) * k; view.zoom += (gzoom - view.zoom) * k;
        if (Math.abs(gx - view.tx) < 0.002) view.tx = gx; if (Math.abs(gz - view.tz) < 0.002) view.tz = gz; if (Math.abs(gzoom - view.zoom) < 0.001) view.zoom = gzoom;
        cam.position.set(view.tx + DIR.x, DIR.y, view.tz + DIR.z); cam.lookAt(view.tx, 0.6, view.tz); cam.zoom = view.zoom; cam.updateProjectionMatrix();
      };
      // Input: tap to pick, drag a person to move them, drag the floor to look around, wheel or pinch to zoom
      const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
      const pick = (cx: number, cy: number, onlySpots = false) => {
        const r = S.renderer.domElement.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
        const targets: any[] = []; for (const d of spotDiscs.values()) if (d.visible) targets.push(d.userData.hit); if (!onlySpots) for (const rec of groups.values()) targets.push(rec.hit);
        const hits = ray.intersectObjects(targets, false); const spot = hits.find((h: any) => h.object.userData.spotId); const person = hits.find((h: any) => h.object.userData.personId);
        return onlySpots ? spot?.object.userData || null : (person || spot)?.object.userData || null;
      };
      const pointers = new Map<number, { x: number; y: number }>(); let drag = { x: 0, y: 0, moved: 0, pinch: 0, pid: null as string | null };
      const canvas = S.renderer.domElement;
      const worldPerPx = () => (cam.top - cam.bottom) / cam.zoom / S.getSize()[1];
      const dist = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
      const down = (e: PointerEvent) => {
        sound.current.unlock(); canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const h = pointers.size === 1 ? pick(e.clientX, e.clientY) : null;
        const p = h?.personId ? sim.current.people[h.personId] : null;
        drag = { x: e.clientX, y: e.clientY, moved: 0, pinch: pointers.size === 2 ? dist() : 0, pid: p && p.state !== 'service' && p.state !== 'walking' && p.state !== 'gone' ? p.id : null };
      };
      const move = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) { const d = dist(); if (drag.pinch) view.userZoom = Math.max(0.8, Math.min(4, view.userZoom * (d / drag.pinch))); drag.pinch = d; drag.moved += 10; drag.pid = null; ui.current.drag = null; return; }
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
        if (drag.moved > 8 && drag.pid) { const r = canvas.getBoundingClientRect(); ui.current.drag = { pid: drag.pid, x: e.clientX - r.left, y: e.clientY - r.top }; return; }
        if (drag.moved > 6 && !ui.current.focus) {
          const k = worldPerPx(), r2 = Math.SQRT1_2;
          view.userX += -dx * k * r2 - (dy * k * r2) / SIN_E; view.userZ += dx * k * r2 - (dy * k * r2) / SIN_E;
          view.userX = Math.max(2, Math.min(28, view.userX)); view.userZ = Math.max(1, Math.min(17, view.userZ));
        }
      };
      const up = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (ui.current.drag) { const d = ui.current.drag; ui.current.drag = null; const h = pick(e.clientX, e.clientY, true); if (h?.spotId) onTap({ spotId: h.spotId, dragPid: d.pid }); return; }
        if (drag.moved <= 8 && pointers.size === 0) onTap(pick(e.clientX, e.clientY));
      };
      const wheel = (e: WheelEvent) => { e.preventDefault(); view.userZoom = Math.max(0.8, Math.min(3, view.userZoom * (e.deltaY > 0 ? 0.9 : 1.1))); };
      canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false });
      const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (w && h) { S.setSize(w, h); fit(); setSize({ w, h }); } }); ro.observe(el);
      eng.current = { S, project: (x: number, y: number, z: number): Pt => { const v = new THREE.Vector3(x, y, z).project(cam); const [w, h] = S.getSize(); return { x: Math.round((v.x * 0.5 + 0.5) * w), y: Math.round((-v.y * 0.5 + 0.5) * h), on: v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1 }; }, anchorOf,
        reset: () => { for (const rec of groups.values()) scene.remove(rec.g, rec.ring, rec.arc, rec.hit, rec.sel); groups.clear(); const [w, h] = S.getSize(); const phone = w / h < 0.8; view.userX = phone ? 14.5 : 14.8; view.userZ = phone ? 9.6 : 9.4; view.userZoom = phone ? 2.4 : 1; },
        dispose: () => { ro.disconnect(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); S.renderer.dispose(); canvas.remove(); } };
      let last = performance.now();
      const loop = (now: number) => {
        if (!alive) return; const dt = Math.min(0.5, (now - last) / 1000); last = now; const st = sim.current;
        if (ui.current.started && !ui.current.paused) G.advance(st, (dt * ui.current.speed * TEST_SPEED) / GAME_MIN_SEC);
        while (st.sfx.length) { const k = st.sfx.shift()!; if (!ui.current.muted && ui.current.started) sound.current.play(k); }
        sync(now / 1000); placeCam(dt); S.renderer.render(scene, cam);
        setFrame((f) => (f + 1) % 1e6);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop); setReady(true);
      if (TEST_SPEED > 1) (window as any).__practice = { sim: () => sim.current, G, tap: (h: any) => onTap(h) };
    })();
    return () => { alive = false; cancelAnimationFrame(raf); eng.current?.dispose?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Taps ────────────────────────────────────────────────────────────
  const onTapRef = useRef<(h: any) => void>(() => {});
  function onTap(h: any) { onTapRef.current(h); }
  onTapRef.current = (h: any) => {
    const st = sim.current; if (!ui.current.started || st.ended) return;
    if (h?.spotId) {
      const who = h.dragPid || ui.current.moving; if (!who) return;
      const r = G.moveTo(st, who, h.spotId); if (!r.ok) flash(r.error || 'They can’t go there.'); else { setMoving(null); setPanel(null); sound.current.play('tap'); }
      return;
    }
    if (h?.personId) { open(h.personId); return; }
    setMoving(null); setPanel(null);
  };
  /** Open whatever this person needs (or their card). */
  const open = (pid: string) => {
    const st = sim.current; const p = st.people[pid]; if (!p) return;
    if (ui.current.panel?.kind === 'drink' && p.role === 'staff') { const c = ui.current.panel.pid; const r = G.serve(st, pid, c); if (!r.ok) flash(r.error || ''); else setPanel(null); return; }
    const dec = Object.values(st.decisions).find((d) => d.who[0] === pid);
    if (dec) { setPanel({ kind: 'decide', pid, decision: dec.id }); setMoving(null); return; }
    const n = p.need;
    if (n?.kind === 'seat') { setMoving(pid); setPanel(null); return; }
    setMoving(null);
    setPanel({ kind: n?.kind === 'check_in' ? 'check_in' : n?.kind === 'pay' ? 'pay' : n?.kind === 'drink' ? 'drink' : 'person', pid });
  };

  const start = (id: G.ShiftId) => { sound.current.unlock(); eng.current?.reset(); let regs: string[] = []; try { regs = JSON.parse(store.get(REG_KEY) || '[]'); } catch { regs = []; } sim.current = G.newShift(id, { regulars: regs }); popSeen.current.clear(); saved.current = false; setShift(id); setPanel(null); setMoving(null); setPaused(false); setCoachDone(id !== 'opening'); setScreen('play'); };

  // Save XP at the end of a shift
  const st = sim.current;
  useEffect(() => {
    if (st.ended && screen === 'play' && !saved.current) { saved.current = true; const tot = (Number(store.get(XP_KEY)) || 0) + st.xp; store.set(XP_KEY, String(tot)); store.set(REG_KEY, JSON.stringify((st.flags.rebookedIds || []).slice(0, 8))); setTotalXp(tot); setPanel(null); setMoving(null); window.setTimeout(() => setScreen('report'), 900); }
  });

  // ── Overlay ────────────────────────────────────────────────────────────
  const E = eng.current; const W = size.w, H = size.h; const narrow = W < 720;
  const P = (id: string): Pt => { const p = st.people[id]; if (!E || !p) return { x: 0, y: 0, on: false }; const a = E.anchorOf(p); return E.project(a.x, a.y, a.z); };
  const needList = G.needs(st);
  const iconFor = new Map<string, (typeof needList)[0]>(); for (const n of needList) if (!iconFor.has(n.pid)) iconFor.set(n.pid, n);
  const lvl = G.levelOf(totalXp + (screen === 'play' ? st.xp : 0));
  const coachText = screen === 'play' && st.shift === 'opening' && !coachDone ? coachLine(st) : null;
  const coachTarget = coachText?.pid || null;
  const now = performance.now();

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#efe8df', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK, overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {webglError && <Center><Card w={420}><H2>This device can’t show 3D</H2><Muted>Practice a shift needs a browser with 3D graphics turned on. Please try a recent Chrome, Safari or Edge.</Muted></Card></Center>}

      {ready && screen === 'play' && (
        <div style={{ position: 'absolute', left: 10, right: 10, top: 10, display: 'flex', gap: narrow ? 8 : 14, alignItems: 'center', flexWrap: 'wrap', background: 'rgba(255,255,255,.95)', border: `1px solid ${LINE}`, borderRadius: 18, padding: narrow ? '8px 10px' : '9px 14px', boxShadow: '0 10px 30px -20px rgba(22,23,26,.4)', zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 32, height: 32, borderRadius: 16, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{lvl.n}</span>
            {!narrow && <div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{lvl.name}</div><Bar pct={lvl.pct * 100} c={BLUE} w={100} /></div>}
          </div>
          <Pill ink>{G.clock(st)}</Pill>
          {!narrow && <span style={{ fontSize: 12.5, color: MUTED }}>{st.title}</span>}
          <div style={{ flex: 1 }} />
          {st.goals.map((g) => { const v = G.goalValue(st, g); const pct = g.id === 'rebooked' || g.id === 'takings' ? (v / g.target) * 100 : v; const met = v >= g.target;
            if (narrow && (g.id === 'onTime' || g.id === 'rebooked')) return null;
            return <Goal key={g.id} icon={g.id === 'takings' ? 'pay' : g.id === 'onTime' ? 'clock' : g.id === 'happy' ? 'heart' : 'cal'} label={g.label} value={g.id === 'takings' ? `$${v}` : g.id === 'rebooked' ? `${v} of ${g.target}` : `${v}%`} pct={pct} met={met} narrow={narrow} />; })}
          <div style={{ display: 'flex', gap: 5 }}>
            <IconBtn onClick={() => { const m = !muted; setMuted(m); store.set(MUTE_KEY, m ? '1' : '0'); }} icon={muted ? 'mute' : 'sound'} label={muted ? 'Sound off' : 'Sound on'} />
            <Btn small ghost onClick={() => setPaused((x) => !x)}>{paused ? 'Play' : 'Pause'}</Btn>
            {!narrow && <><Btn small ghost={speed !== 1} onClick={() => setSpeed(1)}>1×</Btn><Btn small ghost={speed !== 2} onClick={() => setSpeed(2)}>2×</Btn></>}
          </div>
        </div>
      )}

      {ready && screen === 'play' && !st.ended && Object.values(st.people).filter((p) => p.state !== 'gone').map((p) => {
        const n = iconFor.get(p.id); const pt = P(p.id); if (!pt.on) return null;
        const selected = panel?.pid === p.id || moving === p.id; const isDrag = ui.current.drag?.pid === p.id;
        if (!n && !selected && !isDrag) return null;
        const tone = !n ? 'none' : n.kind === 'decide' || n.urgent ? 'bad' : n.kind === 'pay' || n.kind === 'seat' ? 'ok' : 'warn';
        const dim = coachTarget && coachTarget !== p.id;
        return (
          <div key={p.id} onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); sound.current.unlock(); open(p.id); }}
            style={{ position: 'absolute', left: pt.x, top: pt.y, transform: 'translate(-50%,-100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', zIndex: selected ? 4 : 2, opacity: dim ? 0.35 : 1, transition: 'opacity .3s' }}>
            {n && <NeedBubble kind={n.kind} tone={tone as any} patience={p.role === 'client' ? p.patience : 1} pulse={n.kind === 'pay' || n.kind === 'check_in' || coachTarget === p.id} big={coachTarget === p.id} />}
            {(selected || isDrag || coachTarget === p.id) && <span style={{ background: p.role === 'staff' ? INK : '#fff', color: p.role === 'staff' ? '#fff' : INK, border: `1px solid ${p.role === 'staff' ? INK : LINE}`, borderRadius: 999, padding: '2px 8px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.name}</span>}
          </div>
        );
      })}

      {ready && screen === 'play' && !st.ended && needList.slice(0, 6).map((n) => {
        const pt = P(n.pid); if (pt.on || !st.people[n.pid]) return null;
        const cx = W / 2, cy = H / 2; const dx = pt.x - cx, dy = pt.y - cy; const k = Math.min((W / 2 - 40) / Math.abs(dx || 1), (H / 2 - 90) / Math.abs(dy || 1));
        const x = cx + dx * k, y = Math.max(80, cy + dy * k); const ang = Math.atan2(dy, dx);
        return <button key={'edge' + n.pid} onClick={() => open(n.pid)} style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)', display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 10px 4px 5px', zIndex: 3, cursor: 'pointer', boxShadow: '0 8px 18px -10px rgba(0,0,0,.4)', fontFamily: 'inherit' }}>
          <span style={{ width: 24, height: 24, borderRadius: 12, background: n.urgent ? '#fdecec' : SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={NEED_ICON[n.kind]} color={n.urgent ? RED : INK} size={14} /></span>
          <span style={{ fontSize: 12, fontWeight: 700, color: INK }}><span style={{ display: 'inline-block', transform: `rotate(${ang}rad)` }}>➜</span> {st.people[n.pid].name}</span>
        </button>;
      })}

      {ready && screen === 'play' && !st.ended && Object.values(st.people).filter((p) => p.task?.kind === 'brew' || p.task?.kind === 'break').map((p) => { const pt = P(p.id); if (!pt.on || !p.task) return null; const pct = Math.min(1, (st.t - p.task.start) / Math.max(0.1, p.task.until - p.task.start));
        return <div key={'task' + p.id} style={{ position: 'absolute', left: pt.x, top: pt.y - 6, transform: 'translate(-50%,-100%)', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, zIndex: 3, boxShadow: '0 8px 18px -10px rgba(0,0,0,.4)' }}><Icon name="coffee" size={14} color={AMBER} /><span style={{ width: 46, height: 5, borderRadius: 3, background: SOFT }}><span style={{ display: 'block', width: `${pct * 100}%`, height: 5, borderRadius: 3, background: AMBER }} /></span></div>; })}

      {ready && screen === 'play' && st.pops.map((pp) => {
        const seen = popSeen.current.get(pp.id) ?? (popSeen.current.set(pp.id, now), now); const age = (now - seen) / 1000; if (age > 1.8) return null;
        const p = st.people[pp.pid]; if (!p || !E) return null; const a = E.anchorOf(p); const pt = E.project(a.x, a.y, a.z);
        const c = pp.tone === 'gold' ? [GOLD, '#fff4d6'] : pp.tone === 'xp' ? [BLUE, '#e8efff'] : pp.tone === 'bad' ? [RED, '#fdecec'] : [GREEN, '#eaf6ef'];
        const stackIdx = st.pops.filter((q) => q.pid === pp.pid && q.id < pp.id && (now - (popSeen.current.get(q.id) ?? now)) / 1000 < 1.8).length;
        return <div key={pp.id} style={{ position: 'absolute', left: pt.x, top: pt.y - 40 - age * 36 - stackIdx * 26, transform: 'translate(-50%,-100%)', background: c[1], color: c[0], borderRadius: 999, padding: '4px 11px', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', opacity: Math.min(1, 2.2 - age * 1.2), zIndex: 6, pointerEvents: 'none', boxShadow: '0 8px 18px -10px rgba(0,0,0,.35)' }}>{pp.text}</div>;
      })}

      {ui.current.drag && (() => { const d = ui.current.drag; const pt = P(d.pid); return <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }} width={W} height={H}><line x1={pt.x} y1={pt.y + 40} x2={d.x} y2={d.y} stroke={INK} strokeWidth={2} strokeDasharray="6 6" /><circle cx={d.x} cy={d.y} r={10} fill="#fff" stroke={INK} strokeWidth={2} /></svg>; })()}

      {coachText && <Coach text={coachText.text} narrow={narrow} onSkip={coachText.done ? () => { setCoachDone(true); st.tutorial = 9; } : undefined} skipLabel={coachText.done ? 'Got it' : undefined} />}
      {moving && !coachText && <Banner>Tap or drag <b>{st.people[moving]?.name}</b> to a glowing place. <Btn small ghost onClick={() => setMoving(null)}>Cancel</Btn></Banner>}

      {ready && screen === 'play' && !st.ended && (
        narrow && !trayOpen ? (
          <button onClick={() => setTrayOpen(true)} style={{ position: 'absolute', right: 10, bottom: 10, zIndex: 6, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 14px', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, boxShadow: '0 10px 30px -16px rgba(0,0,0,.5)' }}>
            Needs you {needList.length > 0 && <span style={{ background: RED, color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 12 }}>{needList.length}</span>}
          </button>
        ) : (
          <div style={{ position: 'absolute', right: 10, bottom: 10, width: narrow ? 'calc(100% - 20px)' : 290, maxHeight: narrow ? '45vh' : '46vh', overflow: 'auto', background: 'rgba(255,255,255,.97)', border: `1px solid ${LINE}`, borderRadius: 18, padding: 12, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 6, boxShadow: '0 16px 40px -24px rgba(22,23,26,.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 13 }}>Needs you</b><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{needList.length > 0 && <span style={{ background: RED, color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 11.5, fontWeight: 800 }}>{needList.length}</span>}{narrow && <Btn small ghost onClick={() => setTrayOpen(false)}>Close</Btn>}</span></div>
            {needList.length === 0 && <Muted>All calm. Nice work.</Muted>}
            {needList.slice(0, 8).map((n) => { const p = st.people[n.pid]; const urgent = n.urgent; const tone = n.kind === 'decide' || urgent ? RED : n.kind === 'pay' || n.kind === 'seat' ? GREEN : AMBER;
              return <button key={n.pid + n.kind + (n.decision || '')} onClick={() => { setTrayOpen(false); open(n.pid); }} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '7px 8px', borderRadius: 12, background: SOFT, border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: INK }}>
                <span style={{ width: 30, height: 30, borderRadius: 15, background: '#fff', border: `1.5px solid ${tone}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={NEED_ICON[n.kind]} color={tone} size={16} /></span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{n.kind === 'decide' ? 'Decision' : p?.name}</span><span style={{ display: 'block', fontSize: 11.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span></span>
                <span style={{ fontSize: 11, color: tone, fontWeight: 700 }}>{n.wait < 1 ? 'now' : `${Math.round(n.wait)} min`}</span>
              </button>; })}
          </div>
        )
      )}

      {panel && screen === 'play' && !st.ended && st.people[panel.pid] && (() => {
        const p = st.people[panel.pid]; const pt = P(p.id);
        const close = () => setPanel(null);
        if (panel.kind === 'decide') { const d = panel.decision ? st.decisions[panel.decision] : null; if (!d) return null;
          return <Anchored pt={pt} w={400} h={470} W={W} H={H} narrow={narrow}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Pill tone="red">Needs a decision</Pill><span style={{ fontSize: 12, color: MUTED }}>Time is paused while you decide</span></div>
            <div style={{ fontSize: 17, lineHeight: 1.3 }}>{d.title}</div><Muted>{d.body}</Muted>
            {d.options.map((o) => <button key={o.id} onClick={() => { G.decide(st, d.id, o.id); setPanel(null); sound.current.play('tap'); }} style={choiceStyle}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = INK)} onMouseLeave={(e) => (e.currentTarget.style.borderColor = LINE)}>
              <b style={{ fontSize: 13.5 }}>{o.label}</b><span style={{ fontSize: 12.3, color: MUTED, lineHeight: 1.4 }}>{o.what}</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{o.tags.map(([t, tone]) => <Pill key={t} tone={tone}>{t}</Pill>)}</span></button>)}
            <Btn small ghost onClick={close}>Decide later ({Math.max(0, Math.round(d.deadline - st.t))} min left)</Btn>
          </Anchored>; }
        if (panel.kind === 'check_in') return <Anchored pt={pt} w={300} h={260} W={W} H={H} narrow={narrow}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><H2>{p.name}</H2><Pill>Arrived</Pill></div>
          <Muted>{p.service}{p.bookedAt != null ? ` · ${G.clock(st, p.bookedAt)}` : ''}{p.provider && st.people[p.provider] ? ` with ${st.people[p.provider].name}` : p.provider === 'maya' ? ' with Maya' : ''}</Muted>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{p.trait && <Pill tone={p.trait === 'hurry' ? 'amber' : p.trait === 'regular' ? 'green' : undefined}>{G.TRAITS[p.trait].label}</Pill>}{p.trait === 'first' ? <Pill tone="amber">New: welcome form at the desk</Pill> : <><Pill tone="green">Forms done ✓</Pill><Pill tone="green">Card on file ✓</Pill></>}{p.look.wheelchair && <Pill>Step-free seating</Pill>}</div>
          {p.notes && <Muted>{p.notes}</Muted>}
          {!G.deskStaffed(st) && <Muted><b style={{ color: RED }}>Nobody is at the front desk.</b> Tap a free team member and choose “Cover the front desk”.</Muted>}
          <Btn onClick={() => { const r = G.checkIn(st, p.id); if (!r.ok) flash(r.error || ''); else { setPanel(null); window.setTimeout(() => setMoving(p.id), 250); } }}><Icon name="bell" color="#fff" size={15} /> Check in</Btn>
          <Btn small ghost onClick={close}>Not now</Btn>
        </Anchored>;
        if (panel.kind === 'pay') return <Pos key={p.id} st={st} pid={p.id} narrow={narrow} onClose={close} onDone={(msg) => { setPanel(null); if (msg) flash(msg); }} sfx={(k) => { if (!muted) sound.current.play(k); }} />;
        if (panel.kind === 'drink') { const free = G.freeTeam(st, p); return <Anchored pt={pt} w={300} h={280} W={W} H={H} narrow={narrow}>
          <H2>{p.name} would like {p.need?.item || 'a drink'}</H2>
          {free.length ? free.slice(0, 4).map((s) => <RowBtn key={s.id} onClick={() => { const r = G.serve(st, s.id, p.id); if (!r.ok) flash(r.error || ''); else setPanel(null); }}>
            <b>{s.name}</b><Muted>{s.job}{s.at === 'desk' ? ' · leaves the desk' : ''} · {Math.max(1, Math.round(Math.hypot(s.x - p.x, s.z - p.z) / 4.5))} min away</Muted></RowBtn>) : <Muted>Everyone is busy. Try again when someone is free.</Muted>}
          <Muted>Or tap a team member in the salon.</Muted><Btn small ghost onClick={close}>Not now</Btn>
        </Anchored>; }
        // A person's card
        const status = p.state === 'service' ? `${p.service || 'In service'}${p.provider && st.people[p.provider] ? ` with ${st.people[p.provider].name}` : ''}${p.serviceUntil != null ? ` · done ${G.clock(st, p.serviceUntil)}` : ''}`
          : p.state === 'walking' ? 'On the way' : p.state === 'busy' ? 'With a client' : p.state === 'away' ? 'Away from the floor' : p.role === 'staff' ? 'Free' : p.bookedAt != null ? `Waiting for ${G.clock(st, p.bookedAt)}${p.provider && st.people[p.provider] ? ` with ${st.people[p.provider].name}` : ''}` : 'Waiting';
        return <Anchored pt={pt} w={280} h={240} W={W} H={H} narrow={narrow}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><H2>{p.name}</H2><Pill>{p.role === 'staff' ? p.job || 'Team' : 'Client'}</Pill></div>
          <Muted>{status}</Muted>
          {p.role === 'client' && p.trait && <div title={G.TRAITS[p.trait].tip}><Pill tone={p.trait === 'hurry' ? 'amber' : p.trait === 'regular' ? 'green' : undefined}>{G.TRAITS[p.trait].label}</Pill></div>}
          {p.role === 'client' && p.notes && <Muted>{p.notes}</Muted>}
          {p.role === 'staff' && <div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: MUTED }}><span>Energy</span><span>{Math.round((p.energy ?? 1) * 100)}%</span></div><Bar pct={(p.energy ?? 1) * 100} c={(p.energy ?? 1) > 0.5 ? '#2f9e63' : (p.energy ?? 1) > 0.3 ? '#e0911f' : '#d6453a'} /></div>}
          {p.role === 'staff' && p.task?.kind === 'brew' && <Muted>Making a drink at the bar…</Muted>}
          {p.role === 'staff' && p.state === 'idle' && p.id !== 'zoe' && (p.energy ?? 1) < 0.7 && <Btn onClick={() => { const r = G.takeBreak(st, p.id); if (!r.ok) flash(r.error || ''); else { setPanel(null); flash(`${p.name} is taking a short break.`); } }}><Icon name="coffee" color="#fff" size={15} /> Send on a break (8 min)</Btn>}
          {p.role === 'client' && <div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: MUTED }}><span>Patience</span><span>{Math.round(p.patience * 100)}%</span></div><Bar pct={p.patience * 100} c={MOOD_HEX[G.moodOf(p)]} /></div>}
          {p.state !== 'service' && p.state !== 'walking' && <Btn ghost onClick={() => { setPanel(null); setMoving(p.id); }}>{p.role === 'staff' ? 'Send somewhere…' : 'Seat somewhere…'}</Btn>}
          {p.role === 'staff' && p.state === 'idle' && p.at !== 'desk' && <Btn ghost onClick={() => { const r = G.moveTo(st, p.id, 'desk'); if (!r.ok) flash(r.error || ''); else { setPanel(null); flash(`${p.name} is heading to the front desk.`); } }}>Cover the front desk</Btn>}
          <Btn small ghost onClick={close}>Close</Btn>
        </Anchored>;
      })()}

      {ready && screen === 'play' && !st.ended && !narrow && (
        <div style={{ position: 'absolute', left: 10, bottom: 10, width: 330, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 3, pointerEvents: 'none' }}>
          {st.log.slice(-2).map((l, i) => <div key={i} style={{ background: 'rgba(255,255,255,.9)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '6px 10px', fontSize: 12, color: l.tone === 'bad' ? RED : l.tone === 'warn' ? AMBER : INK }}><span style={{ color: MUTED, marginRight: 6 }}>{G.clock(st, l.t)}</span>{l.text}</div>)}
          {st.texts.length > 0 && <div style={{ pointerEvents: 'auto' }}><Btn small ghost onClick={() => setShowTexts((x) => !x)}>{showTexts ? 'Hide texts' : `Texts sent (${st.texts.length})`}</Btn></div>}
        </div>
      )}
      {showTexts && screen === 'play' && (
        <div style={{ position: 'absolute', left: 10, bottom: 120, width: 360, maxHeight: '40vh', overflow: 'auto', zIndex: 7 }}>
          <Card><H2>Texts sent</H2><Muted>The same wording the app sends. In practice, nothing is really sent.</Muted>
            {st.texts.slice().reverse().map((t, i) => <div key={i} style={{ background: SOFT, borderRadius: 12, padding: '8px 10px', fontSize: 12.5 }}><b>{t.to}</b> <span style={{ color: MUTED }}>· {G.clock(st, t.t)}</span><div style={{ marginTop: 3, lineHeight: 1.45 }}>Opal Salon: {t.body}</div></div>)}</Card>
        </div>
      )}
      {toast && <div style={{ position: 'absolute', left: '50%', top: narrow ? 70 : 78, transform: 'translateX(-50%)', background: INK, color: '#fff', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, zIndex: 12, maxWidth: '90vw', textAlign: 'center' }}>{toast}</div>}

      {ready && screen === 'menu' && (
        <Center><Card w={560}>
          <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>PRACTICE A SHIFT</div>
          <div style={{ fontSize: 26, letterSpacing: '-0.02em' }}>Run the front of Opal Salon</div>
          <Muted>Check clients in, seat them, take payment, suggest aftercare and rebook, all while keeping everyone happy. It runs on ClarityFlow’s own rules; nothing real is sent or charged.</Muted>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: SOFT, borderRadius: 14, padding: '10px 12px' }}>
            <span style={{ width: 36, height: 36, borderRadius: 18, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{lvl.n}</span>
            <div style={{ flex: 1 }}><b style={{ fontSize: 14 }}>{lvl.name}</b><div style={{ fontSize: 12, color: MUTED }}>{totalXp} points{lvl.next ? ` · next: ${lvl.next}` : ''}</div><Bar pct={lvl.pct * 100} c={BLUE} /></div>
          </div>
          {(['opening', 'rush'] as G.ShiftId[]).map((id, i) => <button key={id} onClick={() => start(id)} style={{ ...choiceStyle, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 19, background: i === 0 ? '#eaf6ef' : '#fdf1e3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={i === 0 ? 'bell' : 'alert'} color={i === 0 ? GREEN : AMBER} size={20} /></span>
            <span style={{ flex: 1 }}><b style={{ display: 'block', fontSize: 14.5 }}>Shift {i + 1}: {G.SHIFTS[id].title}</b><span style={{ fontSize: 12.5, color: MUTED }}>{i === 0 ? 'Check-ins, seating, payments and rebooking. Coached the first time. About 2 minutes.' : 'A provider calls out, a late text, a walk-in and a wash backlog. About 3 minutes.'}</span></span>
            {i === 0 && totalXp < 150 && <Pill tone="green">Start here</Pill>}
          </button>)}
          <a href="/practice/register" style={{ ...choiceStyle, flexDirection: 'row', alignItems: 'center', gap: 12, textDecoration: 'none', color: INK }}>
            <span style={{ width: 38, height: 38, borderRadius: 19, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="pay" color={BLUE} size={20} /></span>
            <span style={{ flex: 1 }}><b style={{ display: 'block', fontSize: 14.5 }}>Behind the desk: work the register</b><span style={{ fontSize: 12.5, color: MUTED }}>Scan products (a real scanner works too), fix slips, take payment while the line grows. About 3 minutes.</span></span>
            <Pill tone="green">New</Pill>
          </a>
          <a href="/practice/desk" style={{ ...choiceStyle, flexDirection: 'row', alignItems: 'center', gap: 12, textDecoration: 'none', color: INK }}>
            <span style={{ width: 38, height: 38, borderRadius: 19, background: '#eaf6ef', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="bell" color={GREEN} size={20} /></span>
            <span style={{ flex: 1 }}><b style={{ display: 'block', fontSize: 14.5 }}>At the desk: refunds and the waitlist</b><span style={{ fontSize: 12.5, color: MUTED }}>Short scenes: what to refund and where it goes, and who gets a cancelled time. Nothing real is touched.</span></span>
            <Pill tone="green">New</Pill>
          </a>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '.08em', marginTop: 4 }}>EVERY ROLE IN THE BUSINESS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {[['🧾', 'Front desk', 'The register', '/practice/register'], ['🗺', 'Floor manager', 'The salon floor', null], ['💅', 'Provider', 'Do the service', ''], ['🧽', 'Assistant', 'Turnover and cleaning', ''], ['📈', 'Owner', 'Money and the team', ''], ['🎓', 'Student', 'Academy practice', '']].map(([e, t, d, href]) => {
              const live = href !== '';
              const inner = <><span style={{ fontSize: 20 }}>{e}</span><span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', fontSize: 13 }}>{t}</b><span style={{ fontSize: 11.5, color: MUTED }}>{d}</span></span>{!live && <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 600 }}>Soon</span>}</>;
              const st = { display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 14, padding: '9px 10px', background: live ? '#fff' : SOFT, textDecoration: 'none', color: INK, opacity: live ? 1 : 0.75 } as const;
              return href ? <a key={t as string} href={href as string} style={st}>{inner}</a> : <div key={t as string} style={st}>{inner}</div>;
            })}
          </div>
          <Muted>Tap people and icons. Drag a person to a chair to seat them. Drag the floor to look around; scroll or pinch to zoom.</Muted>
          <a href="/dashboard" style={{ fontSize: 12.5, color: MUTED }}>← Back to ClarityFlow</a>
        </Card></Center>
      )}

      {screen === 'report' && (() => { const r = G.report(st); const before = G.levelOf(totalXp - st.xp); const after = G.levelOf(totalXp); return (
        <Center><Card w={560}>
          <div style={{ fontSize: 12, letterSpacing: '.1em', color: MUTED }}>END OF SHIFT · {G.clock(st).toUpperCase()}</div>
          <div style={{ display: 'flex', gap: 4 }}>{[1, 2, 3].map((k) => <Icon key={k} name="star" color={k <= r.stars ? '#d9a400' : '#d6d6da'} size={30} sw={2.2} />)}</div>
          {r.best && <div style={{ background: '#fff7e0', border: '1px solid #f1dca0', borderRadius: 14, padding: '10px 12px', fontSize: 13.5 }}><b>Best moment:</b> {r.best}</div>}
          {r.goals.map((g) => <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 7 }}>
            <span style={{ fontSize: 13.5 }}>{g.label}<span style={{ color: MUTED, fontSize: 12 }}> · goal {g.id === 'takings' ? `$${g.target}` : g.id === 'rebooked' ? g.target : `${g.target}%`}</span></span>
            <Pill tone={g.met ? 'green' : 'amber'}>{g.id === 'takings' ? `$${g.value}` : g.id === 'rebooked' ? `${g.value}` : `${g.value}%`} {g.met ? '✓' : ''}</Pill></div>)}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: MUTED }}><span>Tips ${r.tips}</span>·<span>Products ${r.retail}</span>·<span>+{r.xp} points</span></div>
          {after.n > before.n && <div style={{ background: '#e8efff', color: BLUE, borderRadius: 14, padding: '10px 12px', fontWeight: 700, fontSize: 13.5 }}>Level up! You’re now {after.name}.</div>}
          {r.badges.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{r.badges.map((b) => <Pill key={b} tone="amber">★ {b}</Pill>)}</div>}
          {r.coach.length > 0 && <><div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>What happened</div>
            {r.coach.map((c, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.5, display: 'flex', gap: 8 }}><span style={{ color: MUTED }}>•</span><span>{c}</span></div>)}</>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn onClick={() => start(shift)}>Play again</Btn>{shift === 'opening' && <Btn ghost onClick={() => start('rush')}>Next: Saturday rush</Btn>}<Btn ghost onClick={() => { eng.current?.reset(); sim.current = G.newShift('opening'); setScreen('menu'); }}>Menu</Btn></div>
        </Card></Center>); })()}
      <style>{`@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}@keyframes halo{0%{box-shadow:0 0 0 0 rgba(31,122,77,.45)}100%{box-shadow:0 0 0 14px rgba(31,122,77,0)}}@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}`}</style>
    </div>
  );
}

/** The coaching line for the first shift (and who it points at). */
function coachLine(s: G.State): { text: string; pid?: string; done?: boolean } | null {
  const r = s.people.rosa, g = s.people.grace;
  if (s.tutorial === 1) return r?.need?.kind === 'check_in' ? { text: 'Rosa just walked in. Tap the bell over her to check her in.', pid: 'rosa' } : { text: 'Doors are open. Your first client is on her way in…' };
  if (s.tutorial === 2) return { text: 'Now seat her: drag Rosa to the glowing chair at Ana’s nail table (or tap the chair).', pid: 'rosa' };
  if (s.tutorial === 3) return g?.need?.kind === 'pay' ? { text: 'Grace’s silk press is done. Tap the card icon to take payment, and offer to rebook her.', pid: 'grace' } : { text: 'Nice! Rosa is with Ana. Grace finishes her silk press any moment…' };
  if (s.tutorial === 4) return { text: 'That’s the job. Everything that needs you shows in the “Needs you” tray. Have a great shift!', done: true };
  return null;
}

// ── Small pieces in the app's style ────────────────────────────────────────
const choiceStyle: CSSProperties = { textAlign: 'left', background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5, fontFamily: 'inherit', color: INK };
function NeedBubble({ kind, tone, patience, pulse, big }: { kind: G.NeedKind; tone: 'ok' | 'warn' | 'bad' | 'none'; patience: number; pulse?: boolean; big?: boolean }) {
  const size = big ? 44 : 34; const fg = tone === 'bad' ? RED : tone === 'ok' ? GREEN : AMBER; const bd = tone === 'bad' ? '#f3c5c0' : tone === 'ok' ? '#cfe6d8' : '#f3dfc4';
  const c = 2 * Math.PI * (size / 2 + 3);
  return <div style={{ position: 'relative', width: size, height: size + 6, animation: pulse ? 'pulse 1.4s ease-in-out infinite' : undefined }}>
    {tone === 'bad' && <svg width={size + 12} height={size + 12} style={{ position: 'absolute', left: -6, top: -6 }}><circle cx={size / 2 + 6} cy={size / 2 + 6} r={size / 2 + 3} fill="none" stroke={fg} strokeWidth={2.5} strokeDasharray={`${c * Math.max(0.05, patience)} ${c}`} transform={`rotate(-90 ${size / 2 + 6} ${size / 2 + 6})`} strokeLinecap="round" /></svg>}
    <div style={{ width: size, height: size, borderRadius: size / 2, background: '#fff', border: `1.5px solid ${bd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 18px -8px rgba(0,0,0,.45)', animation: pulse ? 'halo 1.6s ease-out infinite' : undefined }}><Icon name={NEED_ICON[kind]} color={fg} size={size * 0.52} /></div>
    <div style={{ position: 'absolute', left: size / 2 - 5, top: size - 1, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${bd}` }} />
  </div>;
}
function Coach({ text, narrow, onSkip, skipLabel }: { text: string; narrow: boolean; onSkip?: () => void; skipLabel?: string }) {
  return <div style={{ position: 'absolute', left: '50%', top: narrow ? 64 : 76, transform: 'translateX(-50%)', width: narrow ? 'calc(100% - 20px)' : 520, background: BLUE, color: '#fff', borderRadius: 16, padding: '10px 14px', fontSize: 13.5, fontWeight: 600, lineHeight: 1.45, zIndex: 9, display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 16px 36px -18px rgba(37,99,235,.6)' }}>
    <span style={{ flex: 1 }}>{text}</span>{onSkip && <button onClick={onSkip} style={{ background: '#fff', color: BLUE, border: 'none', borderRadius: 999, padding: '6px 12px', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>{skipLabel}</button>}
  </div>;
}
function Anchored({ pt, w, h, W, H, narrow, children }: { pt: Pt; w: number; h: number; W: number; H: number; narrow: boolean; children: ReactNode }) {
  if (narrow) return <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, maxHeight: '58vh', overflow: 'auto', zIndex: 8 }}><Card>{children}</Card></div>;
  let left = pt.x + 40; if (left + w > W - 12) left = pt.x - 40 - w; left = Math.max(12, Math.min(W - w - 12, left));
  const maxH = H - 96; const hh = Math.min(h, maxH); let top = pt.y - hh / 2; top = Math.max(84, Math.min(H - hh - 12, top));
  return <div style={{ position: 'absolute', left, top, width: w, maxHeight: maxH, overflow: 'auto', zIndex: 8 }}><Card>{children}</Card></div>;
}
function Card({ w, children }: { w?: number; children: ReactNode }) { return <div style={{ width: w, maxWidth: '100%', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 24px 60px -30px rgba(22,23,26,.45)' }}>{children}</div>; }
function Center({ children }: { children: ReactNode }) { return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(239,232,223,.45)', zIndex: 10, overflow: 'auto' }}>{children}</div>; }
function Banner({ children }: { children: ReactNode }) { return <div style={{ position: 'absolute', left: '50%', top: 78, transform: 'translateX(-50%)', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 8px 6px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, zIndex: 7, boxShadow: '0 10px 30px -18px rgba(22,23,26,.5)', whiteSpace: 'nowrap', maxWidth: '94vw' }}>{children}</div>; }
function H2({ children }: { children: ReactNode }) { return <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>; }
function Muted({ children }: { children: ReactNode }) { return <div style={{ fontSize: 12.8, color: MUTED, lineHeight: 1.45 }}>{children}</div>; }
function Line({ l, r }: { l: ReactNode; r: ReactNode }) { return <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l}</span><span>{r}</span></div>; }
function RowBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button onClick={onClick} style={{ textAlign: 'left', background: SOFT, border: 'none', borderRadius: 12, padding: '8px 11px', cursor: 'pointer', fontFamily: 'inherit', color: INK, display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</button>; }
function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: string; label: string }) {
  return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 12, border: `1.5px solid ${on ? INK : LINE}`, background: '#fff', fontFamily: 'inherit', cursor: 'pointer', color: INK, textAlign: 'left' }}>
    <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
    <Icon name={icon} size={15} /><span style={{ fontSize: 12.8, fontWeight: 600 }}>{label}</span></button>;
}
function Btn({ children, onClick, ghost, small }: { children: ReactNode; onClick?: () => void; ghost?: boolean; small?: boolean }) {
  return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: small ? '6px 12px' : '10px 18px', borderRadius: 999, fontSize: small ? 12.5 : 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.2, background: ghost ? '#fff' : INK, color: ghost ? INK : '#fff', border: `1px solid ${ghost ? LINE : INK}` }}>{children}</button>;
}
function IconBtn({ onClick, icon, label }: { onClick: () => void; icon: string; label: string }) {
  return <button onClick={onClick} aria-label={label} title={label} style={{ width: 32, height: 32, borderRadius: 16, border: `1px solid ${LINE}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name={icon} size={16} /></button>;
}
function Pill({ children, ink, tone }: { children: ReactNode; ink?: boolean; tone?: 'green' | 'amber' | 'red' }) {
  const [bg, fg] = ink ? [INK, '#fff'] : tone === 'green' ? ['#e8f3ec', GREEN] : tone === 'amber' ? ['#fdf1e3', AMBER] : tone === 'red' ? ['#fdecec', RED] : [SOFT, INK];
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}
function Bar({ pct, c, w }: { pct: number; c: string; w?: number }) { return <div style={{ height: 6, width: w, borderRadius: 3, background: SOFT, marginTop: 3 }}><div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 6, borderRadius: 3, background: c }} /></div>; }
function Goal({ icon, label, value, pct, met, narrow }: { icon: string; label: string; value: string; pct: number; met: boolean; narrow: boolean }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: narrow ? 104 : 136 }}>
    <span style={{ width: 26, height: 26, borderRadius: 13, background: met ? '#e8f3ec' : SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} color={met ? GREEN : INK} size={14} /></span>
    <div style={{ flex: 1 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11.5 }}><span style={{ color: MUTED }}>{label}</span><b>{value}</b></div><Bar pct={pct} c={met ? GREEN : INK} /></div>
  </div>;
}
