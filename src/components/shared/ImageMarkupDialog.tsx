'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
    Pencil, 
    Trash2, 
    Check, 
    X, 
    Sparkles, 
    Undo2, 
    Search,
    Palette,
    ArrowRight,
    Loader,
    Maximize2,
    Target,
    Type as TypeIcon,
    ZoomIn,
    Hand,
    Circle,
    Maximize,
    ArrowUpRight,
    AlertCircle,
    Star,
    Zap,
    Minus,
    MousePointer2,
    Highlighter,
    Navigation,
    Plus,
    VolumeX,
    Ear,
    SunDim,
    Gamepad2,
    MessageSquare,
    Coffee,
    Award,
    Hash,
    Pipette
} from 'lucide-react';
import { cn, safeNumber } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';

interface ImageMarkupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSave: (markedUpDataUrl: string) => void;
  title?: string;
}

const colors = [
    { name: 'Primary', value: '#7955c4' }, 
    { name: 'Alert', value: '#ef4444' },   
    { name: 'Success', value: '#22c55e' }, 
    { name: 'Info', value: '#3b82f6' },    
    { name: 'White', value: '#ffffff' },   
    { name: 'Black', value: '#000000' },   
];

type ToolType = 'pencil' | 'text' | 'magnifier' | 'select' | 'pan' | 'sticker' | 'zone';
type TextSize = 'sm' | 'md' | 'lg';
type PenStyle = 'solid' | 'dashed' | 'highlighter';
type StickerType = 'arrow' | 'star' | 'alert' | 'check' | 'cross' | 'target' | 'number';

interface BaseAnnotation {
    id: string;
    x: number;
    y: number;
    color: string;
    rotation: number;
    scale: number;
}

interface TextAnnotation extends BaseAnnotation {
    type: 'text';
    text: string;
    size: TextSize;
}

interface StickerAnnotation extends BaseAnnotation {
    type: 'sticker';
    stickerType: StickerType;
    // v2 — only set when stickerType === 'number'. Fixed at creation time,
    // not recomputed live from position-in-array — deleting an earlier
    // numbered sticker shouldn't silently renumber every sticker after it.
    number?: number;
}

interface MagnifierLens extends BaseAnnotation {
    type: 'lens';
    r: number;
}

// v2 — NEW: a "zone" — an outlined circle marking an area, distinct from
// the fixed-size stickers (which mark a POINT) and the magnifier lens
// (which shows a zoomed crop). Sized by drag distance from where the
// gesture started, same interaction pattern nail techs already expect from
// "circle the area you mean" markup on a reference photo.
interface ZoneAnnotation extends BaseAnnotation {
    type: 'zone';
    r: number;
}

interface Path {
    id: string;
    points: { x: number, y: number }[];
    color: string;
    width: number;
    style: PenStyle;
}

type Annotation = TextAnnotation | StickerAnnotation | MagnifierLens | ZoneAnnotation;

export const ImageMarkupDialog: React.FC<ImageMarkupDialogProps> = ({
  open,
  onOpenChange,
  imageUrl,
  onSave,
  title = "Technical Mapping",
}) => {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  
  // Tool & Style State
  const [tool, setTool] = useState<ToolType>('pencil');
  const [color, setColor] = useState(colors[0].value);
  const [brushSize, setBrushSize] = useState(3);
  const [textSize, setTextSize] = useState<TextSize>('md');
  const [penStyle, setPenStyle] = useState<PenStyle>('solid');
  // v2 — which sticker gets placed next. Previously hardcoded to 'arrow'
  // with no picker UI at all — none of the other 5 defined sticker types
  // (star/alert/check/cross/target) were actually reachable from the
  // toolbar. Fixed alongside adding the new 'number' type.
  const [stickerType, setStickerType] = useState<StickerType>('arrow');
  // v2 — the in-progress zone circle while dragging to size it. Not part
  // of `annotations` until the drag completes — same reasoning as not
  // wanting half-drawn state polluting undo history.
  const [drawingZone, setDrawingZone] = useState<ZoneAnnotation | null>(null);
  
  // Spatial State
  const [viewTransform, setViewTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [lastPinchDist, setLastPinchDist] = useState<number | null>(null);
  const [lastPinchAngle, setLastPinchAngle] = useState<number | null>(null);

  // Data State
  const [paths, setPaths] = useState<Path[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const [history, setHistory] = useState<{ paths: Path[], annotations: Annotation[] }[]>([]);
  const [textInput, setTextInput] = useState<{ x: number, y: number, value: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // --- DRAWING ENGINE ---

  const drawSticker = (ctx: CanvasRenderingContext2D, s: StickerAnnotation) => {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rotation);
      ctx.scale(s.scale, s.scale);
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const size = 20;

      switch(s.stickerType) {
          case 'arrow':
              ctx.beginPath();
              ctx.moveTo(-size, 0);
              ctx.lineTo(size, 0);
              ctx.lineTo(size/2, -size/2);
              ctx.moveTo(size, 0);
              ctx.lineTo(size/2, size/2);
              ctx.stroke();
              break;
          case 'star':
              ctx.beginPath();
              for (let i = 0; i < 5; i++) {
                  ctx.rotate(Math.PI / 5);
                  ctx.lineTo(0, -size);
                  ctx.rotate(Math.PI / 5);
                  ctx.lineTo(0, -size/2.5);
              }
              ctx.closePath();
              ctx.fill();
              break;
          case 'alert':
              ctx.beginPath();
              ctx.moveTo(0, -size);
              ctx.lineTo(size, size*0.8);
              ctx.lineTo(-size, size*0.8);
              ctx.closePath();
              ctx.stroke();
              ctx.fillRect(-1, -size*0.3, 2, size*0.5);
              ctx.fillRect(-1, size*0.4, 2, 2);
              break;
          case 'check':
              ctx.beginPath();
              ctx.moveTo(-size*0.6, 0);
              ctx.lineTo(-size*0.1, size*0.5);
              ctx.lineTo(size*0.7, -size*0.5);
              ctx.stroke();
              break;
          case 'cross':
              ctx.beginPath();
              ctx.moveTo(-size*0.5, -size*0.5);
              ctx.lineTo(size*0.5, size*0.5);
              ctx.moveTo(size*0.5, -size*0.5);
              ctx.lineTo(-size*0.5, size*0.5);
              ctx.stroke();
              break;
          case 'target':
              ctx.beginPath();
              ctx.arc(0, 0, size*0.8, 0, Math.PI * 2);
              ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
              ctx.moveTo(0, -size); ctx.lineTo(0, size);
              ctx.stroke();
              break;
          case 'number':
              // Filled badge circle, matching the visual weight of the
              // filled 'star' case above rather than the outlined ones —
              // a sequence number needs to read clearly at a glance.
              ctx.beginPath();
              ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2);
              ctx.fill();
              ctx.font = `900 ${size}px Figtree, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = '#ffffff';
              ctx.fillText(String(s.number ?? ''), 0, 1);
              break;
      }
      ctx.restore();
  };

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    const img = baseImageRef.current;
    if (!canvas || !ctx || !img) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Spatial Transform
    ctx.translate(viewTransform.x * dpr, viewTransform.y * dpr);
    ctx.scale(viewTransform.scale * dpr, viewTransform.scale * dpr);

    // Image Center
    const dw = canvas.width / dpr;
    const dh = canvas.height / dpr;
    ctx.drawImage(img, 0, 0, dw, dh);

    // Lenses
    annotations.filter(a => a.type === 'lens').forEach(lens => {
        const l = lens as MagnifierLens;
        const r = l.r;
        const imgScaleX = img.width / dw;
        const imgScaleY = img.height / dh;

        ctx.save();
        ctx.beginPath();
        ctx.arc(l.x, l.y, r, 0, Math.PI * 2);
        ctx.clip();
        
        ctx.drawImage(
            img,
            (l.x - r/2) * imgScaleX,
            (l.y - r/2) * imgScaleY,
            r * imgScaleX,
            r * imgScaleY,
            l.x - r,
            l.y - r,
            r * 2,
            r * 2
        );

        ctx.strokeStyle = l.color;
        ctx.lineWidth = 2;
        if (selectedId === l.id) ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.restore();
    });

    // Zones — outlined circles marking an area, distinct from the lens
    // (which shows a zoomed crop) and stickers (which mark a point).
    // Rendered before paths/stickers/text so hand-drawn marks and stickers
    // always sit visually on top of a zone outline, never hidden by it.
    const drawZoneCircle = (z: { x: number; y: number; r: number; color: string }, dashed: boolean) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(z.x, z.y, Math.max(1, z.r), 0, Math.PI * 2);
        ctx.strokeStyle = z.color;
        ctx.lineWidth = 3;
        ctx.setLineDash(dashed ? [6, 6] : []);
        ctx.stroke();
        ctx.restore();
    };
    annotations.filter(a => a.type === 'zone').forEach(zone => {
        const z = zone as ZoneAnnotation;
        drawZoneCircle(z, selectedId === z.id);
    });
    if (drawingZone) drawZoneCircle(drawingZone, true);

    // Paths
    paths.forEach(path => {
        if (path.points.length < 2) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.strokeStyle = path.color;
        ctx.lineWidth = path.width;
        if (path.style === 'dashed') ctx.setLineDash([5, 5]);
        else if (path.style === 'highlighter') { ctx.globalAlpha = 0.4; ctx.lineWidth = path.width * 5; }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    });

    // Stickers
    annotations.filter(a => a.type === 'sticker').forEach(s => {
        const sticker = s as StickerAnnotation;
        if (sticker.id === selectedId) {
            ctx.save();
            ctx.strokeStyle = '#7955c4';
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(sticker.x - 25, sticker.y - 25, 50, 50);
            ctx.restore();
        }
        drawSticker(ctx, sticker);
    });

    // Text
    annotations.filter(a => a.type === 'text').forEach(anno => {
        const text = anno as TextAnnotation;
        const fontSize = text.size === 'sm' ? 14 : text.size === 'lg' ? 28 : 18;
        ctx.save();
        ctx.translate(text.x, text.y);
        ctx.rotate(text.rotation);
        ctx.font = `900 ${fontSize}px Figtree, sans-serif`;
        ctx.fillStyle = text.color;
        ctx.textAlign = 'left';
        if (text.id === selectedId) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(121, 85, 196, 0.4)';
        }
        ctx.fillText(text.text.toUpperCase(), 0, 0);
        ctx.restore();
    });
  }, [annotations, paths, selectedId, viewTransform, drawingZone]);

  // --- COORDINATE UTILS ---

  const getCoordinates = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, rawX: 0, rawY: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const rawX = (clientX - rect.left);
    const rawY = (clientY - rect.top);
    return { 
        x: (rawX - viewTransform.x) / viewTransform.scale, 
        y: (rawY - viewTransform.y) / viewTransform.scale,
        rawX,
        rawY
    };
  };

  // --- INTERACTIONS ---

  const saveToHistory = () => {
      setHistory(prev => [...prev, { paths: JSON.parse(JSON.stringify(paths)), annotations: JSON.parse(JSON.stringify(annotations)) }]);
  };

  const handleUndo = () => {
      if (history.length === 0) return;
      const last = history[history.length - 1];
      setPaths(last.paths);
      setAnnotations(last.annotations);
      setHistory(prev => prev.slice(0, -1));
      setSelectedId(null);
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;
    const coords = getCoordinates(e);
    const { x, y } = coords;

    if ('touches' in e && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        setLastPinchDist(Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY));
        setLastPinchAngle(Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX));
        setIsDrawing(false);
        return;
    }

    if (tool === 'pan') {
        setIsPanning(true);
        setLastPanPos({ x: coords.rawX, y: coords.rawY });
        return;
    }

    const hit = [...annotations].reverse().find(a => {
        if (a.type === 'text') {
            const ctx = contextRef.current;
            if (!ctx) return false;
            const text = a as TextAnnotation;
            const fs = text.size === 'sm' ? 14 : text.size === 'lg' ? 28 : 18;
            ctx.font = `900 ${fs}px Figtree`;
            const metrics = ctx.measureText(text.text.toUpperCase());
            return x >= text.x && x <= text.x + metrics.width && y >= text.y - fs && y <= text.y;
        }
        if (a.type === 'sticker') return Math.hypot(x - a.x, y - a.y) < (30 * a.scale);
        if (a.type === 'lens') return Math.hypot(x - a.x, y - a.y) < (a as MagnifierLens).r;
        if (a.type === 'zone') {
            // Hit the outline ring, not the whole filled area — a zone is
            // meant to circle something without blocking taps on what's
            // inside it, so only the stroke itself (±8px tolerance) counts.
            const z = a as ZoneAnnotation;
            const dist = Math.hypot(x - z.x, y - z.y);
            return Math.abs(dist - z.r) < 8;
        }
        return false;
    });

    if (hit) {
        saveToHistory();
        setSelectedId(hit.id);
        setIsDragging(true);
        if (tool !== 'select') setTool('select');
        return;
    }

    if (tool === 'text') { setTextInput({ x, y, value: '' }); return; }
    if (tool === 'magnifier') { 
        saveToHistory();
        const newLens: MagnifierLens = { id: nanoid(), type: 'lens', x, y, r: 40, color, rotation: 0, scale: 1 };
        setAnnotations(prev => [...prev, newLens]);
        setSelectedId(newLens.id);
        setTool('select');
        return;
    }
    if (tool === 'pencil') { 
        saveToHistory();
        setIsDrawing(true); 
        setPaths(prev => [...prev, { id: nanoid(), color, width: brushSize, style: penStyle, points: [coords] }]); 
    }
    if (tool === 'sticker') { 
        saveToHistory();
        // v2 — FIX: previously hardcoded stickerType: 'arrow' regardless of
        // what was selected — none of the other 5 defined sticker types
        // were ever actually reachable. Now uses the picker state.
        const isNumbered = stickerType === 'number';
        const nextNumber = isNumbered
            ? annotations.filter(a => a.type === 'sticker' && (a as StickerAnnotation).stickerType === 'number').length + 1
            : undefined;
        const newSticker: StickerAnnotation = { id: nanoid(), type: 'sticker', stickerType, x, y, color, rotation: 0, scale: 1, ...(isNumbered ? { number: nextNumber } : {}) };
        setAnnotations(prev => [...prev, newSticker]); 
        setSelectedId(newSticker.id);
        setTool('select');
        return;
    }
    if (tool === 'zone') {
        // v2 — NEW: drag-to-size, unlike stickers/lens which place at a
        // fixed size on tap. Not pushed into `annotations` until the drag
        // completes in handleMouseUp — see drawingZone state.
        saveToHistory();
        setDrawingZone({ id: nanoid(), type: 'zone', x, y, r: 1, color, rotation: 0, scale: 1 });
        return;
    }
    
    setSelectedId(null);
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;

    if ('touches' in e && e.touches.length === 2 && lastPinchDist !== null) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
        const currentAngle = Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX);
        
        const scaleFactor = currentDist / lastPinchDist;
        const angleDelta = currentAngle - (lastPinchAngle || 0);

        if (selectedId) {
            setAnnotations(prev => prev.map(a => a.id === selectedId ? { ...a, scale: a.scale * scaleFactor, rotation: a.rotation + angleDelta } : a));
        } else {
            const midX = (t1.clientX + t2.clientX) / 2;
            const midY = (t1.clientY + t2.clientY) / 2;
            const canvasRect = canvasRef.current!.getBoundingClientRect();
            const pX = midX - canvasRect.left;
            const pY = midY - canvasRect.top;

            const newScale = Math.min(5, Math.max(1, viewTransform.scale * scaleFactor));
            const actualFactor = newScale / viewTransform.scale;

            setViewTransform(prev => ({
                scale: newScale,
                x: pX - (pX - prev.x) * actualFactor,
                y: pY - (pY - prev.y) * actualFactor
            }));
        }
        setLastPinchDist(currentDist);
        setLastPinchAngle(currentAngle);
        return;
    }

    const coords = getCoordinates(e);

    if (isPanning) {
        setViewTransform(prev => ({ 
            ...prev, 
            x: prev.x + (coords.rawX - lastPanPos.x), 
            y: prev.y + (coords.rawY - lastPanPos.y) 
        }));
        setLastPanPos({ x: coords.rawX, y: coords.rawY });
        return;
    }

    if (isDragging && selectedId) {
        setAnnotations(prev => prev.map(a => a.id === selectedId ? { ...a, x: coords.x, y: coords.y } : a));
        return;
    }

    if (isDrawing && tool === 'pencil') {
        setPaths(prev => {
            const last = prev[prev.length - 1];
            if (!last) return prev;
            return [...prev.slice(0, -1), { ...last, points: [...last.points, coords] }];
        });
    }

    if (drawingZone) {
        const r = Math.hypot(coords.x - drawingZone.x, coords.y - drawingZone.y);
        setDrawingZone(prev => prev ? { ...prev, r } : prev);
    }
  };

  const handleMouseUp = () => {
    setIsDrawing(false); 
    setIsDragging(false); 
    setIsPanning(false); 
    setLastPinchDist(null);
    setLastPinchAngle(null);
    if (drawingZone) {
        // A near-zero-radius zone means it was a tap, not a drag — treat
        // it as an accidental placement rather than committing an
        // invisible zone the person would have no way to select later.
        if (drawingZone.r >= 8) {
            const finalZone = drawingZone;
            setAnnotations(prev => [...prev, finalZone]);
            setSelectedId(finalZone.id);
            setTool('select');
        }
        setDrawingZone(null);
    }
  };

  // v2 — NEW: scroll-wheel zoom for desktop/mouse+trackpad users. Pinch-
  // zoom previously only worked via touch gestures — anyone on a mouse had
  // no way to zoom in for precision work at all. Centered on the cursor
  // position, same math as the pinch-zoom handler above (zoom toward
  // wherever the cursor is, not the canvas center).
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pX = e.clientX - rect.left;
    const pY = e.clientY - rect.top;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setViewTransform(prev => {
        const newScale = Math.min(5, Math.max(1, prev.scale * zoomFactor));
        const actualFactor = newScale / prev.scale;
        return {
            scale: newScale,
            x: pX - (pX - prev.x) * actualFactor,
            y: pY - (pY - prev.y) * actualFactor,
        };
    });
  };

  // --- LIFECYCLE ---

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imageUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseImageRef.current = img;
      const padding = isMobile ? 20 : 40;
      const availW = container.clientWidth - padding;
      const availH = container.clientHeight - padding;
      const imgScale = Math.min(availW / img.width, availH / img.height);
      const dw = img.width * imgScale;
      const dh = img.height * imgScale;
      const dpr = window.devicePixelRatio || 1;
      
      canvas.width = dw * dpr;
      canvas.height = dh * dpr;
      canvas.style.width = `${dw}px`;
      canvas.style.height = `${dh}px`;
      contextRef.current = canvas.getContext('2d');
      setIsLoading(false);
    };
    img.src = imageUrl;
  }, [imageUrl, isMobile]);

  useEffect(() => {
    if (open) {
        setPaths([]);
        setAnnotations([]);
        setHistory([]);
        setViewTransform({ scale: 1, x: 0, y: 0 });
        setSelectedId(null);
        setIsLoading(true);
        requestAnimationFrame(initCanvas);
    }
  }, [open, initCanvas]);

  useEffect(() => {
    if (!isLoading) drawAll();
  }, [isLoading, annotations, paths, selectedId, viewTransform, color, drawAll]);

  // v2 — NEW: samples a color directly FROM the reference photo (or
  // anywhere on screen — that's how the native API works), rather than
  // only offering the 6 fixed presets or a generic color wheel. Genuinely
  // useful here specifically: matching an exact shade from the client's
  // inspiration photo. Gracefully degrades on browsers without support
  // (Safari/Firefox as of this writing) — the custom color wheel below
  // still works everywhere as the fallback.
  const handleEyedropper = async () => {
    if (!('EyeDropper' in window)) {
        toast({ variant: 'destructive', title: 'Not supported in this browser', description: 'Try the color wheel next to it instead.' });
        return;
    }
    try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) setColor(result.sRGBHex);
    } catch {
        // Person pressed Escape / cancelled the picker — not an error.
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput || !textInput.value.trim()) { setTextInput(null); return; }
    saveToHistory();
    const newText: TextAnnotation = { id: nanoid(), type: 'text', text: textInput.value, x: textInput.x, y: textInput.y, color, rotation: 0, scale: 1, size: textSize };
    setAnnotations(prev => [...prev, newText]);
    setTextInput(null); setTool('select'); setSelectedId(newText.id);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSelectedId(null);
    setTool('select');
    requestAnimationFrame(() => {
        onSave(canvas.toDataURL('image/png'));
        onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl p-0 border-4 rounded-[3rem] md:rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col h-[95dvh] sm:h-[90dvh]">
        <DialogHeader className="p-6 md:p-8 pb-4 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-1.5 md:mb-2 text-left">
            <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />
            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical Mapping</span>
          </div>
          <DialogTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-muted/20 relative flex flex-col">
            <div className="w-full bg-background border-b p-3 md:p-4 flex-shrink-0">
                <ScrollArea className="w-full">
                    <div className="flex items-center gap-6 pb-2 min-w-max">
                        <div className="flex items-center gap-2">
                            {colors.map((c) => (
                                <button
                                    key={c.value}
                                    onClick={() => setColor(c.value)}
                                    className={cn(
                                        "w-7 h-7 rounded-full border-2 transition-all active:scale-90",
                                        color === c.value ? "border-primary scale-110 ring-4 ring-primary/10 shadow-lg" : "border-white"
                                    )}
                                    style={{ backgroundColor: c.value }}
                                />
                            ))}
                            {/* v2 — custom color wheel: any color, not just
                                the 6 presets. Works everywhere, unlike the
                                eyedropper next to it. */}
                            <label
                                className="relative w-7 h-7 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer overflow-hidden shrink-0"
                                title="Custom color"
                                style={!colors.some(c => c.value === color) ? { backgroundColor: color, borderStyle: 'solid', borderColor: 'var(--primary)' } : undefined}
                            >
                                {colors.some(c => c.value === color) && <Palette className="w-3 h-3 text-slate-400" />}
                                <input
                                    type="color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                            </label>
                            {/* v2 — eyedropper: samples an exact color from
                                the photo itself (e.g. matching a shade),
                                rather than eyeballing it on a color wheel. */}
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button onClick={handleEyedropper} className="w-7 h-7 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center shrink-0 hover:border-primary/40 transition-colors active:scale-90">
                                            <Pipette className="w-3.5 h-3.5 text-slate-500" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Sample from photo</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <Separator orientation="vertical" className="h-8 mx-2" />
                        <div className="flex items-center gap-1.5 md:gap-2">
                            <TooltipProvider>
                                <Tooltip><TooltipTrigger asChild><Button variant={tool === 'pencil' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pencil')} className="h-10 w-10 rounded-xl"><Pencil className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Brush</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant={tool === 'text' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('text')} className="h-10 w-10 rounded-xl"><TypeIcon className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Notes</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant={tool === 'magnifier' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('magnifier')} className="h-10 w-10 rounded-xl text-indigo-600"><ZoomIn className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Lens</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant={tool === 'sticker' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('sticker')} className="h-10 w-10 rounded-xl"><Target className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Stickers</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant={tool === 'zone' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('zone')} className="h-10 w-10 rounded-xl"><Circle className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Zone (drag to size)</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant={tool === 'select' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('select')} className="h-10 w-10 rounded-xl"><MousePointer2 className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Transform</TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant={tool === 'pan' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pan')} className="h-10 w-10 rounded-xl"><Hand className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Pan / Zoom</TooltipContent></Tooltip>
                            </TooltipProvider>
                        </div>
                        <Separator orientation="vertical" className="h-8 mx-2" />
                        {tool === 'pencil' && (
                            <div className="flex items-center gap-1.5 animate-in slide-in-from-left-2">
                                <Button variant={penStyle === 'solid' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('solid')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Solid</Button>
                                <Button variant={penStyle === 'dashed' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('dashed')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Dashed</Button>
                                <Button variant={penStyle === 'highlighter' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('highlighter')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Highlighter</Button>
                            </div>
                        )}
                        {tool === 'text' && (
                            <div className="flex items-center gap-1.5 animate-in slide-in-from-left-2">
                                <Button variant={textSize === 'sm' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTextSize('sm')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Small</Button>
                                <Button variant={textSize === 'md' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTextSize('md')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Medium</Button>
                                <Button variant={textSize === 'lg' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTextSize('lg')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Large</Button>
                            </div>
                        )}
                        {tool === 'sticker' && (
                            <div className="flex items-center gap-1 animate-in slide-in-from-left-2">
                                <TooltipProvider>
                                    <Tooltip><TooltipTrigger asChild><Button variant={stickerType === 'arrow' ? 'secondary' : 'ghost'} size="icon" onClick={() => setStickerType('arrow')} className="h-8 w-8 rounded-lg"><ArrowUpRight className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Arrow</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><Button variant={stickerType === 'star' ? 'secondary' : 'ghost'} size="icon" onClick={() => setStickerType('star')} className="h-8 w-8 rounded-lg"><Star className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Star</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><Button variant={stickerType === 'alert' ? 'secondary' : 'ghost'} size="icon" onClick={() => setStickerType('alert')} className="h-8 w-8 rounded-lg"><AlertCircle className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Alert</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><Button variant={stickerType === 'check' ? 'secondary' : 'ghost'} size="icon" onClick={() => setStickerType('check')} className="h-8 w-8 rounded-lg"><Check className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Check</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><Button variant={stickerType === 'cross' ? 'secondary' : 'ghost'} size="icon" onClick={() => setStickerType('cross')} className="h-8 w-8 rounded-lg"><X className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Cross</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><Button variant={stickerType === 'target' ? 'secondary' : 'ghost'} size="icon" onClick={() => setStickerType('target')} className="h-8 w-8 rounded-lg"><Target className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Target</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><Button variant={stickerType === 'number' ? 'secondary' : 'ghost'} size="icon" onClick={() => setStickerType('number')} className="h-8 w-8 rounded-lg"><Hash className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent className="font-black uppercase text-[9px] border-2">Numbered sequence</TooltipContent></Tooltip>
                                </TooltipProvider>
                            </div>
                        )}
                        <div className="flex gap-2 ml-auto">
                            {selectedId && <Button variant="ghost" size="icon" onClick={() => { setAnnotations(prev => prev.filter(a => a.id !== selectedId)); setSelectedId(null); }} className="h-10 w-10 rounded-xl text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></Button>}
                            <Button variant="ghost" size="icon" onClick={handleUndo} className="h-10 w-10 rounded-xl text-slate-400 hover:bg-muted"><Undo2 className="w-5 h-5" /></Button>
                        </div>
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </div>

            <div ref={containerRef} className="flex-1 relative flex items-center justify-center p-4 overflow-hidden touch-none select-none">
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 z-10 gap-4 text-center">
                        <Loader className="w-10 h-10 animate-spin text-primary opacity-40" />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Buffering Protocol...</p>
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchStart={handleMouseDown}
                    onTouchMove={handleMouseMove}
                    onTouchEnd={handleMouseUp}
                    onWheel={handleWheel}
                    className={cn("shadow-2xl rounded-2xl bg-white border-2 cursor-crosshair", isLoading ? "opacity-0" : "opacity-100")}
                />
                {textInput && (
                    <form onSubmit={handleTextSubmit} className="absolute z-[100]" style={{ left: textInput.x * viewTransform.scale + viewTransform.x, top: textInput.y * viewTransform.scale + viewTransform.y - 40 }}>
                        <input autoFocus value={textInput.value} onChange={e => setTextInput(prev => prev ? {...prev, value: e.target.value} : null)} onBlur={handleTextSubmit} className="h-10 min-w-[160px] bg-white border-primary border-4 shadow-3xl font-black uppercase text-xs rounded-xl px-4 focus:outline-none ring-4 ring-primary/10" placeholder="ENTER NOTE..." />
                    </form>
                )}
            </div>
        </div>

        <DialogFooter className="p-6 md:p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
            <div className="flex w-full flex-col sm:flex-row gap-4">
                <div className="flex gap-2 flex-1">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 h-12 md:h-14 font-black uppercase tracking-widest text-[9px] md:text-[10px] text-slate-400">Cancel</Button>
                    <Button variant="outline" onClick={() => setViewTransform({ scale: 1, x: 0, y: 0 })} className="flex-1 h-12 md:h-14 rounded-2xl font-black uppercase tracking-widest text-[9px] md:text-[10px] border-2 bg-white shadow-sm">
                        <Navigation className="w-4 h-4 mr-2 opacity-40" />
                        Reset View
                    </Button>
                </div>
                <Button onClick={handleSave} disabled={isLoading} className="flex-[1.5] h-12 md:h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/30 group">
                    Commit to Dossier <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
