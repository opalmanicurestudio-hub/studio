import { NextRequest, NextResponse } from 'next/server';

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

function initPrinter()    { return Buffer.from([ESC, 0x40]); }
function cutPaper()       { return Buffer.from([GS, 0x56, 0x41, 0x00]); }
function alignLeft()      { return Buffer.from([ESC, 0x61, 0x00]); }
function alignCenter()    { return Buffer.from([ESC, 0x61, 0x01]); }
function boldOn()         { return Buffer.from([ESC, 0x45, 0x01]); }
function boldOff()        { return Buffer.from([ESC, 0x45, 0x00]); }
function sizeNormal()     { return Buffer.from([GS,  0x21, 0x00]); }
function sizeLarge()      { return Buffer.from([GS,  0x21, 0x11]); }
function sizeWide()       { return Buffer.from([GS,  0x21, 0x10]); }
function feedLines(n = 1) { return Buffer.alloc(n, LF); }
function text(str: string){ return Buffer.from(str + '\n', 'utf8'); }
function divider()        { return text('--------------------------------'); }

type LabelLine = {
  content:  string;
  size?:    'normal' | 'large' | 'wide';
  bold?:    boolean;
  align?:   'left' | 'center' | 'right';
  divider?: boolean;
};

export type LabelPayload = {
  lines:      LabelLine[];
  cut?:       boolean;
  printerIp?:   string;
  printerPort?: number;
};

function buildEscPos(payload: LabelPayload): Buffer {
  const parts: Buffer[] = [initPrinter(), feedLines(1)];

  for (const line of payload.lines) {
    if (line.divider) {
      parts.push(alignLeft(), sizeNormal(), boldOff(), divider());
      continue;
    }
    if (line.align === 'center') parts.push(alignCenter());
    else                         parts.push(alignLeft());

    if (line.size === 'large')   parts.push(sizeLarge());
    else if (line.size === 'wide') parts.push(sizeWide());
    else                         parts.push(sizeNormal());

    parts.push(line.bold ? boldOn() : boldOff());
    parts.push(text(line.content ?? ''));
  }

  parts.push(sizeNormal(), boldOff(), alignLeft(), feedLines(3));
  if (payload.cut !== false) parts.push(cutPaper());
  return Buffer.concat(parts);
}

export async function POST(req: NextRequest) {
  const body: LabelPayload = await req.json();

  if (!body?.lines?.length) {
    return NextResponse.json({ error: 'No label lines provided' }, { status: 400 });
  }

  const printerIp   = body.printerIp   || process.env.THERMAL_PRINTER_IP;
  const printerPort = body.printerPort || Number(process.env.THERMAL_PRINTER_PORT || 9100);
  const escpos      = buildEscPos(body);

  if (!printerIp) {
    console.log('[THERMAL LABEL] No printer IP — label logged only.');
    console.log('[THERMAL LABEL]', body.lines.map(l => l.content).join(' | '));
    return NextResponse.json({ ok: true, note: 'THERMAL_PRINTER_IP not set; label logged to console.' });
  }

  try {
    const net = await import('net');
    await new Promise<void>((resolve, reject) => {
      const client = new net.Socket();
      client.connect(printerPort, printerIp, () => {
        client.write(escpos, () => { client.destroy(); resolve(); });
      });
      client.on('error', reject);
      client.setTimeout(5000, () => {
        client.destroy();
        reject(new Error(`Printer at ${printerIp}:${printerPort} timed out`));
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
