
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
    Move
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

type ToolType = 'pencil' | 'text' | 'magnifier' | 'select';
type TextSize = 'sm' | 'md' | 'lg';

interface TextAnnotation {
    id: string;
    text: string;
    x: number;
    y: number;
    color: string;
    size: TextSize;
}

interface MagnifierLens {
    id: string;
    x: number;
    y: number;
    r: number;
    color: string;
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
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<ToolType>('pencil');
  const [color, setColor] = useState(colors[0].value);
  const [brushSize, setBrushSize] = useState(3);
  const [textSize, setTextSize] = useState<TextSize>('md');
  
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [lenses, setLenses] = useState<MagnifierLens[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [isDraggingText, setIsDraggingText] = useState(false);

  // Transient state for drawing a new lens
  const [activeLens, setActiveLens] = useState<MagnifierLens | null>(null);

  const [textInput, setTextInput] = useState<{ x: number, y: number, value: string } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Primary Drawing Engine
  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    const img = baseImageRef.current;
    if (!canvas || !ctx || !img) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Layer 1: Base Layer (Fit to screen scaling)
    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);

    // Layer 2: Persistent Magnifier Lenses
    lenses.forEach(lens => {
        const r = lens.r;
        if (r <= 0) return;
        const size = r * 2;
        
        // Map logical coordinates to source resolution
        const imgScaleX = img.width / (canvas.width / dpr);
        const imgScaleY = img.height / (canvas.height / dpr);

        ctx.save();
        ctx.beginPath();
        ctx.arc(lens.x, lens.y, r, 0, Math.PI * 2);
        ctx.clip();
        
        // Draw the 2x magnified portion
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
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    });

    // Layer 3: Text Annotations (Interactive Layer)
    annotations.forEach(anno => {
        const isSelected = anno.id === selectedTextId;
        ctx.font = `bold ${anno.size === 'sm' ? '12px' : anno.size === 'lg' ? '24px' : '16px'} Figtree, sans-serif`;
        ctx.fillStyle = anno.color;
        
        if (isSelected) {
            ctx.shadowBlur = 15;
            ctx.shadowColor = 'rgba(121, 85, 196, 0.4)';
        }
        
        ctx.fillText(anno.text.toUpperCase(), anno.x, anno.y);
        ctx.shadowBlur = 0;

        if (isSelected && tool === 'select') {
            ctx.strokeStyle = '#7955c4';
            ctx.lineWidth = 1;
            const metrics = ctx.measureText(anno.text.toUpperCase());
            const h = anno.size === 'sm' ? 12 : anno.size === 'lg' ? 24 : 16;
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(anno.x - 4, anno.y - h, metrics.width + 8, h + 4);
            ctx.setLineDash([]);
        }
    });

    // Layer 4: Transient Input (Current active lens being drawn)
    if (activeLens) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(activeLens.x, activeLens.y, activeLens.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }
  }, [annotations, lenses, selectedTextId, activeLens, color, tool]);

  // Decoupled Initialization Logic
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imageUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseImageRef.current = img;
      
      // Calculate fit-to-screen scaling
      const padding = 40;
      const availW = container.clientWidth - padding;
      const availH = container.clientHeight - padding;
      const scale = Math.min(availW / img.width, availH / img.height);
      
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dpr = window.devicePixelRatio || 1;
      
      canvas.width = dw * dpr;
      canvas.height = dh * dpr;
      canvas.style.width = `${dw}px`;
      canvas.style.height = `${dh}px`;
      
      contextRef.current = canvas.getContext('2d');
      setIsLoading(false);
      
      // Ensure visual buffer is updated after canvas resize
      requestAnimationFrame(() => {
          drawAll();
      });
    };
    img.src = imageUrl;
  }, [imageUrl, drawAll]);

  // STABLE: Reset logic triggered only by open/image changes
  useEffect(() => {
    if (open) {
        setIsLoading(true);
        setAnnotations([]);
        setLenses([]);
        setHistory([]);
        // Use requestAnimationFrame to ensure the container is measured after paint
        const timeout = setTimeout(() => {
            initCanvas();
        }, 100);
        return () => clearTimeout(timeout);
    }
  }, [open, imageUrl, initCanvas]); 

  // STABLE: Visual sync effect
  useEffect(() => {
      if (!isLoading) {
          drawAll();
      }
  }, [drawAll, isLoading]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    return {
      x: (clientX - rect.left),
      y: (clientY - rect.top),
    };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;
    const { x, y } = getCoordinates(e);

    // Text Selection Logic
    const clickedText = [...annotations].reverse().find(anno => {
        const ctx = contextRef.current;
        if (!ctx) return false;
        ctx.font = `bold ${anno.size === 'sm' ? '12px' : anno.size === 'lg' ? '24px' : '16px'} Figtree, sans-serif`;
        const metrics = ctx.measureText(anno.text.toUpperCase());
        const h = anno.size === 'sm' ? 12 : anno.size === 'lg' ? 24 : 16;
        return x >= anno.x && x <= anno.x + metrics.width && y >= anno.y - h && y <= anno.y;
    });

    if (clickedText) {
        setSelectedTextId(clickedText.id);
        setIsDraggingText(true);
        setTool('select');
        return;
    }

    if (tool === 'text') {
        setTextInput({ x, y, value: '' });
        return;
    }

    if (tool === 'magnifier') {
        setActiveLens({ id: nanoid(), x, y, r: 0, color });
        return;
    }

    if (tool === 'pencil') {
        const ctx = contextRef.current;
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        setIsDrawing(true);
    }
    
    setSelectedTextId(null);
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getCoordinates(e);

    if (isDraggingText && selectedTextId) {
        setAnnotations(prev => prev.map(a => a.id === selectedTextId ? { ...a, x, y } : a));
        return;
    }

    if (activeLens) {
        const r = Math.sqrt(Math.pow(x - activeLens.x, 2) + Math.pow(y - activeLens.y, 2));
        setActiveLens({ ...activeLens, r });
        return;
    }

    if (!isDrawing || tool !== 'pencil' || !contextRef.current) return;
    contextRef.current.lineTo(x, y);
    contextRef.current.stroke();
  };

  const handleMouseUp = () => {
    if (activeLens && activeLens.r > 10) {
        setLenses(prev => [...prev, activeLens]);
        setActiveLens(null);
    } else {
        setActiveLens(null);
    }

    if (isDrawing) {
        contextRef.current?.closePath();
        setIsDrawing(false);
    }
    setIsDraggingText(false);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput || !textInput.value.trim()) {
        setTextInput(null);
        return;
    }
    const newAnnotation: TextAnnotation = {
        id: nanoid(),
        text: textInput.value,
        x: textInput.x,
        y: textInput.y,
        color: color,
        size: textSize
    };
    setAnnotations(prev => [...prev, newAnnotation]);
    setTextInput(null);
    setTool('select');
    setSelectedTextId(newAnnotation.id);
  };

  const handleUndo = () => {
      // Prioritize removing lenses then annotations
      if (lenses.length > 0) {
          setLenses(prev => prev.slice(0, -1));
      } else if (annotations.length > 0) {
          setAnnotations(prev => prev.slice(0, -1));
      } else {
          initCanvas();
      }
  };

  const handlePrint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>${title}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:white;font-family:sans-serif;}.container{padding:2rem;text-align:center;}img{max-width:100%;height:auto;box-shadow:0 10px 30px rgba(0,0,0,0.1); border:1px solid #eee;}h1{margin-bottom:1rem;font-size:1.5rem;text-transform:uppercase;letter-spacing:0.1em;}p{color:#666;font-size:0.8rem;margin-top:1rem;}</style></head><body><div class="container"><h1>${title}</h1><img src="${dataUrl}" onload="window.print();window.close();"/><p>ClarityFlow Studio OS - Professional Technical Archive</p></div></body></html>`);
    printWindow.document.close();
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSelectedTextId(null);
    requestAnimationFrame(() => {
        onSave(canvas.toDataURL('image/png'));
        onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl p-0 border-4 rounded-[2.5rem] md:rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col h-[95vh] sm:h-[90vh]">
        <DialogHeader className="p-6 md:p-8 pb-4 border-b bg-muted/5 text-left flex-shrink-0">
          <div className="flex items-center gap-3 mb-1.5 md:mb-2 text-left">
            <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />
            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical Mapping</span>
          </div>
          <DialogTitle className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
          <DialogDescription className="sr-only">Annotate and magnify technical assets for clinical precision.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-muted/20 relative flex flex-col">
            {/* SCROLLABLE TOOLBAR RIBBON */}
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
                                        <Button variant={tool === 'select' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('select')} className="h-10 w-10 rounded-xl"><Move className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="font-black uppercase text-[9px] border-2">Move / Scale</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        <Separator orientation="vertical" className="h-8 mx-2" />

                        <div className="flex items-center gap-1.5">
                            {(['sm', 'md', 'lg'] as TextSize[]).map(size => (
                                <Button
                                    key={size}
                                    variant={textSize === size ? 'secondary' : 'ghost'}
                                    size="sm"
                                    onClick={() => {
                                        setTextSize(size);
                                        if (selectedTextId) {
                                            setAnnotations(prev => prev.map(a => a.id === selectedTextId ? { ...a, size } : a));
                                        }
                                    }}
                                    className="h-8 px-3 rounded-lg font-black uppercase text-[9px]"
                                >
                                    {size}
                                </Button>
                            ))}
                        </div>

                        <div className="flex gap-2 ml-auto">
                            <Button variant="ghost" size="icon" onClick={handleUndo} className="h-10 w-10 rounded-xl text-slate-400 hover:bg-muted"><Undo2 className="w-5 h-5" /></Button>
                        </div>
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </div>

            <div ref={containerRef} className="flex-1 relative flex items-center justify-center p-4 overflow-hidden touch-none select-none">
                <AnimatePresence>
                    {isLoading && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 z-10 gap-4 text-center">
                            <Loader className="w-10 h-10 animate-spin text-primary opacity-40" />
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Buffering...</p>
                        </motion.div>
                    )}
                </AnimatePresence>
                
                <div className="relative group">
                    <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onTouchStart={handleMouseDown}
                        onTouchMove={handleMouseMove}
                        onTouchEnd={handleMouseUp}
                        className={cn("shadow-2xl rounded-2xl bg-white border-2", isLoading ? "opacity-0" : "opacity-100", tool === 'pencil' ? 'cursor-crosshair' : 'cursor-default')}
                    />
                    
                    {textInput && (
                        <form 
                            onSubmit={handleTextSubmit}
                            className="absolute z-[100]"
                            style={{ 
                                left: textInput.x, 
                                top: textInput.y - 40,
                            }}
                        >
                            <input 
                                autoFocus
                                value={textInput.value}
                                onChange={e => setTextInput(prev => prev ? {...prev, value: e.target.value} : null)}
                                onBlur={handleTextSubmit}
                                className="h-10 min-w-[160px] bg-white border-primary border-4 shadow-3xl font-black uppercase text-xs rounded-xl px-4 focus:outline-none ring-4 ring-primary/10"
                                placeholder="ENTER CLINICAL NOTE..."
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
                    <Button variant="outline" onClick={handlePrint} className="flex-1 h-12 md:h-14 rounded-2xl font-black uppercase tracking-widest text-[9px] md:text-[10px] border-2 bg-white shadow-sm">
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
