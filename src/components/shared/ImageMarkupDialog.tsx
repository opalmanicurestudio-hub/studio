'use client';

import React, { useRef, useState, useEffect } from 'react';
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
    RotateCcw, 
    Trash2, 
    Check, 
    X, 
    Sparkles, 
    Undo2, 
    Circle, 
    Square as SquareIcon,
    Palette,
    ArrowRight,
    Loader,
    Maximize2,
    Printer
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';

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
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState(colors[0].value);
  const [brushSize, setBrushSize] = useState(3);
  const [history, setHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize Canvas and draw image
  useEffect(() => {
    if (!open || !imageUrl) {
        setIsLoading(false);
        return;
    }

    let isMounted = true;
    setIsLoading(true);

    const initCanvas = () => {
      const canvas = canvasRef.current;
      
      if (!canvas) {
          if (isMounted) requestAnimationFrame(initCanvas);
          return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      
      if (imageUrl.startsWith('http')) {
          img.crossOrigin = "anonymous";
      }
      
      img.onload = () => {
        if (!isMounted) return;

        const dpr = window.devicePixelRatio || 1;
        // Allow the canvas to be larger than the container for scrolling
        const targetWidth = Math.max(window.innerWidth * 0.7, 800);
        const scale = targetWidth / img.width;
        const displayWidth = img.width * scale;
        const displayHeight = img.height * scale;

        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;

        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
        
        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
        contextRef.current = ctx;
        
        setHistory([canvas.toDataURL()]);
        setIsLoading(false);
      };

      img.onerror = (err) => {
          if (!isMounted) return;
          console.error("Technical asset load failure:", err);
          setIsLoading(false);
      };

      img.src = imageUrl;
    };

    const timer = setTimeout(initCanvas, 50);

    return () => {
        isMounted = false;
        clearTimeout(timer);
    };
  }, [open, imageUrl]);

  useEffect(() => {
    if (contextRef.current) {
      contextRef.current.strokeStyle = color;
      contextRef.current.lineWidth = brushSize;
    }
  }, [color, brushSize]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { offsetX: 0, offsetY: 0 };

    const rect = canvas.getBoundingClientRect();
    if ('touches' in e && e.touches.length > 0) {
      return {
        offsetX: e.touches[0].clientX - rect.left,
        offsetY: e.touches[0].clientY - rect.top,
      };
    } else {
      const mouseEvent = e as React.MouseEvent;
      return {
        offsetX: mouseEvent.nativeEvent.offsetX,
        offsetY: mouseEvent.nativeEvent.offsetY,
      };
    }
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLoading) return;
    const { offsetX, offsetY } = getCoordinates(e);
    contextRef.current?.beginPath();
    contextRef.current?.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || isLoading) return;
    const { offsetX, offsetY } = getCoordinates(e);
    contextRef.current?.lineTo(offsetX, offsetY);
    contextRef.current?.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
        contextRef.current?.closePath();
        setIsDrawing(false);
        if (canvasRef.current) {
            setHistory(prev => [...prev, canvasRef.current!.toDataURL()]);
        }
    }
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
            ctx.drawImage(img, 0, 0);
            ctx.restore();
        }
    };
  };

  const handlePrint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const dataUrl = canvas.toDataURL('image/png');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    printWindow.document.write(`
      <html>
        <head>
          <title>${title} - Certified Record</title>
          <style>
            body { 
                margin: 0; 
                display: flex; 
                flex-direction: column;
                align-items: center; 
                justify-content: center; 
                min-height: 100vh;
                background: white;
                font-family: sans-serif;
            }
            .container { padding: 2rem; text-align: center; }
            img { max-width: 100%; height: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 1px solid #eee; }
            h1 { margin-bottom: 1rem; font-size: 1.5rem; text-transform: uppercase; letter-spacing: 0.1em; }
            p { color: #666; font-size: 0.8rem; margin-top: 1rem; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>${title}</h1>
            <img src="${dataUrl}" onload="window.print();window.close();" />
            <p>ClarityFlow Studio OS - Professional Technical Archive</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSave = () => {
    if (canvasRef.current) {
      onSave(canvasRef.current.toDataURL('image/png'));
      onOpenChange(false);
    }
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
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Annotate the visual record for technical precision.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-muted/20 relative flex flex-col md:flex-row">
            {/* TOOLBAR */}
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
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={handleUndo} 
                                    disabled={history.length <= 1 || isLoading} 
                                    className="h-10 w-10 rounded-xl hover:bg-primary/10"
                                >
                                    <Undo2 className="w-5 h-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-black uppercase text-[10px] tracking-widest border-2">Undo Stroke</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            <ScrollArea className="flex-1 cursor-crosshair relative">
                <div className="p-8 flex items-center justify-center min-h-full min-w-max">
                    <AnimatePresence>
                        {isLoading && (
                            <motion.div 
                                initial={{ opacity: 0 }} 
                                animate={{ opacity: 1 }} 
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 z-10 gap-4"
                            >
                                <Loader className="w-10 h-10 animate-spin text-primary opacity-40" />
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Buffering Asset...</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <canvas
                        ref={canvasRef}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                        className={cn("shadow-2xl rounded-2xl bg-white border-2 transition-opacity duration-500", isLoading ? "opacity-0" : "opacity-100")}
                    />
                </div>
                <ScrollBar orientation="horizontal" />
                <ScrollBar orientation="vertical" />
            </ScrollArea>
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
