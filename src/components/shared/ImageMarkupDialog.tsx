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
    GripVertical,
    Navigation,
    Plus
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
type StickerType = 'arrow' | 'star' | 'alert' | 'check' | 'cross' | 'target';

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
}

interface MagnifierLens extends BaseAnnotation {
    type: 'lens';
    r: number;
}

interface Path {
    id: string;
    points: { x: number, y: number }[];
    color: string;
    width: number;
    style: PenStyle;
}

type Annotation = TextAnnotation | StickerAnnotation | MagnifierLens;

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
  
  // Spatial State
  const [viewTransform, setViewTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [lastPinchDist, setLastPinchDist] = useState<number | null>(null);
  const [initialDist, setInitialDist] = useState<number>(1);
  const [initialRotation, setInitialRotation] = useState<number>(0);

  // Data State
  const [paths, setPaths] = useState<Path[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
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

    // 1. Base Image
    const dw = canvas.width / dpr;
    const dh = canvas.height / dpr;
    ctx.drawImage(img, 0, 0, dw, dh);

    // 2. Magnifier Lenses
    annotations.filter(a => a.type === 'lens').forEach(lens => {
        const l = lens as MagnifierLens;
        const r = l.r;
        if (r <= 0) return;
        
        const imgScaleX = img.width / dw;
        const imgScaleY = img.height / dh;

        ctx.save();
        ctx.beginPath();
        ctx.arc(l.x, l.y, r, 0, Math.PI * 2);
        ctx.clip();
        
        // Draw zoomed content
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
        if (selectedId === l.id) {
            ctx.setLineDash([5, 5]);
        }
        ctx.stroke();
        ctx.restore();
    });

    // 3. Drawing Paths
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
        
        if (path.style === 'dashed') {
            ctx.setLineDash([5, 5]);
        } else if (path.style === 'highlighter') {
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = path.width * 5;
        }

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    });

    // 4. Stickers
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

    // 5. Text
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
  }, [annotations, paths, selectedId, viewTransform]);

  // --- INTERACTION LOGIC ---

  const getCoordinates = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const x = (clientX - rect.left);
    const y = (clientY - rect.top);
    return { 
        x: (x - viewTransform.x) / viewTransform.scale, 
        y: (y - viewTransform.y) / viewTransform.scale 
    };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;
    const coords = getCoordinates(e);
    const { x, y } = coords;

    if ('touches' in e && e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dist = Math.hypot(touch1.pageX - touch2.pageX, touch1.pageY - touch2.pageY);
        const angle = Math.atan2(touch2.pageY - touch1.pageY, touch2.pageX - touch1.pageX);
        
        setInitialDist(dist);
        setInitialRotation(angle);
        setLastPinchDist(dist);
        setIsDrawing(false);
        return;
    }

    if (tool === 'pan') {
        setIsPanning(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setLastPanPos({ x: clientX, y: clientY });
        return;
    }

    // Hit Detection
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
        if (a.type === 'sticker') {
            const dist = Math.sqrt(Math.pow(x - a.x, 2) + Math.pow(y - a.y, 2));
            return dist < (30 * a.scale);
        }
        if (a.type === 'lens') {
            const l = a as MagnifierLens;
            const dist = Math.sqrt(Math.pow(x - l.x, 2) + Math.pow(y - l.y, 2));
            return dist < l.r;
        }
        return false;
    });

    if (hit) {
        setSelectedId(hit.id);
        setIsDragging(true);
        if (tool !== 'select') setTool('select');
        return;
    }

    if (tool === 'text') { setTextInput({ x, y, value: '' }); return; }
    if (tool === 'magnifier') { 
        const newLens: MagnifierLens = { id: nanoid(), type: 'lens', x, y, r: 40, color, rotation: 0, scale: 1 };
        setAnnotations(prev => [...prev, newLens]);
        setSelectedId(newLens.id);
        setTool('select');
        return;
    }
    if (tool === 'pencil') { 
        setIsDrawing(true); 
        setPaths(prev => [...prev, { id: nanoid(), color, width: brushSize, style: penStyle, points: [coords] }]); 
    }
    if (tool === 'sticker') { 
        const newSticker: StickerAnnotation = { id: nanoid(), type: 'sticker', stickerType: 'arrow', x, y, color, rotation: 0, scale: 1 };
        setAnnotations(prev => [...prev, newSticker]); 
        setSelectedId(newSticker.id);
        setTool('select');
    }
    
    setSelectedId(null);
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;

    if ('touches' in e && e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dist = Math.hypot(touch1.pageX - touch2.pageX, touch1.pageY - touch2.pageY);
        const angle = Math.atan2(touch2.pageY - touch1.pageY, touch2.pageX - touch1.pageX);

        if (selectedId) {
            const scaleFactor = dist / initialDist;
            const rotationDelta = angle - initialRotation;
            setAnnotations(prev => prev.map(a => a.id === selectedId ? { ...a, scale: a.scale * scaleFactor, rotation: a.rotation + rotationDelta } : a));
            setInitialDist(dist);
            setInitialRotation(angle);
        } else if (lastPinchDist !== null) {
            const delta = dist / lastPinchDist;
            setViewTransform(prev => ({ ...prev, scale: Math.min(5, Math.max(1, prev.scale * delta)) }));
            setLastPinchDist(dist);
        }
        return;
    }

    if (isPanning) {
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setViewTransform(prev => ({ 
            ...prev, 
            x: prev.x + (clientX - lastPanPos.x), 
            y: prev.y + (clientY - lastPanPos.y) 
        }));
        setLastPanPos({ x: clientX, y: clientY });
        return;
    }

    const coords = getCoordinates(e);

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
  };

  const handleMouseUp = () => {
    setIsDrawing(false); 
    setIsDragging(false); 
    setIsPanning(false); 
    setLastPinchDist(null);
  };

  // --- COMPONENT LIFECYCLE ---

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
      drawAll();
    };
    img.src = imageUrl;
  }, [imageUrl, isMobile]); // Remove drawAll from dependency to prevent infinite loops

  useEffect(() => {
    if (open) {
        setPaths([]);
        setAnnotations([]);
        setViewTransform({ scale: 1, x: 0, y: 0 });
        setSelectedId(null);
        setIsLoading(true);
        // Using requestAnimationFrame to ensure the container is measured correctly
        requestAnimationFrame(initCanvas);
    }
  }, [open]);

  useEffect(() => {
    if (!isLoading) {
      drawAll();
    }
  }, [isLoading, annotations, paths, selectedId, viewTransform, color, drawAll]);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput || !textInput.value.trim()) { setTextInput(null); return; }
    const newText: TextAnnotation = { 
        id: nanoid(), type: 'text', text: textInput.value, 
        x: textInput.x, y: textInput.y, color, rotation: 0, scale: 1, size: textSize 
    };
    setAnnotations(prev => [...prev, newText]);
    setTextInput(null); setTool('select'); setSelectedId(newText.id);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSelectedId(null);
    setTool('select');
    // Final draw without selection indicators
    requestAnimationFrame(() => {
        onSave(canvas.toDataURL('image/png'));
        onOpenChange(false);
    });
  };

  const handleUndo = () => {
      if (annotations.length > 0) setAnnotations(prev => prev.slice(0, -1));
      else if (paths.length > 0) setPaths(prev => prev.slice(0, -1));
      else setViewTransform({ scale: 1, x: 0, y: 0 });
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
          <DialogDescription className="sr-only">Visual annotation and magnification interface for treatment records.</DialogDescription>
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
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Brush</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'text' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('text')} className="h-10 w-10 rounded-xl"><TypeIcon className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Notes</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'magnifier' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('magnifier')} className="h-10 w-10 rounded-xl text-indigo-600"><ZoomIn className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Lens</TooltipContent>
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
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Transform</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant={tool === 'pan' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pan')} className="h-10 w-10 rounded-xl"><Hand className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Pan / Pinch Zoom</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        <Separator orientation="vertical" className="h-8 mx-2" />

                        {tool === 'pencil' && (
                            <div className="flex items-center gap-1.5 animate-in slide-in-from-left-2">
                                <Button variant={penStyle === 'solid' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('solid')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Solid</Button>
                                <Button variant={penStyle === 'dashed' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('dashed')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Dashed</Button>
                                <Button variant={penStyle === 'highlighter' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPenStyle('highlighter')} className="h-8 px-3 rounded-lg font-black text-[9px] uppercase">Mark</Button>
                            </div>
                        )}

                        {tool === 'sticker' && (
                            <div className="flex items-center gap-1.5 animate-in slide-in-from-left-2">
                                {(['arrow', 'star', 'alert', 'check', 'cross', 'target'] as StickerType[]).map(t => (
                                    <Button key={t} variant="ghost" size="sm" onClick={() => {
                                        const coords = { x: 100, y: 100 };
                                        const newSticker: StickerAnnotation = { id: nanoid(), type: 'sticker', stickerType: t, x: coords.x, y: coords.y, color, rotation: 0, scale: 1 };
                                        setAnnotations(prev => [...prev, newSticker]);
                                        setSelectedId(newSticker.id);
                                        setTool('select');
                                    }} className="h-8 px-3 rounded-lg">
                                        {t === 'arrow' && <ArrowUpRight className="w-4 h-4" />}
                                        {t === 'star' && <Star className="w-4 h-4" />}
                                        {t === 'alert' && <AlertCircle className="w-4 h-4" />}
                                        {t === 'check' && <Check className="w-4 h-4" />}
                                        {t === 'cross' && <X className="w-4 h-4" />}
                                        {t === 'target' && <Target className="w-4 h-4" />}
                                    </Button>
                                ))}
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
                    className={cn("shadow-2xl rounded-2xl bg-white border-2 cursor-crosshair", isLoading ? "opacity-0" : "opacity-100")}
                />
                
                {textInput && (
                    <form 
                        onSubmit={handleTextSubmit}
                        className="absolute z-[100]"
                        style={{ left: textInput.x * viewTransform.scale + viewTransform.x, top: textInput.y * viewTransform.scale + viewTransform.y - 40 }}
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