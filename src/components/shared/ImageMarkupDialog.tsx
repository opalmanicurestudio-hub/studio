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
    Printer,
    Target,
    Type as TypeIcon,
    ZoomIn,
    Move,
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
    GripVertical
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

type ToolType = 'pencil' | 'text' | 'magnifier' | 'select' | 'pan' | 'sticker';
type TextSize = 'sm' | 'md' | 'lg';
type PenStyle = 'solid' | 'dashed' | 'highlighter';
type StickerType = 'arrow' | 'star' | 'alert' | 'check' | 'cross';

interface TextAnnotation {
    id: string;
    text: string;
    x: number;
    y: number;
    color: string;
    size: TextSize;
}

interface Sticker {
    id: string;
    type: StickerType;
    x: number;
    y: number;
    color: string;
    scale: number;
}

interface MagnifierLens {
    id: string;
    x: number;
    y: number;
    r: number;
    color: string;
}

interface Path {
    id: string;
    points: { x: number, y: number }[];
    color: string;
    width: number;
    style: PenStyle;
}

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
  
  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<ToolType>('pencil');
  const [color, setColor] = useState(colors[0].value);
  const [brushSize, setBrushSize] = useState(3);
  const [textSize, setTextSize] = useState<TextSize>('md');
  const [penStyle, setPenStyle] = useState<PenStyle>('solid');
  
  // View State (Zoom/Pan)
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [lastPinchDist, setLastPinchDist] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });

  // Data State
  const [paths, setPaths] = useState<Path[]>([]);
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [lenses, setLenses] = useState<MagnifierLens[]>([]);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [activeLens, setActiveLens] = useState<MagnifierLens | null>(null);
  const [textInput, setTextInput] = useState<{ x: number, y: number, value: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const drawSticker = (ctx: CanvasRenderingContext2D, s: Sticker, sScale: number) => {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(s.scale / sScale, s.scale / sScale);
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (s.type === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(-15, 0);
          ctx.lineTo(15, 0);
          ctx.lineTo(5, -10);
          ctx.moveTo(15, 0);
          ctx.lineTo(5, 10);
          ctx.stroke();
      } else if (s.type === 'star') {
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
              ctx.rotate(Math.PI / 5);
              ctx.lineTo(0, -15);
              ctx.rotate(Math.PI / 5);
              ctx.lineTo(0, -7);
          }
          ctx.closePath();
          ctx.fill();
      } else if (s.type === 'alert') {
          ctx.beginPath();
          ctx.moveTo(0, -15);
          ctx.lineTo(15, 12);
          ctx.lineTo(-15, 12);
          ctx.closePath();
          ctx.stroke();
          ctx.fillRect(-1, -5, 2, 8);
          ctx.fillRect(-1, 6, 2, 2);
      } else if (s.type === 'check') {
          ctx.beginPath();
          ctx.moveTo(-12, 0);
          ctx.lineTo(-3, 10);
          ctx.lineTo(15, -10);
          ctx.stroke();
      } else if (s.type === 'cross') {
          ctx.beginPath();
          ctx.moveTo(-10, -10);
          ctx.lineTo(10, 10);
          ctx.moveTo(10, -10);
          ctx.lineTo(-10, 10);
          ctx.stroke();
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
    
    ctx.translate(offset.x * dpr, offset.y * dpr);
    ctx.scale(scale * dpr, scale * dpr);

    // Layer 1: Base Image
    ctx.drawImage(img, 0, 0, canvas.width / (dpr * scale), canvas.height / (dpr * scale));

    // Layer 2: Magnifier Lenses
    lenses.forEach(lens => {
        const r = lens.r;
        if (r <= 0) return;
        const size = r * 2;
        
        const imgScaleX = img.width / (canvas.width / (dpr * scale));
        const imgScaleY = img.height / (canvas.height / (dpr * scale));

        ctx.save();
        ctx.beginPath();
        ctx.arc(lens.x, lens.y, r, 0, Math.PI * 2);
        ctx.clip();
        
        ctx.drawImage(
            img,
            (lens.x - r/2) * imgScaleX,
            (lens.y - r/2) * imgScaleY,
            r * imgScaleX,
            r * imgScaleY,
            lens.x - r,
            lens.y - r,
            size,
            size
        );

        ctx.strokeStyle = lens.color;
        ctx.lineWidth = 2 / scale;
        if (selectedId === lens.id) {
            ctx.setLineDash([5 / scale, 5 / scale]);
            ctx.shadowBlur = 10 / scale;
            ctx.shadowColor = lens.color;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.restore();
    });

    // Layer 3: Freehand Paths
    paths.forEach(path => {
        if (path.points.length < 2) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.strokeStyle = path.color;
        ctx.lineWidth = path.width / scale;
        
        if (path.style === 'dashed') {
            ctx.setLineDash([5 / scale, 5 / scale]);
        } else if (path.style === 'highlighter') {
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = (path.width * 4) / scale;
        }

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    });

    // Layer 4: Stickers
    stickers.forEach(s => {
        const isSelected = s.id === selectedId;
        if (isSelected) {
            ctx.save();
            ctx.shadowBlur = 10 / scale;
            ctx.shadowColor = s.color;
            ctx.setLineDash([2 / scale, 2 / scale]);
            ctx.strokeRect(s.x - (20 * s.scale)/scale, s.y - (20 * s.scale)/scale, (40 * s.scale)/scale, (40 * s.scale)/scale);
            ctx.restore();
        }
        drawSticker(ctx, s, scale);
    });

    // Layer 5: Text Annotations
    annotations.forEach(anno => {
        const isSelected = anno.id === selectedId;
        const fontSize = anno.size === 'sm' ? 12 : anno.size === 'lg' ? 24 : 16;
        ctx.font = `bold ${fontSize / scale}px Figtree, sans-serif`;
        ctx.fillStyle = anno.color;
        
        if (isSelected) {
            ctx.shadowBlur = 10 / scale;
            ctx.shadowColor = 'rgba(121, 85, 196, 0.5)';
        }
        
        ctx.fillText(anno.text.toUpperCase(), anno.x, anno.y);
        ctx.shadowBlur = 0;

        if (isSelected && tool === 'select') {
            ctx.strokeStyle = '#7955c4';
            ctx.lineWidth = 1 / scale;
            const metrics = ctx.measureText(anno.text.toUpperCase());
            const h = fontSize / scale;
            ctx.setLineDash([2 / scale, 2 / scale]);
            ctx.strokeRect(anno.x - 4/scale, anno.y - h, metrics.width + 8/scale, h + 4/scale);
            ctx.setLineDash([]);
        }
    });

    // Layer 6: Transient Active Lens
    if (activeLens) {
        ctx.setLineDash([5 / scale, 5 / scale]);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(activeLens.x, activeLens.y, activeLens.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }
  }, [annotations, lenses, paths, stickers, selectedId, activeLens, color, tool, scale, offset]);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imageUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseImageRef.current = img;
      const padding = 40;
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
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setIsLoading(false);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => { if (open) { setIsLoading(true); setPaths([]); setAnnotations([]); setLenses([]); setStickers([]); setSelectedId(null); setActiveLens(null); setScale(1); setOffset({ x: 0, y: 0 }); setTimeout(initCanvas, 150); } }, [open, imageUrl, initCanvas]);
  useEffect(() => { if (!isLoading) drawAll(); }, [drawAll, isLoading]);

  const getCoordinates = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = (clientX - rect.left);
    const y = (clientY - rect.top);
    return { x: (x - offset.x) / scale, y: (y - offset.y) / scale };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;
    const coords = getCoordinates(e);
    const { x, y } = coords;

    if ('touches' in e && e.touches.length === 2) {
        setLastPinchDist(Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY));
        return;
    }

    if (tool === 'pan') {
        setIsPanning(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setLastPanPos({ x: clientX, y: clientY });
        return;
    }

    // Hit Detection for Selection/Dragging
    const hitText = [...annotations].reverse().find(anno => {
        const ctx = contextRef.current;
        if (!ctx) return false;
        const fontSize = anno.size === 'sm' ? 12 : anno.size === 'lg' ? 24 : 16;
        ctx.font = `bold ${fontSize / scale}px Figtree, sans-serif`;
        const metrics = ctx.measureText(anno.text.toUpperCase());
        const h = fontSize / scale;
        return x >= anno.x && x <= anno.x + metrics.width && y >= anno.y - h && y <= anno.y;
    });

    const hitSticker = [...stickers].reverse().find(s => {
        const dist = Math.sqrt(Math.pow(x - s.x, 2) + Math.pow(y - s.y, 2));
        return dist < (20 * s.scale) / scale;
    });

    const hitLens = [...lenses].reverse().find(l => {
        const dist = Math.sqrt(Math.pow(x - l.x, 2) + Math.pow(y - l.y, 2));
        return dist < l.r;
    });

    const hit = hitText || hitSticker || hitLens;

    if (hit) {
        setSelectedId(hit.id);
        setIsDragging(true);
        if (tool !== 'select') setTool('select');
        return;
    }

    if (tool === 'text') { setTextInput({ x, y, value: '' }); return; }
    if (tool === 'magnifier') { setActiveLens({ id: nanoid(), x, y, r: 0, color }); return; }
    if (tool === 'pencil') { setIsDrawing(true); setPaths(prev => [...prev, { id: nanoid(), color, width: brushSize, style: penStyle, points: [coords] }]); }
    if (tool === 'sticker') { setStickers(prev => [...prev, { id: nanoid(), type: 'arrow', x, y, color, scale: 1 }]); }
    
    setSelectedId(null);
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;

    if ('touches' in e && e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
        if (lastPinchDist !== null) {
            const delta = dist / lastPinchDist;
            setScale(s => Math.min(5, Math.max(1, s * delta)));
        }
        setLastPinchDist(dist);
        return;
    }

    if (isPanning) {
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const dx = clientX - lastPanPos.x;
        const dy = clientY - lastPanPos.y;
        setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        setLastPanPos({ x: clientX, y: clientY });
        return;
    }

    const coords = getCoordinates(e);

    if (isDragging && selectedId) {
        setAnnotations(prev => prev.map(a => a.id === selectedId ? { ...a, x: coords.x, y: coords.y } : a));
        setStickers(prev => prev.map(s => s.id === selectedId ? { ...s, x: coords.x, y: coords.y } : s));
        setLenses(prev => prev.map(l => l.id === selectedId ? { ...l, x: coords.x, y: coords.y } : l));
        return;
    }

    if (activeLens) {
        const r = Math.sqrt(Math.pow(coords.x - activeLens.x, 2) + Math.pow(coords.y - activeLens.y, 2));
        setActiveLens({ ...activeLens, r });
        return;
    }

    if (isDrawing && tool === 'pencil') {
        setPaths(prev => {
            const last = prev[prev.length - 1];
            if (!last) return prev;
            return [...prev.slice(0, -1), { ...last, points: [...last.points, coords] }];
        });
    }
  };

  const handleMouseUp = () => {
    if (activeLens && activeLens.r > 10) setLenses(prev => [...prev, activeLens]);
    setActiveLens(null); setIsDrawing(false); setIsDragging(false); setIsPanning(false); setLastPinchDist(null);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput || !textInput.value.trim()) { setTextInput(null); return; }
    const newAnnotation: TextAnnotation = { id: nanoid(), text: textInput.value, x: textInput.x, y: textInput.y, color: color, size: textSize };
    setAnnotations(prev => [...prev, newAnnotation]);
    setTextInput(null); setTool('select'); setSelectedId(newAnnotation.id);
  };

  const handleUndo = () => {
      if (lenses.length > 0) setLenses(prev => prev.slice(0, -1));
      else if (annotations.length > 0) setAnnotations(prev => prev.slice(0, -1));
      else if (stickers.length > 0) setStickers(prev => prev.slice(0, -1));
      else if (paths.length > 0) setPaths(prev => prev.slice(0, -1));
      else { setScale(1); setOffset({ x: 0, y: 0 }); }
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

  const deleteSelected = () => {
      if (!selectedId) return;
      setAnnotations(prev => prev.filter(a => a.id !== selectedId));
      setStickers(prev => prev.filter(s => s.id !== selectedId));
      setLenses(prev => prev.filter(l => l.id !== selectedId));
      setSelectedId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl p-0 border-4 rounded-[2.5rem] md:rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col h-[95vh] sm:h-[90vh]">
        <DialogHeader className="p-6 md:p-8 pb-4 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-1.5 md:mb-2 text-left">
            <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />
            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical Mapping</span>
          </div>
          <DialogTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
          <DialogDescription className="sr-only">High-precision technical annotation suite.</DialogDescription>
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
                                        "w-7 h-7 rounded-full border-2 transition-all active:scale-90 shadow-sm",
                                        color === c.value ? "border-primary scale-110 ring-4 ring-primary/10" : "border-white"
                                    )}
                                    style={{ backgroundColor: c.value }}
                                />
                            ))}
                        </div>
                        
                        <Separator orientation="vertical" className="h-8 mx-2" />
                        
                        <div className="flex items-center gap-1.5 md:gap-2">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'pencil' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pencil')} className="h-10 w-10 rounded-xl"><Pencil className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Pencil</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'text' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('text')} className="h-10 w-10 rounded-xl"><TypeIcon className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Add Text</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'magnifier' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('magnifier')} className="h-10 w-10 rounded-xl text-indigo-600"><ZoomIn className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Detail Lens</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'sticker' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('sticker')} className="h-10 w-10 rounded-xl"><Target className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Stickers</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'select' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('select')} className="h-10 w-10 rounded-xl"><MousePointer2 className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Select / Move</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'pan' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pan')} className="h-10 w-10 rounded-xl"><Hand className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Pan / Touch Zoom</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        <Separator orientation="vertical" className="h-8 mx-2" />

                        {tool === 'pencil' && (
                            <div className="flex items-center gap-1.5">
                                <Button variant={penStyle === 'solid' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('solid')} className="h-8 px-3 rounded-lg"><Minus className="w-4 h-4"/></Button>
                                <Button variant={penStyle === 'dashed' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('dashed')} className="h-8 px-3 rounded-lg"><GripVertical className="w-4 h-4 rotate-90" /></Button>
                                <Button variant={penStyle === 'highlighter' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('highlighter')} className="h-8 px-3 rounded-lg"><Highlighter className="w-4 h-4" /></Button>
                            </div>
                        )}

                        {tool === 'sticker' && (
                            <div className="flex items-center gap-1.5">
                                {(['arrow', 'star', 'alert', 'check', 'cross'] as StickerType[]).map(t => (
                                    <Button key={t} variant="ghost" size="sm" onClick={() => setStickers(prev => [...prev, { id: nanoid(), type: t, x: 100, y: 100, color, scale: 1 }])} className="h-8 px-3 rounded-lg">
                                        {t === 'arrow' && <ArrowUpRight className="w-4 h-4" />}
                                        {t === 'star' && <Star className="w-4 h-4" />}
                                        {t === 'alert' && <AlertCircle className="w-4 h-4" />}
                                        {t === 'check' && <Check className="w-4 h-4" />}
                                        {t === 'cross' && <X className="w-4 h-4" />}
                                    </Button>
                                ))}
                            </div>
                        )}

                        {(tool === 'text' || selectedId) && (
                            <div className="flex items-center gap-1.5">
                                {(['sm', 'md', 'lg'] as TextSize[]).map(size => (
                                    <Button
                                        key={size}
                                        variant={textSize === size ? 'secondary' : 'ghost'}
                                        size="sm"
                                        onClick={() => {
                                            setTextSize(size);
                                            if (selectedId) {
                                                setAnnotations(prev => prev.map(a => a.id === selectedId ? { ...a, size } : a));
                                                setStickers(prev => prev.map(s => s.id === selectedId ? { ...s, scale: size === 'sm' ? 0.7 : size === 'lg' ? 1.5 : 1 } : s));
                                            }
                                        }}
                                        className="h-8 px-3 rounded-lg font-black uppercase text-[9px]"
                                    >
                                        {size}
                                    </Button>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-2 ml-auto">
                            {selectedId && <Button variant="ghost" size="icon" onClick={deleteSelected} className="h-10 w-10 rounded-xl text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></Button>}
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
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Buffering...</p>
                    </div>
                )}
                
                <div 
                    className="relative" 
                    style={{ 
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                        transformOrigin: 'top left',
                        cursor: tool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : (tool === 'pencil' ? 'crosshair' : 'default')
                    }}
                >
                    <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onTouchStart={handleMouseDown}
                        onTouchMove={handleMouseMove}
                        onTouchEnd={handleMouseUp}
                        className={cn("shadow-2xl rounded-2xl bg-white border-2", isLoading ? "opacity-0" : "opacity-100")}
                    />
                    
                    {textInput && (
                        <form 
                            onSubmit={handleTextSubmit}
                            className="absolute z-[100]"
                            style={{ left: textInput.x, top: textInput.y - 40 }}
                        >
                            <input 
                                autoFocus
                                value={textInput.value}
                                onChange={e => setTextInput(prev => prev ? {...prev, value: e.target.value} : null)}
                                onBlur={handleTextSubmit}
                                className="h-10 min-w-[160px] bg-white border-primary border-4 shadow-3xl font-black uppercase text-xs rounded-xl px-4 focus:outline-none ring-4 ring-primary/10"
                                placeholder="ENTER NOTE..."
                            />
                        </form>
                    )}
                </div>
            </div>
        </div>

        <DialogFooter className="p-6 md:p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
            <div className="flex w-full flex-col sm:flex-row gap-4">
                <div className="flex gap-2 flex-1">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 h-12 md:h-14 font-black uppercase tracking-widest text-[9px] md:text-[10px] text-slate-400">Cancel</Button>
                    <Button variant="outline" onClick={() => window.print()} className="flex-1 h-12 md:h-14 rounded-2xl font-black uppercase tracking-widest text-[9px] md:text-[10px] border-2 bg-white shadow-sm">
                        <Printer className="w-4 h-4 mr-2 opacity-40" />
                        Print Record
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
