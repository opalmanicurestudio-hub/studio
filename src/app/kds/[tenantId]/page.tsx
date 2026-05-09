'use client';

import React, {
  useState, useMemo, useEffect, useRef, Suspense, useCallback,
} from 'react';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Coffee, CheckCircle2, Loader, MapPin, Star, ArrowRight, XCircle,
  Eye, ChefHat, Zap, Volume2, VolumeX, Timer, User, Bell, Activity,
  TrendingUp, Printer, LogOut, RefreshCw, Delete, Utensils, Settings,
  Wifi, Monitor,
} from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import {
  collection, doc, writeBatch, increment, arrayUnion, query, where, updateDoc,
} from 'firebase/firestore';
import { cn, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import { format, differenceInSeconds } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { type InventoryItem, type Tenant, type Staff } from '@/lib/data';

// ─── Constants ────────────────────────────────────────────────────────────────
const INACTIVITY_MS = 30 * 60 * 1000;
const FIFO_BADGES = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];

type TicketSource = 'refreshment' | 'event';

const getTicketSource = (r: any): TicketSource =>
  r.source === 'event' ? 'event' : 'refreshment';

const getCollection = (r: any) =>
  getTicketSource(r) === 'event' ? 'kdsTickets' : 'refreshmentRequests';

const normaliseTicket = (r: any) => ({
  ...r,
  _displayName:    r.clientName    || r.guestName    || 'Guest',
  _displayItem:    r.itemName      || r.menuItemName || 'Item',
  _displayStation: r.stationName
    || (r.tableNumber
      ? `Table ${r.tableNumber}${r.seatNumber ? ` · Seat ${r.seatNumber}` : ''}`
      : 'Lounge'),
  _itemId:         r.itemId        || r.menuItemId   || null,
  _quantity:       safeNumber(r.quantity) || 1,
  _source:         getTicketSource(r),
});

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') return new Date(val);
  return new Date(val);
};

const sanitize = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitize(v)])
  );
};

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function urgencyLevel(s: number): 'fresh' | 'warm' | 'hot' | 'critical' {
  if (s < 120) return 'fresh';
  if (s < 300) return 'warm';
  if (s < 480) return 'hot';
  return 'critical';
}

const URGENCY = {
  fresh:    { bar: 'bg-emerald-400', border: 'border-slate-200',  glow: '',                                                     label: 'bg-emerald-100 text-emerald-700' },
  warm:     { bar: 'bg-amber-400',   border: 'border-amber-300',  glow: '',                                                     label: 'bg-amber-100 text-amber-700'     },
  hot:      { bar: 'bg-orange-500',  border: 'border-orange-400', glow: 'shadow-[0_0_20px_rgba(249,115,22,0.25)]',              label: 'bg-orange-100 text-orange-700'   },
  critical: { bar: 'bg-red-500',     border: 'border-red-500',    glow: 'shadow-[0_0_30px_rgba(239,68,68,0.35)] animate-pulse', label: 'bg-red-100 text-red-700'         },
};

function getInitials(name?: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Printer config ───────────────────────────────────────────────────────────
type PrinterMode = 'network' | 'browser';

type PrinterConfig = {
  mode:  PrinterMode;
  ip:    string;
  port:  number;
};

const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  mode: 'browser',
  ip:   '',
  port: 9100,
};

function loadPrinterConfig(): PrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_PRINTER_CONFIG;
  try {
    const raw = localStorage.getItem('kds_printer_config');
    if (raw) return { ...DEFAULT_PRINTER_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PRINTER_CONFIG;
}

function savePrinterConfig(cfg: PrinterConfig) {
  try { localStorage.setItem('kds_printer_config', JSON.stringify(cfg)); } catch {}
}

// ─── Label types ──────────────────────────────────────────────────────────────
type LabelLine = {
  content:  string;
  size?:    'normal' | 'large' | 'wide';
  bold?:    boolean;
  align?:   'left' | 'center' | 'right';
  divider?: boolean;
};

type LabelPayload = {
  lines: LabelLine[];
  cut?:  boolean;
};

// ─── Build label payload ──────────────────────────────────────────────────────
function buildLabel(
  request: any,
  staff: Staff,
  fifoIndex: number,
  ingredients: { name: string; totalNeeded: string; unit: string }[],
): LabelPayload {
  const orderId   = (request.id ?? '').slice(-6).toUpperCase();
  const guestName = (request._displayName   ?? 'Guest').toUpperCase();
  const itemName  = (request._displayItem   ?? 'Item').toUpperCase();
  const qty       = request._quantity || 1;
  const station   = (request._displayStation || 'Lounge').toUpperCase();
  const initials  = getInitials(staff.name);
  const timeStr   = format(safeDate(request.requestedAt || request.createdAt), 'h:mm a');
  const fifo      = fifoIndex + 1;

  const lines: LabelLine[] = [
    { content: `#${fifo}  ${itemName}`,   size: 'large',  bold: true,  align: 'left' },
    { content: `x${qty}  ${guestName}`,    size: 'wide',   bold: true,  align: 'left' },
    { content: `${station}  ${timeStr}`,   size: 'normal', bold: false, align: 'left' },
    { divider: true },
  ];

  if (ingredients.length > 0) {
    lines.push({ content: 'INGREDIENTS:', size: 'normal', bold: true, align: 'left' });
    ingredients.slice(0, 4).forEach(f => {
      lines.push({
        content: `  ${f.totalNeeded}${f.unit}  ${(f.name ?? '').toUpperCase()}`,
        size: 'normal', bold: false, align: 'left',
      });
    });
    lines.push({ divider: true });
  }

  lines.push({
    content: `STAFF: ${initials}   ORDER: ${orderId}`,
    size: 'normal', bold: false, align: 'left',
  });

  return { lines, cut: true };
}

// ─── Network print (TCP via API route) ───────────────────────────────────────
async function networkPrint(payload: LabelPayload, cfg: PrinterConfig): Promise<void> {
  const res = await fetch('/api/thermal-print', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...payload, printerIp: cfg.ip, printerPort: cfg.port }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Print relay error: ${res.status}`);
  }
}

// ─── Browser print (OS print dialog — USB / Bluetooth / any local printer) ───
function buildPrintHtml(payload: LabelPayload): string {
  const lines = payload.lines.map(line => {
    if (line.divider) {
      return `<hr style="border:none;border-top:1px dashed #aaa;margin:5px 0;">`;
    }
    const size =
      line.size === 'large' ? '18px' :
      line.size === 'wide'  ? '14px' : '11px';
    const weight  = line.bold ? '900' : '400';
    const spacing = line.size === 'wide' ? 'letter-spacing:1px;' : '';
    const align   = line.align === 'center' ? 'text-align:center;' : '';
    return `<div style="font-size:${size};font-weight:${weight};${spacing}${align}line-height:1.4;margin:1px 0;">${line.content}</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Label</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Courier New', monospace; width:72mm; padding:4px 6px; background:#fff; color:#000; }
  @media print {
    @page { margin:0; size:80mm auto; }
    body  { width:80mm; }
  }
</style>
</head>
<body>${lines}<div style="height:16px"></div></body>
</html>`;
}

function browserPrint(payload: LabelPayload): void {
  const html = buildPrintHtml(payload);
  const w = window.open('', '_blank', 'width=420,height=520,toolbar=0,menubar=0,location=0');
  if (!w) { alert('Please allow popups for this page to use browser printing.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); w.close(); };
}

// ─── Printer Settings Dialog ──────────────────────────────────────────────────
const PrinterSettingsDialog = ({
  open, onOpenChange, config, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: PrinterConfig;
  onSave: (cfg: PrinterConfig) => void;
}) => {
  const [mode, setMode] = useState<PrinterMode>(config.mode);
  const [ip,   setIp]   = useState(config.ip);
  const [port, setPort] = useState(String(config.port));

  useEffect(() => {
    if (open) { setMode(config.mode); setIp(config.ip); setPort(String(config.port)); }
  }, [open, config]);

  const handleSave = () => {
    onSave({ mode, ip: ip.trim(), port: Number(port) || 9100 });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm rounded-[2rem] border-4 p-0 overflow-hidden flex flex-col max-h-[90dvh]">
        <DialogHeader className="flex-shrink-0 p-6 pb-4 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-2 mb-1">
            <Printer className="w-4 h-4 text-primary" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground">Thermal Printer</span>
          </div>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-slate-900">Printer Setup</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
            Stored on this device only. Each KDS device can have its own printer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
          {/* Mode selector */}
          <div className="space-y-3">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Print Method</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('browser')}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all',
                  mode === 'browser' ? 'border-primary bg-primary/5 shadow-md' : 'border-border bg-background hover:border-primary/20'
                )}
              >
                <Monitor className={cn('w-6 h-6', mode === 'browser' ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                <span className="text-[10px] font-black uppercase tracking-widest">Browser</span>
                <span className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-center leading-tight">USB · Bluetooth · Any local printer</span>
              </button>
              <button
                onClick={() => setMode('network')}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all',
                  mode === 'network' ? 'border-primary bg-primary/5 shadow-md' : 'border-border bg-background hover:border-primary/20'
                )}
              >
                <Wifi className={cn('w-6 h-6', mode === 'network' ? 'text-primary' : 'text-muted-foreground opacity-40')} />
                <span className="text-[10px] font-black uppercase tracking-widest">Network</span>
                <span className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-center leading-tight">LAN IP · Direct TCP · Port 9100</span>
              </button>
            </div>
          </div>

          {/* Mode descriptions */}
          {mode === 'browser' && (
            <div className="p-4 rounded-2xl bg-blue-50 border-2 border-blue-100 space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">How it works</p>
              <p className="text-[10px] font-bold text-blue-600 leading-relaxed">
                Clicking Print Label opens your OS print dialog. Select your thermal printer from the list — works with any printer your device can see including USB, Bluetooth, and network printers already added to your OS.
              </p>
            </div>
          )}

          {mode === 'network' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-100 space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">How it works</p>
                <p className="text-[10px] font-bold text-amber-600 leading-relaxed">
                  Sends ESC/POS commands directly to your printer over your local network. The printer must have a static LAN IP. Print a test page from the printer to find its IP address.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="printer-ip" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Printer IP Address</Label>
                <Input
                  id="printer-ip"
                  value={ip}
                  onChange={e => setIp(e.target.value)}
                  placeholder="192.168.1.xxx"
                  className="h-12 rounded-2xl border-2 font-mono font-black text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="printer-port" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Port (default 9100)</Label>
                <Input
                  id="printer-port"
                  value={port}
                  onChange={e => setPort(e.target.value)}
                  placeholder="9100"
                  className="h-12 rounded-2xl border-2 font-mono font-black text-sm"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 p-6 pt-4 border-t bg-muted/5">
          <div className="grid grid-cols-2 gap-3 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)}
              className="h-12 font-black uppercase text-[10px] tracking-widest text-slate-400">
              Cancel
            </Button>
            <Button onClick={handleSave}
              className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
              Save Settings
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Label Preview Dialog ─────────────────────────────────────────────────────
const LabelPreviewDialog = ({
  open, onOpenChange, payload, onConfirm, isPrinting, printerConfig,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: LabelPayload | null;
  onConfirm: () => void;
  isPrinting: boolean;
  printerConfig: PrinterConfig;
}) => {
  if (!payload) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm rounded-[2rem] border-4 p-0 overflow-hidden flex flex-col max-h-[90dvh]">
        <DialogHeader className="flex-shrink-0 p-6 pb-4 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-2 mb-1">
            <Printer className="w-4 h-4 text-primary" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground">Label Preview</span>
          </div>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-slate-900">Review Before Printing</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
            {printerConfig.mode === 'network'
              ? `Network · ${printerConfig.ip || 'No IP set'}:${printerConfig.port}`
              : 'Browser · OS print dialog'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {/* Thermal receipt simulation */}
          <div
            className="mx-auto bg-white border-2 border-dashed border-slate-200 rounded-xl p-4 shadow-inner"
            style={{ fontFamily: "'Courier New', monospace", maxWidth: '280px' }}
          >
            {/* Sprocket holes */}
            <div className="flex justify-between mb-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-slate-200" />
              ))}
            </div>

            {payload.lines.map((line, i) => {
              if (line.divider) {
                return <div key={i} className="border-t-2 border-dashed border-slate-300 my-2" />;
              }
              return (
                <div
                  key={i}
                  className={cn(
                    'leading-tight py-0.5',
                    line.align === 'center' && 'text-center',
                    line.align === 'right'  && 'text-right',
                    line.bold               && 'font-black',
                    line.size === 'large'   && 'text-xl font-black',
                    line.size === 'wide'    && 'text-base font-black tracking-wide',
                    (!line.size || line.size === 'normal') && 'text-xs',
                  )}
                >
                  {line.content}
                </div>
              );
            })}

            <div className="h-6" />
            <div className="flex items-center gap-2 opacity-30">
              <div className="flex-1 border-t-2 border-dashed border-slate-400" />
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">CUT</span>
              <div className="flex-1 border-t-2 border-dashed border-slate-400" />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 p-6 pt-4 border-t bg-muted/5">
          <div className="grid grid-cols-2 gap-3 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPrinting}
              className="h-12 font-black uppercase text-[10px] tracking-widest text-slate-400">
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={isPrinting}
              className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
              {isPrinting
                ? <><Loader className="w-4 h-4 mr-2 animate-spin" />Printing...</>
                : <><Printer className="w-4 h-4 mr-2" />Print Label</>
              }
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Allergy pill ─────────────────────────────────────────────────────────────
const AllergyPill = ({ allergy }: { allergy: any }) => {
  const label    = typeof allergy === 'object' ? allergy.label    : allergy;
  const severity = typeof allergy === 'object' ? allergy.severity : 'preference';
  if (severity === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-[9px] font-black uppercase tracking-wide text-red-800">
        ⚠ {label}
      </span>
    );
  }
  if (severity === 'intolerance') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[9px] font-black uppercase tracking-wide text-amber-700">
        ⚠ {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[9px] font-black uppercase tracking-wide text-slate-600">
      {label}
    </span>
  );
};

// ─── PIN Numpad Login ─────────────────────────────────────────────────────────
const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

const PinLogin = ({ staff, onLogin }: { staff: Staff[]; onLogin: (m: Staff) => void }) => {
  const [pin, setPin]         = useState('');
  const [shake, setShake]     = useState(false);
  const [welcome, setWelcome] = useState<Staff | null>(null);

  const press = (key: string) => {
    if (key === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) {
      const found = staff.find(s => s.pin === next);
      if (found) {
        setWelcome(found);
        setTimeout(() => onLogin(found), 500);
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setPin(''); }, 600);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex items-center justify-center">
      <motion.div
        animate={shake ? { x: [0,-12,12,-8,8,0] } : {}}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center gap-8 w-full max-w-xs px-6"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center">
            <ChefHat className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-black text-2xl uppercase tracking-tighter text-white">KDS Login</h1>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Enter your staff PIN</p>
        </div>
        <div className="flex gap-4">
          {[0,1,2,3].map(i => (
            <motion.div key={i} animate={{ scale: pin.length > i ? 1.25 : 1 }}
              className={cn('w-4 h-4 rounded-full border-2 transition-colors duration-150',
                pin.length > i
                  ? shake ? 'bg-red-500 border-red-500' : 'bg-primary border-primary'
                  : 'bg-transparent border-slate-600'
              )} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 w-full">
          {PIN_KEYS.map((key, i) => (
            <button key={i} onClick={() => key && press(key)} disabled={!key}
              className={cn('h-16 rounded-2xl font-black text-2xl transition-all active:scale-95 select-none',
                key === '⌫' ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  : key ? 'bg-slate-800 text-white hover:bg-slate-700 shadow-lg shadow-black/30'
                  : 'opacity-0 pointer-events-none'
              )}>
              {key === '⌫' ? <Delete className="w-5 h-5 mx-auto" /> : key}
            </button>
          ))}
        </div>
        <AnimatePresence>
          {welcome && (
            <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
              Welcome, {welcome.name.split(' ')[0]} ✓
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

// ─── Inactivity Logout Hook ───────────────────────────────────────────────────
function useInactivityLogout(onLogout: () => void, ms = INACTIVITY_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onLogout, ms);
  }, [onLogout, ms]);
  useEffect(() => {
    const events = ['mousemove','mousedown','keydown','touchstart','scroll'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reset]);
}

// ─── Elapsed Timer Hook ───────────────────────────────────────────────────────
function useElapsed(startDate: Date) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(differenceInSeconds(new Date(), startDate));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startDate]);
  return elapsed;
}

// ─── Claimer Badge ────────────────────────────────────────────────────────────
const ClaimerBadge = ({ claimedByName, isMe, onReassign }: {
  claimedByName: string; isMe: boolean; onReassign: () => void;
}) => (
  <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest',
    isMe ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-500')}>
    <div className={cn('w-5 h-5 rounded-lg flex items-center justify-center text-[8px] font-black text-white shrink-0',
      isMe ? 'bg-primary' : 'bg-slate-400')}>
      {getInitials(claimedByName)}
    </div>
    <span>{isMe ? 'You' : claimedByName.split(' ')[0]}</span>
    {!isMe && (
      <button onClick={onReassign} className="ml-1 text-slate-400 hover:text-primary transition-colors">
        <RefreshCw className="w-3 h-3" />
      </button>
    )}
  </div>
);

// ─── Ticket Card ──────────────────────────────────────────────────────────────
const TicketCard = ({
  request, inventory, onClaim, onMarkReady, onDeliver, onCancel,
  onReassign, onPreviewPrint, lane, fifoIndex, currentStaff,
}: {
  request: any; inventory: InventoryItem[];
  onClaim: (id: string) => void; onMarkReady: (req: any) => void;
  onDeliver: (req: any) => void; onCancel: (id: string) => void;
  onReassign: (id: string) => void;
  onPreviewPrint: (req: any, fifoIndex: number) => void;
  lane: 'incoming' | 'prep' | 'ready'; fifoIndex: number; currentStaff: Staff;
}) => {
  const startDate     = safeDate(request.requestedAt || request.createdAt);
  const elapsed       = useElapsed(startDate);
  const urgency       = urgencyLevel(elapsed);
  const styles        = URGENCY[urgency];
  const qty           = request._quantity || 1;
  const item          = inventory.find(i => i.id === request._itemId);
  const fifoBadge     = FIFO_BADGES[fifoIndex] ?? `(${fifoIndex + 1})`;
  const claimedByName = request.claimedBy?.name ?? null;
  const isClaimedByMe = request.claimedBy?.staffId === currentStaff.id;
  const isEventTicket = request._source === 'event';
  const allergies: any[] = request.allergies || [];
  const hasCritical = allergies.some((a: any) => typeof a === 'object' && a.severity === 'critical');

  const ingredients = useMemo(() => {
    if (!item?.formula || item.formula.length === 0) return [];
    return item.formula.map((f: any) => ({
      ...f, totalNeeded: (safeNumber(f.quantityUsed) * qty).toFixed(1),
    }));
  }, [item, qty]);

  return (
    <motion.div layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.93, y: -10 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className={cn(
        'relative rounded-[1.75rem] border-2 bg-white overflow-hidden transition-shadow duration-500',
        styles.border, styles.glow,
        lane === 'prep' && claimedByName && !isClaimedByMe && 'opacity-70'
      )}>
      <div className={cn('absolute top-0 left-0 right-0 h-1.5', styles.bar)} />
      {isEventTicket && <div className="absolute top-0 left-0 right-0 h-1.5 bg-indigo-500" />}

      <div className="px-5 pt-6 pb-3 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xl leading-none select-none">{fifoBadge}</span>
            <span className="font-black text-[10px] uppercase tracking-[0.25em] text-slate-400">
              #{(request.id ?? '').slice(-5).toUpperCase()}
            </span>
            {isEventTicket && (
              <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 font-black text-[8px] uppercase tracking-widest h-4 px-2">
                <Utensils className="w-2 h-2 mr-1" />
                {request.courseNumber ? `Course ${request.courseNumber}` : 'Event'}
              </Badge>
            )}
            {request.isRedemption && (
              <Badge className="bg-indigo-600 text-white border-none font-black text-[8px] uppercase tracking-widest h-4 px-2">
                <Star className="w-2 h-2 mr-1 fill-current" /> Perk
              </Badge>
            )}
            {request.isGuestKiosk && (
              <Badge className="bg-amber-500 text-white border-none font-black text-[8px] uppercase tracking-widest h-4 px-2">
                Lounge
              </Badge>
            )}
            {safeNumber(request.priceAtRequest) > 0 && !request.isRedemption && (
              <Badge className="bg-emerald-600 text-white border-none font-black text-[8px] uppercase tracking-widest h-4 px-2">
                ${(safeNumber(request.priceAtRequest) * qty).toFixed(2)}
              </Badge>
            )}
            {hasCritical && (
              <Badge className="bg-red-500 text-white border-none font-black text-[8px] uppercase tracking-widest h-4 px-2 animate-pulse">
                ⚠ ALLERGY
              </Badge>
            )}
          </div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
            {format(startDate, 'h:mm:ss a')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className={cn('px-3 py-1.5 rounded-xl font-black font-mono text-sm tabular-nums', styles.label)}>
            {formatElapsed(elapsed)}
          </div>
          {lane !== 'incoming' && (
            <button
              onClick={() => onPreviewPrint(request, fifoIndex)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest text-slate-400 hover:text-primary hover:bg-primary/5 transition-all"
            >
              <Printer className="w-3 h-3" /> Label
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pb-3 flex items-center gap-4">
        <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200">
          {item?.imageUrl ? (
            <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
          ) : isEventTicket ? (
            <Utensils className="w-6 h-6 text-indigo-300" />
          ) : (
            <Coffee className="w-6 h-6 text-slate-300" />
          )}
          {qty > 1 && (
            <div className="absolute -top-1.5 -right-1.5 bg-slate-900 text-white rounded-full w-5 h-5 flex items-center justify-center font-black text-[10px] border-2 border-white">
              {qty}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-black text-xl uppercase tracking-tighter text-slate-900 leading-none truncate">
            {request._displayItem}
          </h3>
          {ingredients.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {ingredients.map((f: any, i: number) => (
                <span key={i} className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg border border-slate-200">
                  {f.totalNeeded}{f.unit} {f.name}
                </span>
              ))}
            </div>
          )}
          {isEventTicket && request.courseNumber && (
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mt-1">
              Course {request.courseNumber} · {request.eventTitle || 'Event'}
            </p>
          )}
        </div>
      </div>

      <div className="mx-5 mb-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
            <User className="w-3 h-3" /> Guest
          </span>
          <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">
            {request._displayName}
          </span>
          <span className="text-slate-300">·</span>
          <span className="text-[9px] font-black text-primary uppercase flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {request._displayStation}
          </span>
        </div>
        {allergies.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-200">
            {allergies.map((a: any, i: number) => (
              <AllergyPill key={i} allergy={a} />
            ))}
          </div>
        )}
        {claimedByName && (
          <div className="flex items-center gap-2 pt-1.5 border-t border-slate-200">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Staff:</span>
            <ClaimerBadge
              claimedByName={claimedByName}
              isMe={isClaimedByMe}
              onReassign={() => onReassign(request.id)}
            />
          </div>
        )}
        {(request.guestDescription || request.notes) && (
          <div className="space-y-1.5 pt-1 border-t border-slate-200">
            {request.guestDescription && (
              <p className="text-[9px] font-black text-indigo-600 uppercase flex items-center gap-1.5 tracking-widest">
                <Eye className="w-3 h-3" />{request.guestDescription}
              </p>
            )}
            {request.notes && (
              <p className="text-[9px] font-medium text-slate-500 italic leading-relaxed border-l-2 border-slate-300 pl-2">
                "{request.notes}"
              </p>
            )}
          </div>
        )}
        {request.allergyNote && (
          <div className="pt-1 border-t border-slate-200">
            <p className="text-[9px] font-bold text-amber-700 italic leading-relaxed">
              Note: {request.allergyNote}
            </p>
          </div>
        )}
      </div>

      <div className="px-5 pb-5 flex gap-2">
        {lane === 'incoming' && (
          <>
            <Button variant="outline" size="sm" onClick={() => onCancel(request.id)}
              className="h-10 w-10 rounded-xl p-0 border-2 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-all shrink-0">
              <XCircle className="w-4 h-4" />
            </Button>
            <Button size="sm" onClick={() => onClaim(request.id)}
              className="h-10 flex-1 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] shadow-lg shadow-primary/20">
              <ChefHat className="w-3.5 h-3.5 mr-2" /> Claim & Prep
            </Button>
          </>
        )}
        {lane === 'prep' && (
          <>
            <Button variant="outline" size="sm" onClick={() => onCancel(request.id)}
              className="h-10 w-10 rounded-xl p-0 border-2 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-all shrink-0">
              <XCircle className="w-4 h-4" />
            </Button>
            <Button size="sm" onClick={() => onMarkReady(request)}
              className={cn('h-10 flex-1 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] shadow-lg',
                isClaimedByMe || !claimedByName
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                  : 'bg-slate-200 text-slate-500 hover:bg-emerald-600 hover:text-white shadow-none')}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
              {!claimedByName || isClaimedByMe ? 'Mark Ready' : `Mark Ready (${getInitials(claimedByName)})`}
            </Button>
          </>
        )}
        {lane === 'ready' && (
          <Button size="sm" onClick={() => onDeliver(request)}
            className="h-10 flex-1 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] shadow-lg shadow-primary/20 animate-pulse">
            <ArrowRight className="w-3.5 h-3.5 mr-2" /> Certify Delivery
          </Button>
        )}
      </div>
    </motion.div>
  );
};

// ─── Lane Column ──────────────────────────────────────────────────────────────
const LaneColumn = ({ title, icon: Icon, count, children, accentClass, emptyLabel }: {
  title: string; icon: React.ElementType; count: number;
  children: React.ReactNode; accentClass: string; emptyLabel: string;
}) => (
  <div className="flex flex-col gap-4 min-w-0">
    <div className="flex items-center justify-between px-1">
      <div className="flex items-center gap-2.5">
        <div className={cn('p-2 rounded-xl', accentClass)}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="font-black text-[11px] uppercase tracking-[0.25em] text-slate-700">{title}</span>
      </div>
      <span className={cn('font-black font-mono text-sm w-8 h-8 rounded-xl flex items-center justify-center',
        count > 0 ? accentClass : 'bg-slate-100 text-slate-400')}>
        {count}
      </span>
    </div>
    <div className="h-px bg-slate-200/80" />
    <div className="space-y-4 flex-1">
      <AnimatePresence mode="popLayout">
        {count === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="py-16 flex flex-col items-center gap-3 text-slate-300 border-2 border-dashed border-slate-200 rounded-[2rem]">
            <Icon className="w-8 h-8" />
            <p className="text-[9px] font-black uppercase tracking-[0.3em]">{emptyLabel}</p>
          </motion.div>
        ) : children}
      </AnimatePresence>
    </div>
  </div>
);

// ─── Stats Bar ────────────────────────────────────────────────────────────────
const StatsBar = ({ requests }: { requests: any[] }) => {
  const stats = useMemo(() => {
    const safeRequests = requests ?? [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayReqs = safeRequests.filter(r => safeDate(r.requestedAt || r.createdAt) >= today);
    const delivered = todayReqs.filter(r => r.status === 'delivered');
    const waitTimes = delivered.map(r =>
      Math.max(0, differenceInSeconds(safeDate(r.deliveredAt), safeDate(r.requestedAt || r.createdAt)))
    );
    const avgWait = waitTimes.length
      ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;
    const itemCount: Record<string, number> = {};
    safeRequests.forEach(r => {
      const name = r.itemName || r.menuItemName || '?';
      itemCount[name] = (itemCount[name] || 0) + 1;
    });
    const topItem = Object.entries(itemCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    return {
      total: todayReqs.length,
      delivered: delivered.length,
      pending: todayReqs.filter(r => r.status === 'pending').length,
      avgWait: formatElapsed(avgWait),
      topItem,
    };
  }, [requests]);

  const items = [
    { label: 'Today',     value: stats.total,     icon: Activity     },
    { label: 'Delivered', value: stats.delivered, icon: CheckCircle2 },
    { label: 'Pending',   value: stats.pending,   icon: Timer        },
    { label: 'Avg Wait',  value: stats.avgWait,   icon: TrendingUp   },
    { label: 'Top Item',  value: stats.topItem,   icon: Star, truncate: true },
  ];

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white border-2 border-slate-100 shrink-0">
          <item.icon className="w-3.5 h-3.5 text-primary opacity-50 shrink-0" />
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 leading-none mb-0.5">{item.label}</p>
            <p className={cn('font-black text-sm text-slate-900 leading-none font-mono', item.truncate && 'max-w-[80px] truncate text-xs')}>
              {String(item.value)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN KDS
// ═══════════════════════════════════════════════════════════════════════════════
function KDSContent() {
  const { tenantId } = useParams() as { tenantId: string };
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const [currentStaff, setCurrentStaff]   = useState<Staff | null>(null);
  const handleLogout = useCallback(() => setCurrentStaff(null), []);
  useInactivityLogout(handleLogout);

  const [soundEnabled, setSoundEnabled]   = useState(true);
  const [lastCount, setLastCount]         = useState(0);
  const audioCtxRef                       = useRef<AudioContext | null>(null);

  // Printer config — loaded from localStorage per device
  const [printerConfig, setPrinterConfig] = useState<PrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);

  useEffect(() => { setPrinterConfig(loadPrinterConfig()); }, []);

  const handleSavePrinterConfig = (cfg: PrinterConfig) => {
    savePrinterConfig(cfg);
    setPrinterConfig(cfg);
    toast({ title: 'Printer Settings Saved', description: `Mode: ${cfg.mode === 'network' ? `Network · ${cfg.ip}` : 'Browser print dialog'}` });
  };

  // Label preview state
  const [previewOpen, setPreviewOpen]     = useState(false);
  const [previewPayload, setPreviewPayload] = useState<LabelPayload | null>(null);
  const [isPrinting, setIsPrinting]       = useState(false);

  // Data
  const tenantRef = useMemoFirebase(
    () => doc(firestore, `tenants/${tenantId}`),
    [firestore, tenantId]
  );
  const { data: tenant } = useDoc<Tenant>(tenantRef);

  const staffQuery = useMemoFirebase(
    () => collection(firestore, `tenants/${tenantId}/staff`),
    [firestore, tenantId]
  );
  const { data: staffListRaw } = useCollection<Staff>(staffQuery);
  const staffList = staffListRaw ?? [];

  const inventoryQuery = useMemoFirebase(
    () => collection(firestore, `tenants/${tenantId}/inventory`),
    [firestore, tenantId]
  );
  const { data: inventory = [] } = useCollection<InventoryItem>(inventoryQuery);

  const activeRefreshmentQuery = useMemoFirebase(
    () => query(
      collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
      where('status', 'in', ['pending', 'in_progress', 'ready'])
    ),
    [firestore, tenantId]
  );
  const { data: activeRefreshmentsRaw } = useCollection<any>(activeRefreshmentQuery);
  const activeRefreshments = (activeRefreshmentsRaw ?? []).map(normaliseTicket);

  const allRefreshmentQuery = useMemoFirebase(
    () => collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
    [firestore, tenantId]
  );
  const { data: allRefreshmentsRaw } = useCollection<any>(allRefreshmentQuery);
  const allRefreshments = allRefreshmentsRaw ?? [];

  const activeEventKdsQuery = useMemoFirebase(
    () => query(
      collection(firestore, `tenants/${tenantId}/kdsTickets`),
      where('status', 'in', ['pending', 'in_progress', 'ready'])
    ),
    [firestore, tenantId]
  );
  const { data: activeEventTicketsRaw } = useCollection<any>(activeEventKdsQuery);
  const activeEventTickets = (activeEventTicketsRaw ?? []).map(normaliseTicket);

  const allEventKdsQuery = useMemoFirebase(
    () => collection(firestore, `tenants/${tenantId}/kdsTickets`),
    [firestore, tenantId]
  );
  const { data: allEventTicketsRaw } = useCollection<any>(allEventKdsQuery);
  const allEventTickets = allEventTicketsRaw ?? [];

  const allActive = useMemo(
    () => [...activeRefreshments, ...activeEventTickets],
    [activeRefreshments, activeEventTickets]
  );

  const byTime = (a: any, b: any) =>
    safeDate(a.requestedAt || a.createdAt).getTime() -
    safeDate(b.requestedAt || b.createdAt).getTime();

  const incoming = useMemo(() => allActive.filter(r => r.status === 'pending').sort(byTime),     [allActive]);
  const prep     = useMemo(() => allActive.filter(r => r.status === 'in_progress').sort(byTime), [allActive]);
  const ready    = useMemo(() => allActive.filter(r => r.status === 'ready').sort(byTime),       [allActive]);

  const allRequests = useMemo(
    () => [...allRefreshments, ...allEventTickets],
    [allRefreshments, allEventTickets]
  );

  useEffect(() => {
    if (incoming.length > lastCount && lastCount !== 0 && soundEnabled) {
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ctx  = audioCtxRef.current;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880,  ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
      } catch (_) {}
    }
    setLastCount(incoming.length);
  }, [incoming.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaim = async (requestId: string) => {
    if (!firestore || !tenantId || !currentStaff) return;
    const request = allActive.find(r => r.id === requestId);
    if (!request) return;
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/${getCollection(request)}`, requestId), sanitize({
        status: 'in_progress',
        claimedBy: { staffId: currentStaff.id, name: currentStaff.name, initials: getInitials(currentStaff.name) },
        claimedAt: new Date().toISOString(),
      }));
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not claim order.' });
    }
  };

  const handleReassign = async (requestId: string) => {
    if (!firestore || !tenantId || !currentStaff) return;
    const request = allActive.find(r => r.id === requestId);
    if (!request) return;
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/${getCollection(request)}`, requestId), sanitize({
        claimedBy: { staffId: currentStaff.id, name: currentStaff.name, initials: getInitials(currentStaff.name) },
        reassignedAt: new Date().toISOString(),
      }));
      toast({ title: 'Reassigned', description: 'Order is now yours.' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not reassign.' });
    }
  };

  const handleMarkReady = async (request: any) => {
    if (!firestore || !tenantId) return;
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/${getCollection(request)}`, request.id), sanitize({
        status: 'ready', readyAt: new Date().toISOString(),
      }));
      toast({ title: 'Order Ready', description: `${request._displayItem} ready for ${request._displayName}.` });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update order.' });
    }
  };

  const handleDeliver = async (request: any) => {
    if (!firestore || !tenantId) return;
    const col = getCollection(request);
    const now = new Date().toISOString();
    const b   = writeBatch(firestore);
    const qty = request._quantity || 1;

    b.update(doc(firestore, `tenants/${tenantId}/${col}`, request.id), sanitize({
      status: 'delivered', deliveredAt: now,
      deliveredBy: currentStaff
        ? { staffId: currentStaff.id, name: currentStaff.name }
        : { staffId: user?.uid || 'kds' },
    }));

    if (request._source === 'refreshment' && request._itemId) {
      const item = inventory.find(i => i.id === request._itemId);
      if (item) {
        const ingredients = item.formula?.length
          ? item.formula.map((f: any) => ({ ...f, quantityUsed: safeNumber(f.quantityUsed) * qty }))
          : [{ id: item.id, name: item.name, quantityUsed: qty, unit: item.unit || 'unit' }];

        ingredients.forEach((ingredient: any) => {
          const product = inventory.find(p => p.id === ingredient.id);
          if (!product) return;
          const productRef  = doc(firestore, `tenants/${tenantId}/inventory`, product.id);
          const updateData: any = {};
          if (product.costingMethod === 'uses') {
            let uses  = safeNumber(product.partialContainerUses) - ingredient.quantityUsed;
            let stock = safeNumber(product.totalStock);
            const usesPerContainer = safeNumber(product.estimatedUses) || 1;
            while (uses <= 0 && stock > 0) { stock -= 1; uses += usesPerContainer; }
            if (stock <= 0) { stock = 0; uses = Math.max(0, uses); }
            updateData.totalStock = stock;
            updateData.partialContainerUses = uses;
          } else {
            updateData.totalStock = increment(-ingredient.quantityUsed);
          }
          b.update(productRef, sanitize(updateData));
          const corrRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
          b.set(corrRef, sanitize({
            id: nanoid(), productId: product.id, date: now,
            change: -ingredient.quantityUsed, unit: product.unit || 'unit',
            reason: `KDS Delivery: ${item.name} (x${qty}) — ${request._displayName}`,
            requestId: request.id,
          }));
        });

        if (request.isRedemption && request.clientId && request.clientId !== 'guest-walkin') {
          b.update(doc(firestore, `tenants/${tenantId}/clients`, request.clientId), {
            [`subscription.perkUsage.${request._itemId}`]: increment(qty),
            'subscription.perkLastUsed': now,
          });
        }
        if (request.appointmentId && request.appointmentId !== 'guest-walkin') {
          b.set(
            doc(firestore, `tenants/${tenantId}/appointments/${request.appointmentId}`),
            { checkoutState: { refreshments: arrayUnion(sanitize({
              id: item.id, name: item.name,
              price: safeNumber(request.priceAtRequest),
              deliveredAt: now, quantity: qty, isAccountedFor: true,
            })) } },
            { merge: true }
          );
        }
      }
    }

    try {
      await b.commit();
      toast({ title: 'Delivery Certified', description: `${request._displayItem} delivered to ${request._displayName}.` });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Delivery record failed.' });
    }
  };

  const handleCancel = async (requestId: string) => {
    if (!firestore || !tenantId) return;
    const request = allActive.find(r => r.id === requestId);
    if (!request) return;
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/${getCollection(request)}`, requestId), sanitize({
        status: 'cancelled', cancelledAt: new Date().toISOString(),
        cancelledBy: currentStaff
          ? { staffId: currentStaff.id, name: currentStaff.name }
          : { staffId: user?.uid || 'kds' },
      }));
      toast({ title: 'Order Cancelled' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not cancel order.' });
    }
  };

  const handlePreviewPrint = useCallback((request: any, fifoIndex: number) => {
    if (!currentStaff) return;
    const item = inventory.find(i => i.id === request._itemId);
    const qty  = request._quantity || 1;
    const ingredients = (item?.formula ?? []).map((f: any) => ({
      ...f, totalNeeded: (safeNumber(f.quantityUsed) * qty).toFixed(1),
    }));
    setPreviewPayload(buildLabel(request, currentStaff, fifoIndex, ingredients));
    setPreviewOpen(true);
  }, [currentStaff, inventory]);

  const handleConfirmPrint = useCallback(async () => {
    if (!previewPayload) return;
    setIsPrinting(true);
    try {
      if (printerConfig.mode === 'network') {
        // Try network first, fall back to browser print if it fails
        try {
          await networkPrint(previewPayload, printerConfig);
          toast({ title: 'Label Sent', description: `Sent to ${printerConfig.ip}` });
        } catch (networkErr: any) {
          toast({
            variant: 'destructive',
            title: 'Network Print Failed',
            description: `${networkErr.message} — opening browser print as fallback.`,
          });
          browserPrint(previewPayload);
        }
      } else {
        browserPrint(previewPayload);
        toast({ title: 'Print Dialog Opened', description: 'Select your thermal printer from the list.' });
      }
      setPreviewOpen(false);
    } finally {
      setIsPrinting(false);
    }
  }, [previewPayload, printerConfig, toast]);

  const totalActive = incoming.length + prep.length + ready.length;

  if (!currentStaff) {
    return <PinLogin staff={staffList} onLogin={m => setCurrentStaff(m)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-body flex flex-col overflow-hidden">

      <LabelPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        payload={previewPayload}
        onConfirm={handleConfirmPrint}
        isPrinting={isPrinting}
        printerConfig={printerConfig}
      />

      <PrinterSettingsDialog
        open={printerSettingsOpen}
        onOpenChange={setPrinterSettingsOpen}
        config={printerConfig}
        onSave={handleSavePrinterConfig}
      />

      {/* Top Bar */}
      <header className="shrink-0 bg-white border-b-2 border-slate-100 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="p-2.5 bg-primary/10 rounded-2xl shrink-0">
            <ChefHat className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-black text-lg uppercase tracking-tighter text-slate-900 leading-none">KDS</h1>
              <span className="text-slate-300 font-light">·</span>
              <span className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400 truncate">
                {tenant?.name || 'Concierge'}
              </span>
            </div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mt-0.5">Kitchen Display System</p>
          </div>
          {totalActive > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white shrink-0">
              <Bell className="w-3 h-3 animate-bounce" />
              <span className="font-black text-[10px] uppercase tracking-widest">{totalActive} Active</span>
            </div>
          )}
          {activeEventTickets.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-100 text-indigo-700 shrink-0">
              <Utensils className="w-3 h-3" />
              <span className="font-black text-[10px] uppercase tracking-widest">{activeEventTickets.length} Event</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <StatsBar requests={allRequests} />

          {/* Printer mode indicator + settings */}
          <button
            onClick={() => setPrinterSettingsOpen(true)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-2xl border-2 transition-all hover:border-primary/30',
              printerConfig.mode === 'network'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            )}
          >
            {printerConfig.mode === 'network'
              ? <Wifi className="w-3.5 h-3.5" />
              : <Monitor className="w-3.5 h-3.5" />
            }
            <span className="font-black text-[9px] uppercase tracking-widest">
              {printerConfig.mode === 'network' ? printerConfig.ip || 'No IP' : 'Browser'}
            </span>
            <Settings className="w-3 h-3 opacity-50" />
          </button>

          <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-100 border-2 border-slate-200">
            <div className="w-7 h-7 rounded-xl bg-primary flex items-center justify-center text-white font-black text-[10px] shrink-0">
              {getInitials(currentStaff.name)}
            </div>
            <span className="font-black text-[10px] uppercase tracking-widest text-slate-700">
              {currentStaff.name.split(' ')[0]}
            </span>
            <button onClick={handleLogout}
              className="ml-1 text-slate-400 hover:text-red-500 transition-colors">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSoundEnabled(v => !v)}
            className={cn('h-10 w-10 rounded-2xl p-0 border-2 transition-all',
              soundEnabled ? 'border-primary/20 text-primary bg-primary/5' : 'border-slate-200 text-slate-400')}>
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {/* Three Lanes */}
      <main className="flex-1 overflow-hidden p-6">
        <div className="h-full grid grid-cols-3 gap-6">
          <div className="overflow-y-auto pr-1 scrollbar-none">
            <LaneColumn title="Incoming" icon={Bell} count={incoming.length} accentClass="bg-blue-100 text-blue-600" emptyLabel="Queue Clear">
              {incoming.map((r, i) => (
                <TicketCard key={r.id} request={r} inventory={inventory}
                  onClaim={handleClaim} onMarkReady={handleMarkReady}
                  onDeliver={handleDeliver} onCancel={handleCancel}
                  onReassign={handleReassign} onPreviewPrint={handlePreviewPrint}
                  lane="incoming" fifoIndex={i} currentStaff={currentStaff} />
              ))}
            </LaneColumn>
          </div>
          <div className="overflow-y-auto pr-1 scrollbar-none">
            <LaneColumn title="In Prep" icon={ChefHat} count={prep.length} accentClass="bg-amber-100 text-amber-600" emptyLabel="Nothing Prepping">
              {prep.map((r, i) => (
                <TicketCard key={r.id} request={r} inventory={inventory}
                  onClaim={handleClaim} onMarkReady={handleMarkReady}
                  onDeliver={handleDeliver} onCancel={handleCancel}
                  onReassign={handleReassign} onPreviewPrint={handlePreviewPrint}
                  lane="prep" fifoIndex={i} currentStaff={currentStaff} />
              ))}
            </LaneColumn>
          </div>
          <div className="overflow-y-auto pr-1 scrollbar-none">
            <LaneColumn title="Ready to Deliver" icon={Zap} count={ready.length} accentClass="bg-emerald-100 text-emerald-600" emptyLabel="Nothing Ready Yet">
              {ready.map((r, i) => (
                <TicketCard key={r.id} request={r} inventory={inventory}
                  onClaim={handleClaim} onMarkReady={handleMarkReady}
                  onDeliver={handleDeliver} onCancel={handleCancel}
                  onReassign={handleReassign} onPreviewPrint={handlePreviewPrint}
                  lane="ready" fifoIndex={i} currentStaff={currentStaff} />
              ))}
            </LaneColumn>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="shrink-0 bg-white border-t-2 border-slate-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Live · Auto-Sync</span>
          </div>
          <span className="text-slate-300">·</span>
          <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Auto-logout 30m inactivity</span>
          <span className="text-slate-300">·</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Event Course</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {[
              { color: 'bg-emerald-400', label: '0–2m' },
              { color: 'bg-amber-400',   label: '2–5m' },
              { color: 'bg-orange-500',  label: '5–8m' },
              { color: 'bg-red-500',     label: '8m+'  },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={cn('w-2.5 h-2.5 rounded-full', color)} />
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
              </div>
            ))}
          </div>
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
            {format(new Date(), 'h:mm a')}
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function KDSPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <Loader className="w-8 h-8 animate-spin text-primary" />
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Initializing KDS...</p>
        </div>
      </div>
    }>
      <KDSContent />
    </Suspense>
  );
}
