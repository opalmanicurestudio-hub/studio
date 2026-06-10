'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  CircleDollarSign,
  TrendingUp,
  DoorOpen,
  Wrench,
  LayoutGrid,
  Lock,
  Unlock,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  Booth,
  Renter,
  Lease,
  BOOTH_RENTAL_COLLECTIONS,
  BOOTH_STATUS_LABELS,
  BOOTH_STATUS_COLORS,
  RENTER_STATUS_LABELS,
  formatCents,
  FREQUENCY_LABELS,
} from '@/lib/booth-rental-types';

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 1200;
const CANVAS_H = 800;
const GRID = 20;
const DEFAULT_W = 140;
const DEFAULT_H = 100;

const snap = (v: number) => Math.round(v / GRID) * GRID;

// ─── Summary metric card ──────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <div className="bg-background border border-border/40 rounded-xl p-4 flex gap-3 items-start min-w-[160px]">
      <div
        className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: accent ?? 'var(--color-background-secondary)' }}
      >
        <Icon className="h-4 w-4" style={{ color: accent ? '#fff' : undefined }} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground leading-none mb-1">{label}</p>
        <p className="text-xl font-semibold leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Status legend pill ───────────────────────────────────────────────────────

function StatusPill({ status }: { status: Booth['status'] }) {
  const c = BOOTH_STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {BOOTH_STATUS_LABELS[status]}
    </span>
  );
}

// ─── Booth card on canvas ─────────────────────────────────────────────────────

interface BoothCardProps {
  booth: Booth;
  renter?: Renter;
  lease?: Lease;
  selected: boolean;
  locked: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onResizeMouseDown: (e: React.MouseEvent, id: string) => void;
  onClick: (id: string) => void;
}

function BoothCard({
  booth,
  renter,
  lease,
  selected,
  locked,
  onMouseDown,
  onResizeMouseDown,
  onClick,
}: BoothCardProps) {
  const colors = BOOTH_STATUS_COLORS[booth.status];

  const monthlyRent = useMemo(() => {
    if (!lease) return 0;
    const multipliers: Record<string, number> = {
      daily: 30,
      weekly: 4.33,
      biweekly: 2.17,
      monthly: 1,
    };
    return Math.round(lease.rentAmountCents * (multipliers[lease.frequency] ?? 1));
  }, [lease]);

  return (
    <div
      className="absolute select-none group"
      style={{
        left: booth.canvasX,
        top: booth.canvasY,
        width: booth.canvasW,
        height: booth.canvasH,
      }}
      onMouseDown={(e) => !locked && onMouseDown(e, booth.id)}
      onClick={() => onClick(booth.id)}
    >
      {/* Card body */}
      <div
        className="w-full h-full rounded-xl flex flex-col p-2.5 overflow-hidden transition-shadow"
        style={{
          background: colors.bg,
          border: `2px solid ${selected ? colors.border : colors.border + '99'}`,
          boxShadow: selected ? `0 0 0 2px ${colors.border}44` : undefined,
          cursor: locked ? 'pointer' : 'grab',
        }}
      >
        {/* Top row: name + status dot */}
        <div className="flex items-center justify-between gap-1 mb-1">
          <span
            className="text-xs font-semibold truncate leading-none"
            style={{ color: colors.text }}
          >
            {booth.name}
          </span>
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: colors.border }}
          />
        </div>

        {/* Renter name */}
        {renter && (
          <span
            className="text-[11px] truncate leading-none mb-1"
            style={{ color: colors.text + 'cc' }}
          >
            {renter.firstName} {renter.lastName}
          </span>
        )}
        {!renter && booth.status === 'vacant' && (
          <span
            className="text-[11px] italic leading-none mb-1"
            style={{ color: colors.text + '88' }}
          >
            Available
          </span>
        )}

        {/* Rent */}
        {lease && monthlyRent > 0 && (
          <span
            className="text-[11px] font-medium leading-none mt-auto"
            style={{ color: colors.text }}
          >
            {formatCents(monthlyRent)}/mo
          </span>
        )}

        {/* Specialty */}
        {renter?.specialty && booth.canvasH >= 90 && (
          <span
            className="text-[10px] truncate leading-none mt-0.5"
            style={{ color: colors.text + '99' }}
          >
            {renter.specialty}
          </span>
        )}
      </div>

      {/* Resize handle — bottom-right corner */}
      {!locked && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeMouseDown(e, booth.id);
          }}
          style={{
            background: `linear-gradient(135deg, transparent 50%, ${colors.border} 50%)`,
            borderBottomRightRadius: 10,
          }}
        />
      )}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  booth,
  renter,
  lease,
  onClose,
}: {
  booth: Booth;
  renter?: Renter;
  lease?: Lease;
  onClose: () => void;
}) {
  const colors = BOOTH_STATUS_COLORS[booth.status];

  const monthlyRent = useMemo(() => {
    if (!lease) return 0;
    const m: Record<string, number> = { daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1 };
    return Math.round(lease.rentAmountCents * (m[lease.frequency] ?? 1));
  }, [lease]);

  return (
    <div className="absolute right-4 top-4 w-64 bg-background border border-border rounded-xl shadow-lg p-4 space-y-3 z-50">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{booth.name}</p>
          <StatusPill status={booth.status} />
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
        >
          ×
        </button>
      </div>

      {renter && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Renter</p>
          <p className="text-sm font-medium">
            {renter.firstName} {renter.lastName}
          </p>
          {renter.businessName && (
            <p className="text-xs text-muted-foreground">{renter.businessName}</p>
          )}
          {renter.specialty && (
            <p className="text-xs text-muted-foreground">{renter.specialty}</p>
          )}
          <p className="text-xs text-muted-foreground">{renter.email}</p>
          <Badge className="text-[10px]">{RENTER_STATUS_LABELS[renter.status]}</Badge>
        </div>
      )}

      {lease && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Lease</p>
          <p className="text-sm font-medium">{formatCents(monthlyRent)} / mo</p>
          <p className="text-xs text-muted-foreground">
            {formatCents(lease.rentAmountCents)} /{' '}
            {FREQUENCY_LABELS[lease.frequency].toLowerCase()}
          </p>
          {lease.scheduleSlot && (
            <p className="text-xs text-muted-foreground">
              Days: {lease.scheduleSlot.label ?? lease.scheduleSlot.days.join(', ')}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {lease.endDate ? `Ends ${lease.endDate}` : 'Month-to-month'}
          </p>
          {lease.perks.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {lease.perks.length} perk{lease.perks.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {booth.amenities.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Amenities</p>
          <div className="flex flex-wrap gap-1">
            {booth.amenities.map((a) => (
              <span
                key={a}
                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FloorPlanPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const boothsRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId)) : null,
    [firestore, tenantId]
  );
  const rentersRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId)) : null,
    [firestore, tenantId]
  );
  const leasesRef = useMemoFirebase(
    () => firestore && tenantId ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId)) : null,
    [firestore, tenantId]
  );

  const { data: booths } = useCollection<Booth>(boothsRef);
  const { data: renters } = useCollection<Renter>(rentersRef);
  const { data: leases } = useCollection<Lease>(leasesRef);

  const [locked, setLocked] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Drag state (ref to avoid re-renders mid-drag)
  const dragRef = useRef<{
    boothId: string;
    mode: 'move' | 'resize';
    startMouseX: number;
    startMouseY: number;
    startBoothX: number;
    startBoothY: number;
    startBoothW: number;
    startBoothH: number;
  } | null>(null);

  // Local positions during drag (avoid Firestore round-trips per mouse move)
  const [localPos, setLocalPos] = useState<
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});

  const renterById = useMemo(() => {
    const m = new Map<string, Renter>();
    (renters ?? []).forEach((r) => m.set(r.id, r));
    return m;
  }, [renters]);

  const activeLeaseByBooth = useMemo(() => {
    const m = new Map<string, Lease>();
    (leases ?? []).forEach((l) => {
      if (l.status === 'active' || l.status === 'on_leave') {
        if (!m.has(l.boothId)) m.set(l.boothId, l);
      }
    });
    return m;
  }, [leases]);

  // Studio-wide metrics
  const metrics = useMemo(() => {
    const allBooths = booths ?? [];
    const total = allBooths.length;
    const occupied = allBooths.filter(
      (b) => b.status === 'occupied' || b.status === 'partial'
    ).length;
    const vacant = allBooths.filter((b) => b.status === 'vacant').length;

    const multipliers: Record<string, number> = {
      daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1,
    };
    let monthlyRevenue = 0;
    let vacancyCost = 0;

    allBooths.forEach((b) => {
      const lease = activeLeaseByBooth.get(b.id);
      if (lease) {
        monthlyRevenue += Math.round(lease.rentAmountCents * (multipliers[lease.frequency] ?? 1));
      } else if (b.status === 'vacant') {
        vacancyCost += Math.round(b.baseRentCents * (multipliers[b.baseRentFrequency] ?? 1));
      }
    });

    const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
    return { total, occupied, vacant, monthlyRevenue, vacancyCost, occupancyPct };
  }, [booths, activeLeaseByBooth]);

  // Effective booth position (local override during drag, else Firestore)
  const effectiveBooth = useCallback(
    (booth: Booth) => {
      const lp = localPos[booth.id];
      if (lp)
        return { ...booth, canvasX: lp.x, canvasY: lp.y, canvasW: lp.w, canvasH: lp.h };
      return booth;
    },
    [localPos]
  );

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, boothId: string) => {
      if (locked) return;
      e.preventDefault();
      const booth = (booths ?? []).find((b) => b.id === boothId);
      if (!booth) return;
      const lp = localPos[boothId];
      dragRef.current = {
        boothId,
        mode: 'move',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startBoothX: lp?.x ?? booth.canvasX,
        startBoothY: lp?.y ?? booth.canvasY,
        startBoothW: lp?.w ?? booth.canvasW,
        startBoothH: lp?.h ?? booth.canvasH,
      };
      setSelectedId(boothId);
    },
    [locked, booths, localPos]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, boothId: string) => {
      if (locked) return;
      e.preventDefault();
      const booth = (booths ?? []).find((b) => b.id === boothId);
      if (!booth) return;
      const lp = localPos[boothId];
      dragRef.current = {
        boothId,
        mode: 'resize',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startBoothX: lp?.x ?? booth.canvasX,
        startBoothY: lp?.y ?? booth.canvasY,
        startBoothW: lp?.w ?? booth.canvasW,
        startBoothH: lp?.h ?? booth.canvasH,
      };
      setSelectedId(boothId);
    },
    [locked, booths, localPos]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startMouseX;
      const dy = e.clientY - d.startMouseY;

      if (d.mode === 'move') {
        setLocalPos((prev) => ({
          ...prev,
          [d.boothId]: {
            x: Math.max(0, Math.min(CANVAS_W - d.startBoothW, snap(d.startBoothX + dx))),
            y: Math.max(0, Math.min(CANVAS_H - d.startBoothH, snap(d.startBoothY + dy))),
            w: d.startBoothW,
            h: d.startBoothH,
          },
        }));
      } else {
        setLocalPos((prev) => ({
          ...prev,
          [d.boothId]: {
            x: d.startBoothX,
            y: d.startBoothY,
            w: Math.max(GRID * 4, snap(d.startBoothW + dx)),
            h: Math.max(GRID * 4, snap(d.startBoothH + dy)),
          },
        }));
      }
    };

    const handleMouseUp = async () => {
      const d = dragRef.current;
      if (!d || !tenantId) { dragRef.current = null; return; }
      const lp = localPos[d.boothId];
      dragRef.current = null;
      if (!lp) return;

      // Persist to Firestore
      setSaving(true);
      try {
        await updateDoc(
          doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), d.boothId),
          {
            canvasX: lp.x,
            canvasY: lp.y,
            canvasW: lp.w,
            canvasH: lp.h,
            updatedAt: new Date().toISOString(),
          }
        );
        setLocalPos((prev) => {
          const next = { ...prev };
          delete next[d.boothId];
          return next;
        });
      } finally {
        setSaving(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [firestore, tenantId, localPos]);

  // Auto-place new booths that have no canvas position yet
  const autoArrangeBooths = async () => {
    if (!tenantId) return;
    const unplaced = (booths ?? []).filter(
      (b) => b.canvasX === 0 && b.canvasY === 0
    );
    if (unplaced.length === 0) return;
    const cols = 4;
    const padX = 40;
    const padY = 40;
    const gapX = 20;
    const gapY = 20;
    setSaving(true);
    try {
      await Promise.all(
        unplaced.map((b, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          return updateDoc(
            doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), b.id),
            {
              canvasX: padX + col * (DEFAULT_W + gapX),
              canvasY: padY + row * (DEFAULT_H + gapY),
              canvasW: DEFAULT_W,
              canvasH: DEFAULT_H,
              updatedAt: new Date().toISOString(),
            }
          );
        })
      );
    } finally {
      setSaving(false);
    }
  };

  if (!tenantId) {
    return <div className="p-8 text-sm text-muted-foreground">Loading your studio…</div>;
  }

  const selectedBooth = selectedId ? (booths ?? []).find((b) => b.id === selectedId) : null;
  const selectedLease = selectedBooth ? activeLeaseByBooth.get(selectedBooth.id) : undefined;
  const selectedRenter = selectedLease ? renterById.get(selectedLease.renterId) : undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Metrics bar ── */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-3 flex-wrap">
            <MetricCard
              label="Monthly revenue"
              value={formatCents(metrics.monthlyRevenue)}
              sub={`${metrics.occupancyPct}% occupancy`}
              icon={CircleDollarSign}
              accent="#185FA5"
            />
            <MetricCard
              label="Occupied"
              value={`${metrics.occupied} / ${metrics.total}`}
              sub="booths"
              icon={TrendingUp}
              accent="#0F6E56"
            />
            <MetricCard
              label="Vacant"
              value={String(metrics.vacant)}
              sub={metrics.vacancyCost > 0 ? `${formatCents(metrics.vacancyCost)}/mo uncollected` : 'No vacancies'}
              icon={DoorOpen}
              accent={metrics.vacant > 0 ? '#BA7517' : '#3B6D11'}
            />
          </div>

          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" /> Saving…
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={autoArrangeBooths}
              disabled={saving || locked}
            >
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              Auto-arrange
            </Button>
            <Button
              variant={locked ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setLocked((l) => !l)}
            >
              {locked ? (
                <><Lock className="h-4 w-4 mr-1.5" />Layout locked</>
              ) : (
                <><Unlock className="h-4 w-4 mr-1.5" />Editing layout</>
              )}
            </Button>
          </div>
        </div>

        {/* Status legend */}
        <div className="flex gap-3 mt-3 flex-wrap">
          {(Object.entries(BOOTH_STATUS_COLORS) as [Booth['status'], typeof BOOTH_STATUS_COLORS[Booth['status']]][]).map(
            ([status, c]) => (
              <span key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: c.bg, border: `1.5px solid ${c.border}` }}
                />
                {BOOTH_STATUS_LABELS[status]}
              </span>
            )
          )}
          {!locked && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
              <Info className="h-3 w-3" />
              Drag to move · drag corner to resize · changes save automatically
            </span>
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 overflow-auto bg-muted/30">
        <div
          className="relative"
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            backgroundImage: locked
              ? undefined
              : 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
            backgroundSize: `${GRID}px ${GRID}px`,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          {(booths ?? []).map((b) => {
            const eb = effectiveBooth(b);
            const lease = activeLeaseByBooth.get(b.id);
            const renter = lease ? renterById.get(lease.renterId) : undefined;
            return (
              <TooltipProvider key={b.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <BoothCard
                        booth={eb}
                        renter={renter}
                        lease={lease}
                        selected={selectedId === b.id}
                        locked={locked}
                        onMouseDown={handleMouseDown}
                        onResizeMouseDown={handleResizeMouseDown}
                        onClick={setSelectedId}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                    <p className="font-medium">{b.name}</p>
                    {b.amenities.length > 0 && (
                      <p className="text-muted-foreground">{b.amenities.join(', ')}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}

          {/* Empty state */}
          {(booths ?? []).length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2">
              <Wrench className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">
                No booths yet. Add booths from the Booths page, then arrange them here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail panel ── */}
      {selectedBooth && (
        <div className="absolute right-6 top-[180px] z-50">
          <DetailPanel
            booth={effectiveBooth(selectedBooth)}
            renter={selectedRenter}
            lease={selectedLease}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}