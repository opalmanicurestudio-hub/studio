'use client';

/**
 * ImageUpload — v2 (Storage-backed)
 *
 * SAME external API and UI as v1: callers still receive a string via
 * onImageUploaded and store it wherever they always have. What changed is
 * WHAT that string is: v1 emitted base64 data-URLs stored inside Firestore
 * documents (built when Storage rules were locked — the only option then).
 * That bloats documents toward the 1MB cap and makes every list query
 * download full image bytes. v2 uploads to Firebase Storage and emits a
 * tokened download URL instead — documents stay tiny, browsers cache
 * images, and <img src> renders both forms, so everything already saved
 * as a data-URL keeps displaying unchanged. The migration is passive: old
 * saves render, new saves are URLs.
 *
 * Fallback honesty: if no tenant is resolvable in context (shouldn't
 * happen in admin surfaces, but never crash), v1's data-URL behavior is
 * used, so an upload always succeeds one way or the other.
 *
 * Markup: annotation still happens on the LOCAL image data (kept in a
 * ref) — never on the remote URL, which would hit canvas cross-origin
 * tainting. Opening markup on a previously-saved remote image without a
 * local copy shows a clear toast instead of a cryptic canvas error.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, Edit, Sparkles, Loader } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ImageMarkupDialog } from './ImageMarkupDialog';
import { useTenant } from '@/context/TenantContext';
import { uploadImageBlob, dataUrlToBlob } from '@/lib/upload-image';

interface ImageUploadProps {
  onImageUploaded: (url: string) => void;
  initialImage?: string | null;
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  multiple?: boolean;
  clearOnUpload?: boolean;
  enableMarkup?: boolean;
  /** Storage folder under tenants/{tid}/ — defaults to 'uploads'. */
  storageFolder?: string;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageUploaded,
  initialImage = null,
  maxSizeMB = 2,
  maxWidthOrHeight = 600,
  multiple = false,
  clearOnUpload = false,
  enableMarkup = true,
  storageFolder = 'uploads',
}) => {
  const [imagePreview, setImagePreview] = useState<string | null>(initialImage);
  const [isMarkupOpen, setIsMarkupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The local data-URL of the most recent selection — what markup draws
  // on, so annotation never touches a remote (taintable) URL.
  const localDataUrlRef = useRef<string | null>(null);
  const { toast } = useToast();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  useEffect(() => {
    setImagePreview(initialImage);
  }, [initialImage]);

  const emit = async (dataUrl: string) => {
    // v2 core: try Storage first; fall back to the legacy data-URL so an
    // upload never fails outright just because context is missing.
    if (tenantId) {
      try {
        const path = `tenants/${tenantId}/${storageFolder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const url = await uploadImageBlob(path, dataUrlToBlob(dataUrl));
        return url;
      } catch {
        toast({ variant: 'destructive', title: 'Upload to storage failed', description: 'Saved inline instead — check Storage rules.' });
      }
    }
    return dataUrl; // legacy fallback
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (file.size > maxSizeMB * 1024 * 1024) {
        toast({
          variant: 'destructive',
          title: 'File too large',
          description: `${file.name} is larger than ${maxSizeMB}MB.`,
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          if (width > height) {
            if (width > maxWidthOrHeight) {
              height = Math.round((height * maxWidthOrHeight) / width);
              width = maxWidthOrHeight;
            }
          } else {
            if (height > maxWidthOrHeight) {
              width = Math.round((width * maxWidthOrHeight) / height);
              height = maxWidthOrHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL(file.type);
          localDataUrlRef.current = dataUrl;

          setBusy(true);
          const finalUrl = await emit(dataUrl);
          setBusy(false);

          if (!multiple && !clearOnUpload) {
            setImagePreview(finalUrl);
          }

          onImageUploaded(finalUrl);

          if (clearOnUpload) {
            setImagePreview(null);
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setImagePreview(null);
    localDataUrlRef.current = null;
    onImageUploaded('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const openMarkup = () => {
    // Annotation needs local pixel data. A remote https URL without a
    // local copy would taint the canvas — catch that with a clear message
    // instead of a cryptic canvas SecurityError.
    const source = localDataUrlRef.current || imagePreview;
    if (source && source.startsWith('http')) {
      toast({ title: 'Re-upload to annotate', description: 'Pick the image again to enable markup on it.' });
      return;
    }
    setIsMarkupOpen(true);
  };

  const handleMarkupSave = async (markedUpUrl: string) => {
    localDataUrlRef.current = markedUpUrl;
    setBusy(true);
    const finalUrl = await emit(markedUpUrl);
    setBusy(false);
    setImagePreview(finalUrl);
    onImageUploaded(finalUrl);
  };

  const triggerFileSelect = () => fileInputRef.current?.click();

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageChange}
        className="hidden"
        accept="image/png, image/jpeg, image/webp"
        multiple={multiple}
      />
      {imagePreview && !clearOnUpload ? (
        <div className="flex items-center gap-4">
          <div className="relative w-32 h-32 md:w-40 md:h-40 group">
            <div className="w-full h-full rounded-[1.5rem] border-4 border-white shadow-2xl overflow-hidden flex items-center justify-center bg-muted/20 transition-transform group-hover:scale-105">
              <img src={imagePreview} alt="Image preview" className="object-cover w-full h-full" />
              {busy && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader className="w-5 h-5 text-white animate-spin" />
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute -top-2 -right-2 h-8 w-8 rounded-xl shadow-xl border-2 border-white opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleRemoveImage}
            >
              <X className="h-4 w-4" />
            </Button>

            {enableMarkup && (
                <button
                    type="button"
                    onClick={openMarkup}
                    className="absolute -bottom-2 -right-2 h-10 w-10 bg-primary text-white rounded-xl shadow-xl border-2 border-white flex items-center justify-center hover:bg-primary/90 transition-all active:scale-90 z-10"
                >
                    <Edit className="w-5 h-5" />
                </button>
            )}
          </div>
          {enableMarkup && (
              <div className="hidden sm:block space-y-1">
                  <p className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2">
                      <Sparkles className="w-3 h-3" />
                      Markup Protocol
                  </p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 leading-tight max-w-[120px]">Annotate this visual for technical mapping.</p>
              </div>
          )}
        </div>
      ) : (
        <Button
            type="button"
            variant="outline"
            className="w-full h-14 rounded-2xl border-2 border-dashed font-black uppercase tracking-widest text-[10px] bg-muted/5 shadow-inner hover:bg-primary/[0.02] hover:border-primary/20 transition-all"
            onClick={triggerFileSelect}
            disabled={busy}
        >
          {busy ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4 opacity-40" />}
          {multiple ? 'Upload Batch Protocol' : 'Upload Technical Visual'}
        </Button>
      )}

      {imagePreview && isMarkupOpen && (
          <ImageMarkupDialog
            open={isMarkupOpen}
            onOpenChange={setIsMarkupOpen}
            imageUrl={localDataUrlRef.current || imagePreview}
            onSave={handleMarkupSave}
          />
      )}
    </div>
  );
};
