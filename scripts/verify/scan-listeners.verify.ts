// Checks that one scan from a USB or Bluetooth scanner is heard once (lib/use-wedge-scanner): the desk's listener, the
// scan sheet's, a camera scan box's and the pick and pack screens' all listen through one listener, and only the newest
// screen open hears a scan. A scan typed into the desk's search box is taken once and the box clears itself; typing
// into any other box is left alone; a burst too slow to be a scanner is ignored.
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
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };

class KE extends Event { key: string; ctrlKey = false; metaKey = false; altKey = false; constructor(key: string) { super('keydown', { cancelable: true }); this.key = key; } }
const field = (scan: boolean) => { const el: any = new EventTarget(); el.tagName = 'INPUT'; el.type = 'text'; el.hasAttribute = (k: string) => scan && k === 'data-scan-field'; return el; };
// Keys as a scanner types them: on the window, or in a box (they reach the window first, as a capture listener sees them).
const burst = (code: string, target?: any) => {
  const send = (k: string) => { const e = new KE(k); if (target) Object.defineProperty(e, 'target', { value: target }); window.dispatchEvent(e); return e; };
  for (const ch of code) send(ch);
  return send('Enter');
};

(async () => {
  const { useBarcodeScanner } = await import('../../src/hooks/useBarcodeScanner');
  const { useWedge } = await import('../../src/lib/use-wedge');
  const { useWedgeScanner } = await import('../../src/lib/use-wedge-scanner');
  const heard: string[] = [];

  useBarcodeScanner((c: string) => heard.push(`desk:${c}`), true);
  burst('012345678905');
  check('at the desk, a scan is heard once, by the desk', heard.join() === 'desk:012345678905', heard);

  heard.length = 0;
  useWedgeScanner((c: string) => heard.push(`camera:${c}`));   // the desk's camera drawer opens
  burst('012345678905');
  check('with the camera drawer open, only the drawer hears it (the product is added once)', heard.join() === 'camera:012345678905', heard);
  cleanups.pop()!();   // the drawer closes

  heard.length = 0;
  useWedge((c: string) => heard.push(`sheet:${c}`), true);   // the scan sheet opens over the desk
  burst('K7Q2M');
  check('with the scan sheet open, only the sheet hears it (a kit moves one step)', heard.join() === 'sheet:K7Q2M', heard);
  cleanups.pop()!();

  heard.length = 0;
  const e = burst('012345678905', field(true));
  check('a scan typed into the desk’s search box is taken once, and the box is told to clear', heard.join() === 'desk:012345678905' && e.defaultPrevented, heard);
  heard.length = 0;
  burst('012345678905', field(false));
  check('typing into any other box is left alone', heard.length === 0, heard);

  heard.length = 0;
  for (const ch of 'ABCD') { window.dispatchEvent(new KE(ch)); await new Promise((r) => setTimeout(r, 120)); }
  window.dispatchEvent(new KE('Enter'));
  check('keys typed at a person’s pace aren’t a scan', heard.length === 0, heard);

  const src = (p: string) => fs.readFileSync(p, 'utf8');
  check('the scan sheet’s own listener stands aside while its camera box (which hears scanners) is shown', /useWedge\(scan, open && !cam\);/.test(src('src/components/pos/desk/ScanSheet.tsx')));
  check('no screen listens for scanners on its own any more', !/addEventListener\('keydown'/.test(src('src/hooks/useBarcodeScanner.ts') + src('src/lib/use-wedge.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
