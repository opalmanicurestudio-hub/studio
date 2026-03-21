'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, Edit, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ImageMarkupDialog } from './ImageMarkupDialog';

interface ImageUploadProps {
  onImageUploaded: (dataUrl: string) => void;
  initialImage?: string | null;
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  multiple?: boolean;
  clearOnUpload?: boolean;
  enableMarkup?: boolean;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageUploaded,
  initialImage = null,
  maxSizeMB = 2,
  maxWidthOrHeight = 600,
  multiple = false,
  clearOnUpload = false,
  enableMarkup = true,
}) => {
  const [imagePreview, setImagePreview] = useState<string | null>(initialImage);
  const [isMarkupOpen, setIsMarkupOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    setImagePreview(initialImage);
  }, [initialImage]);

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
        img.onload = () => {
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
          
          if (!multiple && !clearOnUpload) {
            setImagePreview(dataUrl);
          }
          
          onImageUploaded(dataUrl);
          
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
    onImageUploaded('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMarkupSave = (markedUpUrl: string) => {
      setImagePreview(markedUpUrl);
      onImageUploaded(markedUpUrl);
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
                    onClick={() => setIsMarkupOpen(true)}
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
        >
          <Upload className="mr-2 h-4 w-4 opacity-40" />
          {multiple ? 'Upload Batch Protocol' : 'Upload Technical Visual'}
        </Button>
      )}

      {imagePreview && isMarkupOpen && (
          <ImageMarkupDialog 
            open={isMarkupOpen}
            onOpenChange={setIsMarkupOpen}
            imageUrl={imagePreview}
            onSave={handleMarkupSave}
          />
      )}
    </div>
  );
};
