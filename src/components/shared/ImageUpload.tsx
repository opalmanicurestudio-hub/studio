'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ImageUploadProps {
  onImageUploaded: (dataUrl: string) => void;
  initialImage?: string | null;
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  multiple?: boolean;
  clearOnUpload?: boolean;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageUploaded,
  initialImage = null,
  maxSizeMB = 2,
  maxWidthOrHeight = 600,
  multiple = false,
  clearOnUpload = false,
}) => {
  const [imagePreview, setImagePreview] = useState<string | null>(initialImage);
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
          
          // Only show preview for single uploads that aren't auto-clearing
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
        <div className="relative w-32 h-32">
          <div className="w-32 h-32 rounded-md border-2 border-dashed flex items-center justify-center overflow-hidden">
            <img src={imagePreview} alt="Image preview" className="object-cover w-full h-full" />
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -top-2 -right-2 h-7 w-7 rounded-full shadow-lg"
            onClick={handleRemoveImage}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-full h-11 border-2 font-bold" onClick={triggerFileSelect}>
          <Upload className="mr-2 h-4 w-4" />
          {multiple ? 'Upload Batch' : 'Upload Image'}
        </Button>
      )}
    </div>
  );
};
