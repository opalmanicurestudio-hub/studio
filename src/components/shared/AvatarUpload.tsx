'use client';

import React, { useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera, Loader } from 'lucide-react';
import { uploadImage } from '@/lib/upload-image';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/**
 * AvatarUpload — v1
 *
 * The fix for hard-coded placeholder avatars: any person's photo becomes
 * click-to-upload. Tap the avatar → pick/take a photo → it downscales,
 * uploads, and the new URL is handed to onUploaded, which writes it to
 * whichever doc field the parent owns (staff.avatarUrl, client.avatarUrl,
 * etc.). This component deliberately doesn't write to Firestore itself —
 * the parent knows its doc; this only knows images.
 *
 * Drop-in anywhere: StaffDetailsSheet header, the portal, client
 * profiles, creation dialogs.
 */
export function AvatarUpload({
  url,
  name,
  storagePath,
  onUploaded,
  className,
  fallbackClassName,
  disabled,
}: {
  url?: string;
  name?: string;
  storagePath: string; // e.g. tenants/{tid}/avatars/staff_{id}.jpg
  onUploaded: (url: string) => Promise<void> | void;
  className?: string;
  fallbackClassName?: string;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Not an image', description: 'Please choose a photo.' });
      return;
    }
    setBusy(true);
    try {
      const newUrl = await uploadImage(storagePath, file);
      await onUploaded(newUrl);
      setLocalUrl(newUrl); // instant feedback even before the doc listener catches up
      toast({ title: 'Photo updated' });
    } catch {
      toast({ variant: 'destructive', title: 'Upload failed', description: 'Check your connection and try again.' });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <button
      type="button"
      onClick={() => !disabled && !busy && inputRef.current?.click()}
      className={cn('relative group/avatar shrink-0', disabled && 'cursor-default')}
      title={disabled ? undefined : 'Change photo'}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <Avatar className={className}>
        <AvatarImage src={localUrl || url} className="object-cover" />
        <AvatarFallback className={fallbackClassName}>{(name || '?').charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      {!disabled && (
        <span className={cn(
          'absolute inset-0 rounded-[inherit] flex items-center justify-center bg-black/40 transition-opacity',
          busy ? 'opacity-100' : 'opacity-0 group-hover/avatar:opacity-100',
        )}>
          {busy ? <Loader className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
        </span>
      )}
    </button>
  );
}
