'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, Check, FileSignature, ChevronDown, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { useFirebase } from '@/firebase';
import { type ConsentForm } from '@/lib/data';
import { nanoid } from 'nanoid';

interface ConsentSignatureDialogProps {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  form:           ConsentForm;
  client:         { id: string; name: string; email?: string };
  tenantId:       string;
  appointmentId?: string;
  onComplete:     (signatureRecord: SignatureRecord) => void;
}

export interface SignatureRecord {
  id:             string;
  formId:         string;
  formTitle:      string;
  clientId:       string;
  clientName:     string;
  tenantId:       string;
  appointmentId?: string;
  signatureUrl:   string;   // Firebase Storage URL
  signatureData:  string;   // base64 data URL (kept for evidence package)
  formSnapshot:   any;      // copy of form at time of signing
  signedAt:       string;
  ipAddress?:     string;
}

// ─── Signature Canvas ─────────────────────────────────────────────────────────
function SignatureCanvas({ onSign }: { onSign: (hasSignature: boolean) => void }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const isDrawing  = useRef(false);
  const lastPos    = useRef<{ x: number; y: number } | null>(null);
  const hasStrokes = useRef(false);

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDrawing = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    lastPos.current   = getPos(e, canvas);
  }, []);

  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas?.getContext('2d');
    if (!canvas || !ctx || !lastPos.current) return;

    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();

    lastPos.current  = pos;
    hasStrokes.current = true;
    onSign(true);
  }, [onSign]);

  const stopDrawing = useCallback(() => {
    isDrawing.current = false;
    lastPos.current   = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown',  startDrawing, { passive: false });
    canvas.addEventListener('mousemove',  draw,         { passive: false });
    canvas.addEventListener('mouseup',    stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove',  draw,         { passive: false });
    canvas.addEventListener('touchend',   stopDrawing);

    return () => {
      canvas.removeEventListener('mousedown',  startDrawing);
      canvas.removeEventListener('mousemove',  draw);
      canvas.removeEventListener('mouseup',    stopDrawing);
      canvas.removeEventListener('mouseleave', stopDrawing);
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove',  draw);
      canvas.removeEventListener('touchend',   stopDrawing);
    };
  }, [startDrawing, draw, stopDrawing]);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx    = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
    onSign(false);
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={680}
        height={200}
        className="w-full border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50 touch-none cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
      <button
        onClick={clear}
        className="absolute top-3 right-3 p-2 rounded-xl bg-white border-2 border-slate-200 text-slate-400 hover:text-destructive hover:border-destructive/20 transition-all"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
      <p className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-black uppercase tracking-widest text-slate-300 pointer-events-none select-none">
        Sign here
      </p>
    </div>
  );
}

// ─── Main Dialog ──────────────────────────────────────────────────────────────
export function ConsentSignatureDialog({
  open, onOpenChange, form, client, tenantId, appointmentId, onComplete,
}: ConsentSignatureDialogProps) {
  const { firebaseApp } = useFirebase();
  const [hasSigned,   setHasSigned]   = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const scrollRef     = useRef<HTMLDivElement>(null);

  // Find the actual canvas element inside SignatureCanvas
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (open) { setHasSigned(false); setIsSubmitting(false); setHasScrolled(false); }
  }, [open]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
    if (atBottom) setHasScrolled(true);
  };

  const handleSubmit = async () => {
    if (!hasSigned || !firebaseApp) return;
    setIsSubmitting(true);

    try {
      // Get signature data from canvas
      const canvas = document.querySelector('#consent-signature-canvas') as HTMLCanvasElement;
      if (!canvas) throw new Error('Canvas not found');

      const signatureData = canvas.toDataURL('image/png');
      const sigId         = nanoid();

      // Upload to Firebase Storage
      const storage  = getStorage(firebaseApp);
      const filePath = `tenants/${tenantId}/signatures/${sigId}.png`;
      const fileRef  = storageRef(storage, filePath);

      await uploadString(fileRef, signatureData, 'data_url');
      const signatureUrl = await getDownloadURL(fileRef);

      const record: SignatureRecord = {
        id:            sigId,
        formId:        form.id,
        formTitle:     form.title,
        clientId:      client.id,
        clientName:    client.name,
        tenantId,
        appointmentId,
        signatureUrl,
        signatureData, // keep locally for immediate evidence use
        formSnapshot:  form,
        signedAt:      new Date().toISOString(),
      };

      onComplete(record);
      onOpenChange(false);
    } catch (err) {
      console.error('Signature upload failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render form content for display
  const renderFormContent = () => {
    if (!form.fields || form.fields.length === 0) {
      return (
        <div className="prose prose-sm max-w-none">
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{form.content || form.title}</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {form.fields.map((field: any) => {
          if (field.type === 'heading') {
            return <h3 key={field.id} className="text-base font-black uppercase tracking-tight text-slate-900 border-b pb-2 mt-6">{field.label}</h3>;
          }
          if (field.type === 'paragraph') {
            return <p key={field.id} className="text-sm text-slate-600 leading-relaxed">{field.label}</p>;
          }
          if (field.type === 'signature') return null;
          return (
            <div key={field.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{field.label}</p>
              {field.required && <p className="text-[10px] text-slate-500 italic">Required acknowledgment</p>}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-[2rem] border-4 shadow-3xl p-0 overflow-hidden h-[90dvh] !flex flex-col !gap-0">
        <DialogHeader className="p-6 pb-4 border-b bg-muted/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <FileSignature className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black uppercase tracking-tighter text-slate-900 text-left">
                {form.title}
              </DialogTitle>
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mt-0.5">
                {client.name} · Please read and sign below
              </p>
            </div>
          </div>
          {form.category && (
            <Badge className="w-fit mt-2 bg-primary/10 text-primary border-none font-black text-[9px] uppercase tracking-widest">
              {form.category}
            </Badge>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6" onScroll={handleScroll}>
          {/* Form content */}
          <div className="bg-white rounded-2xl border-2 p-5">
            {renderFormContent()}
          </div>

          {/* Scroll indicator */}
          {!hasScrolled && (
            <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 animate-bounce">
              <ChevronDown className="w-3.5 h-3.5" />
              Scroll to read full agreement
            </div>
          )}

          {/* Signature section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Client Signature
              </p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            {/* Canvas with stable ID so we can query it */}
            <div className="relative">
              <canvas
                id="consent-signature-canvas"
                width={680}
                height={200}
                className="w-full border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50 touch-none cursor-crosshair"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  const canvas = e.currentTarget;
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return;
                  const startDraw = (ev: MouseEvent) => {
                    const rect   = canvas.getBoundingClientRect();
                    const scaleX = canvas.width  / rect.width;
                    const scaleY = canvas.height / rect.height;
                    ctx.beginPath();
                    ctx.moveTo((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY);
                    const draw = (ev2: MouseEvent) => {
                      ctx.lineTo((ev2.clientX - rect.left) * scaleX, (ev2.clientY - rect.top) * scaleY);
                      ctx.strokeStyle = '#0f172a';
                      ctx.lineWidth   = 2.5;
                      ctx.lineCap     = 'round';
                      ctx.lineJoin    = 'round';
                      ctx.stroke();
                      setHasSigned(true);
                    };
                    const stop = () => {
                      window.removeEventListener('mousemove', draw);
                      window.removeEventListener('mouseup',   stop);
                    };
                    window.addEventListener('mousemove', draw);
                    window.addEventListener('mouseup',   stop);
                  };
                  startDraw(e.nativeEvent);
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  const canvas = e.currentTarget;
                  const ctx    = canvas.getContext('2d');
                  if (!ctx) return;
                  const rect   = canvas.getBoundingClientRect();
                  const scaleX = canvas.width  / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const touch  = e.touches[0];
                  ctx.beginPath();
                  ctx.moveTo((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
                  const drawTouch = (ev: TouchEvent) => {
                    ev.preventDefault();
                    const t = ev.touches[0];
                    ctx.lineTo((t.clientX - rect.left) * scaleX, (t.clientY - rect.top) * scaleY);
                    ctx.strokeStyle = '#0f172a';
                    ctx.lineWidth   = 2.5;
                    ctx.lineCap     = 'round';
                    ctx.lineJoin    = 'round';
                    ctx.stroke();
                    setHasSigned(true);
                  };
                  const stopTouch = () => {
                    canvas.removeEventListener('touchmove', drawTouch);
                    canvas.removeEventListener('touchend',  stopTouch);
                  };
                  canvas.addEventListener('touchmove', drawTouch, { passive: false });
                  canvas.addEventListener('touchend',  stopTouch);
                }}
              />
              <button
                onClick={() => {
                  const canvas = document.getElementById('consent-signature-canvas') as HTMLCanvasElement;
                  const ctx    = canvas?.getContext('2d');
                  if (canvas && ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    setHasSigned(false);
                  }
                }}
                className="absolute top-3 right-3 p-2 rounded-xl bg-white border-2 border-slate-200 text-slate-400 hover:text-destructive hover:border-destructive/20 transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              {!hasSigned && (
                <p className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-black uppercase tracking-widest text-slate-300 pointer-events-none select-none">
                  Sign here
                </p>
              )}
            </div>

            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
              By signing above, {client.name} acknowledges reading and agreeing to the terms of this document. This signature is legally binding.
            </p>
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 border-t flex-shrink-0 flex flex-col gap-3">
          <Button
            onClick={handleSubmit}
            disabled={!hasSigned || isSubmitting}
            className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-primary/20"
          >
            {isSubmitting
              ? <><Loader className="w-4 h-4 animate-spin mr-2" /> Saving Signature...</>
              : <><Check className="w-4 h-4 mr-2" /> Confirm & Submit Signature</>}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="w-full font-bold uppercase text-[10px] tracking-widest"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}