// scripts/verify/markup.verify.tsx — THE ONE MARKUP TOOL (B7a, board 17A). Marks are kept in the original photo's
// pixels, so cropping, turning, flipping and straightening never move or lose them; pins keep their numbers; the
// eraser rubs out only drawn lines; what's kept is checked and small; every mark reads out in plain words; and every
// tool from both old tools is in the new one.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/markup.verify.tsx
import fs from 'fs';
import * as Mk from '../../src/lib/markup/model';
import * as D from '../../src/lib/markup/describe';
import { boxOf, hitMark, canvasMatrix } from '../../src/lib/markup/draw';
import * as IP from '../../src/lib/inspo-photos';

let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const near = (a: Mk.Pt, b: Mk.Pt, e = 0.01) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e;
const mark = (o: Partial<Mk.Mark>): Mk.Mark => ({ id: Mk.uid(), kind: 'pen', layer: 'client', color: '#e11d48', size: 0.012, opacity: 1, rotation: 0, pts: [{ x: 0, y: 0 }], ...o });

// ── the view
const d0 = Mk.emptyDoc(1200, 900);
const t90 = { ...d0, view: { ...d0.view, turn: 90 as const } };
ok(near(Mk.ap(Mk.viewOf(t90).m, { x: 0, y: 0 }), { x: 900, y: 0 }) && near(Mk.ap(Mk.viewOf(t90).m, { x: 1200, y: 900 }), { x: 0, y: 1200 }) && Mk.viewOf(t90).w === 900 && Mk.viewOf(t90).h === 1200, 'a quarter turn clockwise: the top-left corner goes to the top right, and the photo stands up');
for (const turn of [0, 90, 180, 270] as const) for (const flip of [false, true]) {
  const d = { ...d0, view: { crop: null, turn, flip, straighten: 7 } }; const v = Mk.viewOf(d); const back = Mk.inv(v.m);
  const p = { x: 321, y: 654 }; const corners = [{ x: 0, y: 0 }, { x: v.w, y: 0 }, { x: v.w, y: v.h }, { x: 0, y: v.h }].map((q) => Mk.ap(back, q));
  ok(near(Mk.ap(back, Mk.ap(v.m, p)), p) && corners.every((c) => c.x >= -0.5 && c.x <= 1200.5 && c.y >= -0.5 && c.y <= 900.5), `turned ${turn}°${flip ? ', flipped' : ''}, straightened 7°: every point maps back, and no empty corners show`);
}
const sq = Mk.cropTo(d0, 'square')!; const r45 = Mk.cropTo(d0, '4:5')!;
ok(sq.w === 900 && sq.h === 900 && sq.x === 150 && Math.abs(r45.w / r45.h - 0.8) < 0.01, 'fixed crop shapes, centered and as large as fits', [sq, r45]);
let d4: Mk.MarkupDoc = { ...d0, view: { ...d0.view, crop: { x: 100, y: 50, w: 400, h: 300 } } };
const spot = { x: 300, y: 200 }; const seen = (d: Mk.MarkupDoc) => Mk.ap(Mk.viewOf(d).m, spot);
const firstTurn = { ...d4, view: Mk.turnQuarter(d4) };
const s0 = seen(d4); const s1 = seen(firstTurn);
ok(near(s1, { x: 300 - s0.y, y: s0.x }, 0.01), 'a turn keeps the crop on the same part of the photo (a mark in it stays in it)', { s0, s1, crop: firstTurn.view.crop });
for (let i = 0; i < 4; i++) d4 = { ...d4, view: Mk.turnQuarter(d4) };
ok(JSON.stringify(d4.view.crop) === JSON.stringify({ x: 100, y: 50, w: 400, h: 300 }) && d4.view.turn === 0, 'four turns come back to the same crop');

// ── marks
const stroke = mark({ kind: 'pen', pts: Array.from({ length: 41 }, (_, i) => ({ x: i * 10, y: 100 })) });
const cut = Mk.erased([stroke, mark({ kind: 'circle', pts: [{ x: 190, y: 90 }, { x: 210, y: 110 }] }), mark({ kind: 'pen', layer: 'team', pts: [{ x: 200, y: 100 }, { x: 210, y: 100 }] })], [{ x: 200, y: 80 }, { x: 200, y: 120 }], 25, 'client');
ok(cut.filter((m) => m.kind === 'pen' && m.layer === 'client').length === 2 && cut.some((m) => m.kind === 'circle') && cut.some((m) => m.layer === 'team'), 'the eraser splits a drawn line in two, and leaves shapes and other layers alone');
let doc: Mk.MarkupDoc = { ...d0, nextPin: 1 };
const pin = (n: number) => mark({ kind: 'pin', pts: [{ x: 100 * n, y: 100 }], pin: { n, note: `Note ${n}` } });
doc = { ...doc, marks: [pin(1), pin(2), pin(3)], nextPin: 4 };
doc = { ...doc, marks: doc.marks.filter((m) => m.pin?.n !== 2) };
const dup = Mk.duplicated(doc, doc.marks[0]);
ok(dup.mark.pin?.n === 4 && dup.nextPin === 5 && D.pinLines({ ...doc, marks: [...doc.marks, dup.mark] }).join('|') === '1. Note 1|3. Note 3|4. Note 1', 'pins never renumber: removing pin 2 leaves 1 and 3, and a copy gets 4');
const n1 = mark({ kind: 'nail', pts: [{ x: 1, y: 1 }], nail: { shape: 'coffin', length: 'long' } }), n2 = mark({ kind: 'nail', pts: [{ x: 2, y: 2 }], nail: { shape: 'round', length: 'short' } });
ok(Mk.toEveryNail([n1, n2], n1)[1].nail?.shape === 'coffin' && Mk.toEveryNail([n1, n2], n1)[1].nail?.length === 'long', 'one nail guide copied to every nail');
ok(Mk.restacked([n1, n2, stroke], n2.id, 'back')[0].id === n2.id && Mk.restacked([n2, n1], n2.id, 'front')[1].id === n2.id, 'to front and to back');
ok(Mk.scaled(mark({ kind: 'stamp', stamp: 'star' }), 2).size === 0.024 && Mk.scaled(mark({ kind: 'circle', pts: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }), 2).pts[1].x === 15, 'resizing: stamps by size, shapes about their middle');

// ── kept as JSON
const messy = { w: 1200, h: 900, nextPin: 2, note: 'x'.repeat(900), colors: ['#B9605D', 'red', '#123'], view: { turn: 45, crop: { x: 'a' }, straighten: 99 },
  marks: [{ kind: 'pin', pts: [{ x: 5, y: 5 }], pin: { n: 7, note: 'Seven' } }, { kind: 'script', pts: [{ x: 1, y: 1 }] }, { kind: 'text', pts: [{ x: 1, y: 1 }], text: '   ' }, { kind: 'stamp', stamp: 'skull', pts: [{ x: 1, y: 1 }] },
    { kind: 'circle', color: 'url(javascript:1)', pts: [{ x: 1, y: 1 }, { x: 'NaN', y: 3 }, { x: 4, y: 4 }], opacity: 9, id: '<b>' }] };
const clean = Mk.cleanDoc(messy)!;
ok(clean.marks.length === 2 && clean.nextPin === 8 && clean.marks[0].pin?.n === 7 && clean.marks[1].color === Mk.PALETTE[0] && clean.marks[1].opacity === 1 && clean.marks[1].id === 'b' && clean.note.length === 300 && clean.colors.join() === '#b9605d' && clean.view.turn === 0 && clean.view.crop === null && clean.view.straighten === 15,
  'what comes back is checked: unknown marks dropped, colors and numbers kept in range, text cut, pins keep their numbers', clean);
ok(Mk.cleanDoc(null) === null && Mk.cleanDoc({ w: 0, h: 5 }) === null && Mk.keepMarkup('{oops') === null && Mk.keepMarkup('x'.repeat(20000)) === null, '…and nonsense is nothing');
const long = { ...d0, marks: Array.from({ length: 20 }, () => mark({ kind: 'pen', pts: Array.from({ length: 600 }, (_, i) => ({ x: i * 2 + Math.random() * 0.2, y: 300 + Math.sin(i / 30) * 40 })) })) };
const packed = Mk.packDoc(long);
ok(packed && packed.length <= 15000 && Mk.cleanDoc(JSON.parse(packed))!.marks.length === 20, 'long strokes are thinned so a photo’s marks stay small', packed?.length);
ok(Mk.keepMarkup(Mk.packDoc({ ...d0, marks: [pin(1)], nextPin: 2 })) !== null, 'marks sent with a photo are kept, checked again');

// ── second look (review fixes)
let fd: Mk.MarkupDoc = { ...d0, view: { crop: { x: 100, y: 50, w: 400, h: 300 }, turn: 0, flip: true, straighten: 0 } };
const inside = { x: 1200 - 300, y: 200 };   // a point in the crop of the flipped photo
const sf0 = Mk.ap(Mk.viewOf(fd).m, inside); fd = { ...fd, view: Mk.turnQuarter(fd) }; const sf1 = Mk.ap(Mk.viewOf(fd).m, inside); const vf = Mk.viewOf(fd);
ok(sf1.x >= 0 && sf1.x <= vf.w && sf1.y >= 0 && sf1.y <= vf.h && near(sf1, { x: 300 - sf0.y, y: sf0.x }, 0.01), 'a flipped photo turns clockwise too, and its crop stays on the same part', { sf0, sf1, vf });
const forged = JSON.parse(Mk.keepMarkup(JSON.stringify({ ...d0, marks: [{ ...pin(1), layer: 'team', by: 'Owner' }, { ...pin(2), layer: 'private' }] }), { as: 'client' })!);
ok(forged.marks.length === 1 && !forged.marks[0].layer && !forged.marks[0].by, 'marks sent by a client are always theirs: nothing on the team’s layers, no name kept', forged.marks);
const inf = Mk.cleanDoc({ w: 100, h: 100, nextPin: 1e999, marks: [{ kind: 'pin', pts: [{ x: 1, y: 1 }], pin: { n: 1e999 } }, { kind: 'pen', pts: [{ x: null, y: 2 }, { x: '', y: 3 }] }] })!;
ok(inf.marks.length === 1 && inf.marks[0].pin!.n === 1 && inf.nextPin === 2, 'numbers out of range never become pin 1 everywhere, and blank points are dropped', inf);
const turned = mark({ kind: 'pen', rotation: Math.PI / 2, pts: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 50 })) });   // drawn across, turned to stand upright about (50, 50)
const rub = Mk.erased([turned], [{ x: 30, y: 50 }, { x: 70, y: 50 }], 5, 'client');
const centers = rub.map((m) => Mk.centerOf(m));
ok(rub.length === 2 && centers.every((c) => Math.abs(c.x - 50) < 1), 'the eraser meets a turned stroke where it shows, and the pieces stay put', centers);
const straight = Mk.erased([mark({ kind: 'pen', smooth: false, pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }] })], [{ x: 100, y: -20 }, { x: 100, y: 20 }], 5, 'client');
ok(straight.length === 2, 'a long straight stroke is rubbed out in the middle');
const loop = Mk.simplified([{ x: 0, y: 0 }, { x: 50, y: -40 }, { x: 100, y: 0 }, { x: 50, y: 40 }, { x: 0, y: 0 }], 1);
ok(loop.length >= 4, 'a closed loop keeps its shape when thinned', loop);
ok((Mk.packDoc({ ...d0, nextPin: 61, marks: Array.from({ length: 60 }, (_, i) => pin(i + 1)) }) || '').length > 0, 'sixty pins fit');
ok(IP.ownOriginal('/api/files/view?t=t1&p=' + encodeURIComponent('tenants/t1/completions/inspiration-originals/2026-11-07/mhoabc123xyz.jpg'), 't1') !== null && IP.ownOriginal('/api/files/view?t=t1&p=' + encodeURIComponent('tenants/t1/completions/form-photos/2026-11-07/mhoabc123xyz.jpg'), 't1') === null
  && IP.ownOriginal('https://elsewhere.example/x.jpg', 't1') === null && IP.ownOriginal('/api/files/view?t=t2&p=' + encodeURIComponent('tenants/t2/completions/inspiration-originals/2026-11-07/mhoabc123xyz.jpg'), 't1') === null, 'the photo before its marks only ever comes from this business’s private folder');

// ── plain words
const words = { ...d0, colors: ['#a99cbb'], note: 'This shape, but shorter.', marks: [pin(1), pin(3), mark({ kind: 'circle', pts: [{ x: 1, y: 1 }, { x: 9, y: 9 }] }), mark({ kind: 'arrow', pts: [{ x: 1, y: 1 }, { x: 9, y: 9 }] }), n1, { ...n2, nail: { shape: 'coffin' as const, length: 'long' as const } },
  mark({ kind: 'stamp', stamp: 'heart', pts: [{ x: 1, y: 1 }] }), mark({ kind: 'text', text: 'Shorter', pts: [{ x: 1, y: 1 }] }), mark({ kind: 'pin', layer: 'private', pts: [{ x: 1, y: 1 }], pin: { n: 9, note: 'Private' } })] };
const line = D.photoLine(words);
ok(line === 'two pins with notes · a circle · an arrow · coffin nail guides, long length · a heart · the label “Shorter” · picked color #A99CBB · “This shape, but shorter.”', 'every photo reads out in plain words (never the private notes)', line);
ok(/Pins: 1\. Note 1; 3\. Note 3/.test(D.altText(words)) && D.photoLine(null, '') === 'No marks or note', 'and for screen readers, each pin’s note');

// ── picking a mark up
const pick = { ...d0, marks: [stroke, mark({ kind: 'stamp', stamp: 'star', pts: [{ x: 600, y: 600 }] })] };
const M = canvasMatrix(pick, 0.5);
ok(hitMark(pick, M, { x: 100, y: 50 }, { layers: ['client'] })?.id === stroke.id && hitMark(pick, M, { x: 100, y: 120 }, { layers: ['client'] }) === null && hitMark(pick, M, { x: 300, y: 300 }, { layers: ['client'] })?.kind === 'stamp' && hitMark(pick, M, { x: 300, y: 300 }, { layers: ['team'] }) === null,
  'a line is picked up by the line itself, a stamp by its box, and only on the layers that can be changed');
const b = boxOf(pick.marks[1], pick, M); ok(b.x1 > b.x0 && Math.abs((b.x0 + b.x1) / 2 - 300) < 1, 'a mark’s box sits on it');
const ring = { ...d0, marks: [mark({ kind: 'circle', pts: [{ x: 200, y: 200 }, { x: 800, y: 700 }] }), mark({ kind: 'lens', zoom: 3, pts: [{ x: 100, y: 100 }, { x: 1000, y: 800 }] })] };
const Mr = canvasMatrix(ring, 0.5);
ok(hitMark(ring, Mr, { x: 250, y: 225 }, { layers: ['client'] }) === null && hitMark(ring, Mr, { x: 100, y: 225 }, { layers: ['client'] })?.kind === 'circle'
  && hitMark(ring, Mr, { x: 500, y: 400 }, { layers: ['client'] })?.kind === 'lens' && hitMark(ring, Mr, { x: 300, y: 300 }, { layers: ['client'] }) === null, 'a big circle is picked up by its outline, and a close-up by its two circles, never what’s between them');

// ── the editor has every tool from both old tools
const E = src('src/components/markup/MarkupEditor.tsx'), PM = src('src/components/booking/PhotoMarkup.tsx');
const tools = ['Move', 'Pen', 'Highlight', 'Arrow', 'Circle', 'Shapes', 'Text', 'Stamps', 'Nail guide', 'Pins', 'Pick color', 'Magnify', 'Blur', 'Eraser', 'Crop'];
ok(tools.every((t) => E.includes(`label: '${t}'`)), 'every tool, one row', tools.filter((t) => !E.includes(`label: '${t}'`)));
ok(['Rotate', 'Duplicate', 'To front', 'To back', 'Delete', 'Opacity', 'Copy to every nail', 'Hold to see original', 'Solid', 'Dashed', 'Smooth on', 'Rotate 90°', 'Flip', 'Straighten', 'Colors I love', 'Undo', 'Redo', 'Zoom in', 'Zoom out', 'Custom color'].every((w) => E.includes(w)), 'change any mark, and everything around the tools');
ok(Mk.STAMPS.map((s) => s.key).join() === 'heart,star,sparkle,tick,cross,warning,target,arrow' && /'number'/.test(E) && Mk.NAIL_SHAPES.length === 5 && Mk.NAIL_LENGTHS.length === 4 && Mk.PALETTE.length === 8, 'every stamp from both tools, numbers, five nail shapes with four lengths, eight colors and a custom one');
ok(/<MarkupEditor /.test(PM) && /original/.test(PM) && /packDoc\(r\.doc\)/.test(PM) && /reopen\(p, i\)/.test(PM), 'booking photos use the one tool, and keep the photo before its marks and the marks');
const BR = src('src/app/api/appointments/book/route.ts'), CA = src('src/app/api/checkin/actions/route.ts');
ok(/ownOriginal\(x\.original, tid\)/.test(BR) && /keepMarkup\(x\.markup, \{ as: 'client' \}\)/.test(BR) && /P\.ownOriginal\(p\?\.original, x\.tenantId\)/.test(CA) && /keepMarkup\(p\?\.markup, \{ as: 'client' \}\)/.test(CA), 'the marks are checked again wherever they’re saved, as the client’s own, and the photo before them only from the private folder');
const all = ['src/components/markup/MarkupEditor.tsx', 'src/lib/markup/model.ts', 'src/lib/markup/draw.ts', 'src/lib/markup/describe.ts', 'src/components/booking/PhotoMarkup.tsx'].map(src).join('\n');
const names = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
ok(!names.test(all) && !/call us|contact us/i.test(all) && !/\{\/\*/.test(all) && !/uppercase|tracking-widest/.test(all) && !/colour(?!s\b)|Colours I|grey/.test(all.replace(/colors/g, '')), 'house rules');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
