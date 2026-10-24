// Checks that one scan from a USB or Bluetooth scanner is heard once (lib/use-wedge-scanner): the desk's listener, the
// scan sheet's, a camera scan box's and the pick and pack screens' all listen through one listener, and a scan goes to
// one of them: a screen in front (a camera's scan box, a sheet) before one behind it (the desk, a wall's scanner
// opener), the last to start of those. A scan typed into the desk's search box goes to the screen in front and the box
// clears itself; typing into any other box is left alone; each listener keeps its own limits (the desk takes a slower
// scanner than a pick screen does); only a camera box's scans mark the device as having a scanner; the desk's camera
// routes a kit's label to the kit scanner, as its scanner does.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/scan-listeners.verify.ts
import Module from 'module';
import fs from 'fs';
import { check, failures } from './fake-db';

// React stubbed: an effect runs at once and hands back its clean-up, so a screen can be "closed".
const cleanups: (() => void)[] = [];
const ReactStub: any = {
  useRef: (v: any) => ({ current: v }),
  useEffect: (fn: any) => { const c = fn(); if (typeof c === 'function') cleanups.push(c); },
  useCallback: (f: any) => f, useState: (v: any) => [v, () => {}],
};
ReactStub.default = ReactStub;
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) { if (request === 'react') return ReactStub; return load.call(this, request, ...rest); };
(globalThis as any).window = new EventTarget();
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
(globalThis as any).window.localStorage = (globalThis as any).localStorage;

class KE extends Event { key: string; ctrlKey = false; metaKey = false; altKey = false; constructor(key: string) { super('keydown', { cancelable: true }); this.key = key; } }
const field = (scan: boolean) => { const el: any = new EventTarget(); el.tagName = 'INPUT'; el.type = 'text'; el.hasAttribute = (k: string) => scan && k === 'data-scan-field'; return el; };
const send = (k: string, target?: any) => { const e = new KE(k); if (target) Object.defineProperty(e, 'target', { value: target }); window.dispatchEvent(e); return e; };
// Keys as a scanner types them, quickly, on the window or in a box (a capture listener on the window sees them first).
const burst = (code: string, target?: any) => { for (const ch of code) send(ch, target); return send('Enter', target); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Keys this far apart, then Enter (or none).
const paced = async (code: string, ms: number, enter = true) => { for (const ch of code) { send(ch); await wait(ms); } if (enter) send('Enter'); else await wait(200); };

(async () => {
  const { useBarcodeScanner } = await import('../../src/hooks/useBarcodeScanner');
  const { useWedge } = await import('../../src/lib/use-wedge');
  const { useWedgeScanner, scannerSeenBefore } = await import('../../src/lib/use-wedge-scanner');
  const heard: string[] = [];

  useBarcodeScanner((c: string) => heard.push(`desk:${c}`), true);
  burst('012345678905');
  check('at the desk, a scan is heard once, by the desk', heard.join() === 'desk:012345678905', heard);
  check('…and a desk scan doesn’t turn the camera off in every camera box on the device', !scannerSeenBefore());

  heard.length = 0;
  useWedgeScanner((c: string) => heard.push(`camera:${c}`));   // the desk's camera drawer opens
  burst('012345678905');
  check('with the camera drawer open, only the drawer hears it (the product is added once)', heard.join() === 'camera:012345678905', heard);
  check('…a camera box’s scan marks the device as having a scanner', scannerSeenBefore());
  cleanups.pop()!();   // the drawer closes

  heard.length = 0;
  useWedge((c: string) => heard.push(`sheet:${c}`), true);   // the scan sheet opens over the desk
  burst('K7Q2M');
  check('with the scan sheet open, only the sheet hears it (a kit moves one step)', heard.join() === 'sheet:K7Q2M', heard);
  heard.length = 0;
  const e1 = burst('K8R3N', field(true));
  check('…a scan typed into the desk’s search box, still focused behind the sheet, goes to the sheet (it used to be lost), and the box clears', heard.join() === 'sheet:K8R3N' && e1.defaultPrevented, heard);
  cleanups.pop()!();

  heard.length = 0;
  const e = burst('012345678905', field(true));
  check('a scan typed into the desk’s search box is taken once, and the box is told to clear', heard.join() === 'desk:012345678905' && e.defaultPrevented, heard);
  heard.length = 0;
  burst('012345678905', field(false));
  check('typing into any other box is left alone', heard.length === 0, heard);

  // A wall that opens the scanner sheet, with a panel's camera box showing: after the sheet is opened and closed, the
  // panel still hears the scans (the opener is behind it, whenever it starts listening again).
  cleanups.splice(0).forEach((c) => c());
  heard.length = 0;
  useWedge((c: string) => heard.push(`opener:${c}`), true, 'background');
  useWedgeScanner((c: string) => heard.push(`panel:${c}`));
  cleanups.splice(0, 1).forEach((c) => c());                             // the sheet opens: the opener stops
  useWedge((c: string) => heard.push(`opener:${c}`), true, 'background');  // …and starts again when it closes
  burst('K7Q2M');
  check('which screen hears follows what’s in front, not who started listening last', heard.join() === 'panel:K7Q2M', heard);

  // Each listener's own limits.
  cleanups.splice(0).forEach((c) => c());
  heard.length = 0;
  useBarcodeScanner((c: string) => heard.push(`desk:${c}`), true);
  await paced('012345', 55);
  check('the desk still takes a scanner that types 55 ms a key (as it always did)', heard.join() === 'desk:012345', heard);
  cleanups.splice(0).forEach((c) => c());
  heard.length = 0;
  useWedgeScanner((c: string) => heard.push(`pick:${c}`));
  await paced('abc', 45, false);
  check('a pick or pack screen still ignores “abc” typed at 45 ms a key with nothing focused', heard.length === 0, heard);
  heard.length = 0;
  for (const ch of 'ABCD') { send(ch); await wait(120); }
  send('Enter');
  check('keys typed at a person’s pace aren’t a scan', heard.length === 0, heard);

  const src = (p: string) => fs.readFileSync(p, 'utf8');
  check('the scan sheet’s own listener stands aside while its camera box (which hears scanners) is shown, and the wall’s opener sits behind',
    /useWedge\(scan, open && !cam\);/.test(src('src/components/pos/desk/ScanSheet.tsx')) && /useWedge\(openWith, listen && !open, 'background'\);/.test(src('src/components/pos/desk/ScanSheet.tsx')));
  check('the orders board’s listener sits behind its sheets', /\}, true, \{ layer: 'background' \}\);/.test(src('src/components/orders/OrdersApp.tsx')));
  check('the desk’s camera routes a scan the way the desk’s scanner does (a kit’s label opens the kit scanner)',
    /new CustomEvent\('cf:desk-scan', \{ detail: \{ code: raw \}, cancelable: true \}\)/.test(src('src/app/(app)/pos/page.tsx')) && /window\.addEventListener\('cf:desk-scan', on\)/.test(src('src/components/pos/desk/DeskPOS.tsx')) && /useBarcodeScanner\(routeScan, !!e\.handlePosScan\);/.test(src('src/components/pos/desk/DeskPOS.tsx')));
  check('no screen listens for scanners on its own any more', !/addEventListener\('keydown'/.test(src('src/hooks/useBarcodeScanner.ts') + src('src/lib/use-wedge.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
