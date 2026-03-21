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
import { 
    Pencil, 
    Trash2, 
    Check, 
    X, 
    Sparkles, 
    Undo2, 
    Type, 
    ZoomIn, 
    ZoomOut,
    Palette,
    ArrowRight,
    Loader,
    Maximize2,
    Printer,
    Hand
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';

interface ImageMarkupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSave: (markedUpDataUrl: string) => void;
  title?: string;
}

const colors = [
    { name: 'Primary', value: '#7955c4' }, // Studio Theme
    { name: 'Alert', value: '#ef4444' },   // Red for alerts
    { name: 'Success', value: '#22c55e' }, // Green for targets
    { name: 'Info', value: '#3b82f6' },    // Blue for mapping
    { name: 'White', value: '#ffffff' },   // Highlight
    { name: 'Black', value: '#000000' },   // Contrast
];

export const ImageMarkupDialog: React.FC<ImageMarkupDialogProps> = ({
  open,
  onOpenChange,
  imageUrl,
  onSave,
  title = "Technical Mapping",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<'pencil' | 'text' | 'pan'>('pencil');
  const [color, setColor] = useState(colors[0].value);
  const [brushSize, setBrushSize] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  const [textInput, setTextInput] = useState<{ x: number, y: number, value: string } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    if (imageUrl.startsWith('http')) img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const padding = 40;
      const availWidth = container.clientWidth - padding;
      const availHeight = container.clientHeight - padding;
      const scale = Math.min(availWidth / img.width, availHeight / img.height);
      
      const displayWidth = img.width * scale;
      const displayHeight = img.height * scale;
      const dpr = window.devicePixelRatio || 1;
      
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.font = 'bold 16px Figtree, sans-serif';
      
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
      contextRef.current = ctx;
      setHistory([canvas.toDataURL()]);
      setIsLoading(false);
    };
    img.src = imageUrl;
  }, [imageUrl, color, brushSize]);

  useEffect(() => {
    if (open) {
        setIsLoading(true);
        // Ensure canvas is ready in the next tick
        requestAnimationFrame(() => {
            initCanvas();
        });
    }
  }, [open, initCanvas]);

  useEffect(() => {
    if (contextRef.current) {
      contextRef.current.strokeStyle = color;
      contextRef.current.fillStyle = color;
      contextRef.current.lineWidth = brushSize;
    }
  }, [color, brushSize]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;
    
    if (tool === 'pan') {
        setIsPanning(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        setPanStart({ x: clientX - offset.x, y: clientY - offset.y });
        return;
    }

    if (tool === 'text') {
        const { x, y } = getCoordinates(e);
        setTextInput({ x, y, value: '' });
        return;
    }

    const { x, y } = getCoordinates(e);
    contextRef.current?.beginPath();
    contextRef.current?.moveTo(x, y);
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isPanning) {
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        setOffset({ x: clientX - panStart.x, y: clientY - panStart.y });
        return;
    }

    if (!isDrawing || tool !== 'pencil') return;
    const { x, y } = getCoordinates(e);
    contextRef.current?.lineTo(x, y);
    contextRef.current?.stroke();
  };

  const handleMouseUp = () => {
    if (isDrawing) {
        contextRef.current?.closePath();
        setIsDrawing(false);
        saveHistory();
    }
    setIsPanning(false);
  };

  const saveHistory = () => {
    if (canvasRef.current) {
        setHistory(prev => [...prev, canvasRef.current!.toDataURL()]);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput || !textInput.value.trim() || !contextRef.current) {
        setTextInput(null);
        return;
    }
    const ctx = contextRef.current;
    ctx.fillText(textInput.value.toUpperCase(), textInput.x, textInput.y);
    setTextInput(null);
    saveHistory();
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    const newHistory = history.slice(0, -1);
    setHistory(newHistory);
    const prevState = newHistory[newHistory.length - 1];
    const img = new Image();
    img.src = prevState;
    img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = contextRef.current;
        if (canvas && ctx) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); 
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
    };
  };

  const handleZoom = (delta: number) => {
      setZoom(prev => Math.max(1, Math.min(3, prev + delta)));
      if (zoom + delta === 1) setOffset({ x: 0, y: 0 });
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
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col h-[95vh]">
        <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Technical Mapping</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Annotate and magnify technical assets for clinical precision.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-muted/20 relative flex flex-col md:flex-row">
            <div className="w-full md:w-20 bg-background border-b md:border-b-0 md:border-r p-4 flex md:flex-col items-center justify-center gap-4 flex-shrink-0">
                <div className="flex md:flex-col gap-2">
                    {colors.map((c) => (
                        <button
                            key={c.value}
                            onClick={() => setColor(c.value)}
                            className={cn(
                                "w-8 h-8 rounded-full border-2 transition-all active:scale-90 shadow-sm",
                                color === c.value ? "border-primary scale-110 ring-4 ring-primary/10" : "border-white"
                            )}
                            style={{ backgroundColor: c.value }}
                        />
                    ))}
                </div>
                <Separator className="hidden md:block border-dashed" />
                <div className="flex md:flex-col gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant={tool === 'pencil' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pencil')} className="h-10 w-10 rounded-xl"><Pencil className="w-5 h-5" /></Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-black uppercase text-[9px] tracking-widest border-2">Pencil</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant={tool === 'text' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('text')} className="h-10 w-10 rounded-xl"><Type className="w-5 h-5" /></Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-black uppercase text-[9px] tracking-widest border-2">Add Text</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant={tool === 'pan' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pan')} className="h-10 w-10 rounded-xl"><Hand className="w-5 h-5" /></Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-black uppercase text-[9px] tracking-widest border-2">Pan View</TooltipContent>
                        </Tooltip>
                        <Separator className="my-2 border-dashed" />
                        <Button variant="ghost" size="icon" onClick={() => handleZoom(0.25)} className="h-10 w-10 rounded-xl"><ZoomIn className="w-5 h-5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleZoom(-0.25)} className="h-10 w-10 rounded-xl"><ZoomOut className="w-5 h-5" /></Button>
                        <Separator className="my-2 border-dashed" />
                        <Button variant="ghost" size="icon" onClick={handleUndo} disabled={history.length <= 1} className="h-10 w-10 rounded-xl"><Undo2 className="w-5 h-5" /></Button>
                    </TooltipProvider>
                </div>
            </div>

            <div ref={containerRef} className="flex-1 relative flex items-center justify-center p-4 overflow-hidden">
                <AnimatePresence>
                    {isLoading && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 z-10 gap-4 text-center">
                            <Loader className="w-10 h-10 animate-spin text-primary opacity-40" />
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Buffering...</p>
                        </motion.div>
                    )}
                </AnimatePresence>
                
                <div 
                    style={{ 
                        transform: `scale(${zoom}) translate(${offset.x / zoom}px, ${offset.y / zoom}px)`,
                        transition: isPanning ? 'none' : 'transform 0.2s ease-out'
                    }}
                    className="relative cursor-crosshair"
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
                            className="absolute z-50"
                            style={{ 
                                left: textInput.x, 
                                top: textInput.y,
                                transform: `scale(${1/zoom})`
                            }}
                        >
                            <input 
                                autoFocus
                                value={textInput.value}
                                onChange={e => setTextInput({...textInput, value: e.target.value})}
                                onBlur={() => setTextInput(null)}
                                className="h-8 min-w-[120px] bg-white border-primary border-2 shadow-xl font-black uppercase text-[10px] rounded-lg px-3 focus:outline-none"
                                placeholder="ENTER NOTE..."
                            />
                        </form>
                    )}
                </div>
            </div>
        </div>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
            <div className="flex w-full flex-col sm:flex-row gap-4">
                <div className="flex gap-2 flex-1">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 font-black uppercase tracking-widest text-[10px] text-slate-400">Cancel</Button>
                    <Button variant="outline" onClick={handlePrint} className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2 bg-white shadow-sm">
                        <Printer className="w-4 h-4 mr-2 opacity-40" />
                        Print Mapping
                    </Button>
                </div>
                <Button onClick={handleSave} disabled={isLoading} className="flex-[1.5] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/30 group">
                    Commit to Dossier <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};