// Checks everything printed in the app's look (design board "Stickers, labels, receipts and tickets in the app's look",
// A: quiet and bold; lib/print-picture, lib/print-fonts, lib/printing, the printers' own addresses, the tablet's print):
// - each slip drawn as a picture at the printer's width (576 dots on 80 mm, 384 on 58 mm), black and white only (no
//   gray), cut to its height, the same picture again for the same slip; nothing to draw for only the cash drawer
// - an Epson gets the picture's dots in ePOS-Print XML, with the drawer and the cut; a Star a PNG, and a Star that has
//   printed a picture prints codes to scan from then on (bag labels, item stickers)
// - what a guest takes home starts with the business (its initial in a black tile); a sticker has the tile before its
//   number; a label's or sticker's code goes beside the top
// - codes that scan from the picture, each square whole dots; letters the typeface lacks folded, left out or "?"; a
//   slip taller than first thought drawn again taller, and one far too long not drawn (the printer's letters instead)
// - the tablet's own print, and labels printed there, in the same look
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/print-look.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require('pngjs');
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const P = await import('../../src/lib/printing');
  const PP = await import('../../src/lib/print-picture');
  const S = await import('../../src/lib/item-stickers');
  const F = await import('../../src/lib/food-bags');
  const PS = await import('../../src/lib/printing-server');

  console.log('drawn as a picture');
  const receipt = P.receiptDoc({ source: 'counter', channel: 'drive-thru', orderNumber: 'D14', clientName: 'Lucia', date: '2026-11-22T13:14:00Z', subtotal: 13.25, tax: 1.2, total: 14.45, paymentMethod: 'card',
    detail: { lines: [{ label: 'Oat latte (Large, extra shot)', qty: 1, amount: 6.25 }, { label: 'Sea salt cookie', qty: 2, amount: 7 }] } }, { business: 'Juniper Coffee', tz: 'UTC', url: 'https://app.test/r/abc' });
  check('a receipt starts with the business (its name, for its tile), then the order', receipt.blocks[0].k === 'brand' && (receipt.blocks[0] as any).name === 'Juniper Coffee' && P.initialOf('Juniper Coffee') === 'J' && P.initialOf('  ’77 Diner') === '7' && P.initialOf('') === '' && P.initialOf('Éclair') === 'E');
  const pic = (await PP.slipPicture(receipt, 576, 'job-a'))!;
  const raw = PNG.sync.read(pic.png);
  let gray = 0, black = 0; for (let i = 0; i < raw.data.length; i += 4) { const v = raw.data[i]; if (v !== 0 && v !== 255) gray++; if (v === 0) black++; }
  check('the picture: the printer’s width, black and white only, cut to its height', pic.width === 576 && raw.width === 576 && raw.height === pic.height && gray === 0 && black > 2000 && pic.height > 400 && pic.height < 3000, { w: pic.width, h: pic.height, gray, black });
  check('…its dots, one bit each, row by row, for an Epson', Buffer.from(pic.bits, 'base64').length === Math.ceil(576 / 8) * pic.height);
  // The last row with black is near the bottom (cut, with a little room).
  let last = 0; for (let y = raw.height - 1; y >= 0 && !last; y--) for (let x = 0; x < raw.width; x++) if (raw.data[(y * raw.width + x) * 4] === 0) { last = y; break; }
  check('…cut just below what’s printed', raw.height - last <= 24 && raw.height - last >= 10, { h: raw.height, last });
  check('…the same slip asked for again is the same picture', (await PP.slipPicture(receipt, 576, 'job-a')) === pic);
  const narrow = (await PP.slipPicture(receipt, 384, 'job-a'))!;
  check('…58 mm paper: 384 dots wide', narrow.width === 384 && PP.dotsFor(32) === 384 && PP.dotsFor(48) === 576 && PP.dotsFor(42) === 576);
  check('…nothing to draw for only the cash drawer', (await PP.slipPicture(P.drawerDoc(), 576)) === null);
  const xml = P.eposPicture(pic, { ...receipt, drawer: true });
  check('an Epson’s slip: the drawer, the picture’s dots, a feed and the cut', xml.startsWith('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><pulse drawer="drawer_1" time="pulse_100"/>') && xml.includes(`<image width="576" height="${pic.height}" color="color_1" mode="mono">${pic.bits}</image>`) && xml.endsWith('<feed line="3"/><cut type="feed"/></epos-print>'));

  console.log('labels and stickers');
  const order = { number: 'D14', guestName: 'Lucia Ortiz', channel: 'drive-thru', lines: [{ lineId: 'a', name: 'Bacon egg biscuit', quantity: 1 }] };
  const lab = F.labelDoc(F.labelOf(order, 1, 2, 'clarityflow://bag/o1.1.0123456789abcdef', 'Juniper Coffee'));
  check('a bag label: the business, the number big, the name, how it goes and which bag; the code beside the top', lab.blocks[0].k === 'brand' && lab.blocks[1].k === 'head' && (lab.blocks[1] as any).left === 'D14' && lab.blocks.some((b: any) => b.text === 'Drive-thru, bag 1 of 2') && lab.qrBeside === true);
  const labPic = PNG.sync.read((await PP.slipPicture(lab, 576))!.png);
  // The code beside the top: black in the right third of the first 200 rows, and nothing there lower down past the rule.
  let right = 0; for (let y = 0; y < 200; y++) for (let x = 400; x < 576; x++) if (labPic.data[(y * 576 + x) * 4] === 0) right++;
  check('…drawn with the code at the top right', right > 3000, right);
  const st = S.stickerDoc(S.stickerOf(order, { item: 'Oat latte', choiceList: ['Large'], note: null }, [], 1, 2, 'clarityflow://item/o1.t1.1.1.0123456789abcdef', 'J'));
  check('a sticker: the business’s initial in a tile before the number, then the name and the item; the code beside', st.blocks[0].k === 'head' && (st.blocks[0] as any).mark === 'J' && (st.blocks[1] as any).text === 'Lucia' && st.qrBeside === true);
  check('a Star that has printed a picture prints codes; one that hasn’t, words only; an Epson always', PS.printsCodes({ kind: 'star', pictures: true }) && !PS.printsCodes({ kind: 'star' }) && PS.printsCodes({ kind: 'epson' }) && !PS.printsCodes(null) && PS.printerFrom('p', { kind: 'epson' }).pictures === true && PS.printerFrom('p', { kind: 'star' }).pictures === false);
  check('…so bag labels and stickers carry codes on it (and their screens say so until then)', /const coded = !!o\.here \|\| printsCodes\(printer\);/.test(src('src/lib/food-bags-server.ts')) && /const coded = printsCodes\(p\);/.test(src('src/lib/printing-server.ts')) && /const coded = printsCodes\(printer\);/.test(src('src/lib/item-stickers-server.ts'))
    && /in plain type until it prints its first slip in the app’s look\. Print a test to start it/.test(src('src/app/(app)/settings/printers/page.tsx')));

  console.log('codes that scan, letters it can draw, nothing cut off');
  const jsQR = require('jsqr');
  const scan = (png: Buffer) => { const r = PNG.sync.read(png); const c = jsQR(new Uint8ClampedArray(r.data), r.width, r.height); return c ? c.data : null; };
  // The width of a code's first square of black (its top-left finder, 7 squares wide), in dots.
  const finder = (png: Buffer) => { const r = PNG.sync.read(png); for (let y = 0; y < r.height; y++) { let run = 0, best = 0; for (let x = 0; x < r.width; x++) { if (r.data[(y * r.width + x) * 4] === 0) { run++; best = Math.max(best, run); } else run = 0; } if (best >= 21 && best < 300) { let x0 = -1; for (let x = 0; x < r.width; x++) if (r.data[(y * r.width + x) * 4] === 0) { let n = 0; while (x + n < r.width && r.data[(y * r.width + x + n) * 4] === 0) n++; if (n >= 21 && n < 300) { x0 = n; break; } x += n; } if (x0 > 0) return x0; } } return 0; };
  const itemCode = 'clarityflow://item/AbCdEfGhIjKlMnOpQrSt.UvWxYz0123456789AbCd.2.1.0123456789abcdef';
  for (const dots of [576, 384]) {
    const sp = (await PP.slipPicture(S.stickerDoc(S.stickerOf(order, { item: 'Oat latte', choiceList: ['Large', 'extra shot'], note: 'Half sweet' }, ['Allergy: tree nuts'], 2, 2, itemCode, 'J')), dots))!;
    const lp = (await PP.slipPicture(lab, dots))!;
    const rp = (await PP.slipPicture(receipt, dots))!;
    const fw = finder(sp.png);
    check(`${dots} dots: a sticker’s, a label’s and a receipt’s codes scan from the picture`, scan(sp.png) === itemCode && scan(lp.png) === 'clarityflow://bag/o1.1.0123456789abcdef' && scan(rp.png) === 'https://app.test/r/abc', { s: scan(sp.png), l: scan(lp.png), r: scan(rp.png) });
    check(`…each square whole dots (${dots === 576 ? 'at least 4' : 'at least 3'})`, fw > 0 && fw % 7 === 0 && fw / 7 >= (dots === 576 ? 4 : 3), fw);
  }
  check('letters it can’t draw: accents off where it lacks them, emoji left out, "?" for the rest', PP.drawable('Łukasz’s café 🎉 extra hot') === 'Lukasz’s café  extra hot' && PP.drawable('Şükrü') === 'Sükrü' && PP.drawable('Анна') === '????' && PP.drawable('👍🏽 ok') === ' ok' && PP.drawable('no\nnewline') === 'no newline');
  const odd = await PP.slipPicture({ blocks: [{ k: 'head', left: 'D9' }, { k: 'alert', text: 'Allergy: орехи' }] }, 576, 'job-odd');
  check('…an allergy line with one still draws, and says to look at the screen', !!odd && odd.height > 100);
  const longHead = (await PP.slipPicture({ blocks: [{ k: 'head', left: 'Patio corner table by the window, second row' }, { k: 'alert', text: 'Allergy: sesame' }] }, 576))!;
  const lr = PNG.sync.read(longHead.png); let bottom = 0; for (let y = lr.height - 1; y >= 0 && !bottom; y--) for (let x = 0; x < 576; x++) if (lr.data[(y * 576 + x) * 4] === 0) { bottom = y; break; }
  check('a slip taller than first thought is drawn again taller: nothing at the bottom cut off', longHead.height > 420 && lr.height - bottom >= 10, { h: longHead.height, bottom });
  const huge = { blocks: Array.from({ length: 260 }, (_, i) => ({ k: 'item' as const, qty: 1, name: `Item ${i} with a long name that wraps onto a second line of the slip`, sub: ['No onion'] })) };
  check('…and one far too long for one picture isn’t drawn (it prints in the printer’s own letters)', (await PP.slipPicture(huge, 576)) === null);
  const ep = src('src/app/api/printer/epson/[tenantId]/[printerId]/[key]/route.ts');
  check('…an Epson then gets its letters', /pic \? eposPicture\(pic, doc\) : renderEpos\(doc, p\.cols\)/.test(ep));

  console.log('the printers and the tablet');
  const star = src('src/app/api/printer/star/[tenantId]/[printerId]/[key]/route.ts'), epson = src('src/app/api/printer/epson/[tenantId]/[printerId]/[key]/route.ts');
  check('a Star is offered a picture first, plain text if it can’t, and a slip that couldn’t be drawn goes as text next time (kept on the slip)', /mediaTypes: textOnly \? \['text\/plain'\] : \['image\/png', 'text\/plain'\]/.test(star) && /if \(!png\) \{ await noPictureFor\(a\.db, a\.T, j\.id\)/.test(star) && /j\.noPicture \|\| !j\.doc\?\.blocks\?\.length/.test(star));
  check('both printers’ addresses run on Node (the picture needs it)', [star, epson].every((f) => /export const runtime = 'nodejs';/.test(f)));
  check('an Epson gets the picture, or its own letters if it can’t be drawn', /pic \? eposPicture\(pic, doc\) : renderEpos\(doc, p\.cols\)/.test(epson) && /\.catch\(\(e\) => \{ console\.error\('\[printer epson\] picture'/.test(epson));
  const html = P.renderHtml({ blocks: [{ k: 'brand', name: 'Juniper Coffee' }, { k: 'head', left: 'D14', mark: 'J' }, { k: 'alert', text: 'Allergy: peanuts' }] }, { font: 'x', fontHref: 'y' });
  check('the tablet’s own print in the same look: the tile, the number heavy, the allergy in a rounded black band', /background:#000;color:#fff;font-weight:800/.test(html) && /font-size:30px;font-weight:800/.test(html) && /background:#000;color:#fff;font-weight:700;padding:5px 9px;margin:4px 0;border-radius:8px/.test(html));
  const sheets = src('src/components/drive-thru/BagSheets.tsx');
  check('…and bag labels printed from a tablet', /initialOf\(l\.business\) \? tile\(initialOf\(l\.business\)\)/.test(sheets) && /font-size:34px;font-weight:800/.test(sheets));
  check('the typeface is the app’s, kept with its license', /SIL Open Font License/.test(src('src/lib/print-fonts.ts')) && /name: 'PJS'/.test(src('src/lib/print-picture.tsx')));
  for (const f of ['src/lib/print-picture.tsx', 'src/lib/printing.ts']) check(`${f}: no uppercase, no " · "`, !/\buppercase\b/.test(src(f)) && !/ · /.test(src(f)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
