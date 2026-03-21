'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Checkbox } from '../ui/checkbox';
import { Button } from '../ui/button';
import { ImageUpload } from '../shared/ImageUpload';
import SignatureCanvas from 'react-signature-canvas';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Signature } from 'lucide-react';
import { FormField } from '@/lib/data';

interface FormFieldRendererProps {
  field: FormField;
  value?: any;
  onChange?: (value: any) => void;
}

export const FormFieldRenderer: React.FC<FormFieldRendererProps> = ({ field, value, onChange }) => {
  const sigCanvas = useRef<SignatureCanvas | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(value || null);

  useEffect(() => {
    if (field.type === 'signature' && value) {
        setSignatureDataUrl(value);
    }
  }, [value, field.type]);

  const clearSignature = () => {
    sigCanvas.current?.clear();
    setSignatureDataUrl(null);
    if (onChange) onChange(null);
  };
  
  const handleSignatureEnd = () => {
    if (sigCanvas.current) {
        if (!sigCanvas.current.isEmpty()) {
            const dataUrl = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png');
            setSignatureDataUrl(dataUrl);
            if (onChange) onChange(dataUrl);
        }
    }
  };

  const handleCheckboxChange = (option: string, checked: boolean) => {
      const currentValues = Array.isArray(value) ? value : [];
      let newValues;
      if (checked) {
          newValues = [...currentValues, option];
      } else {
          newValues = currentValues.filter(v => v !== option);
      }
      if (onChange) onChange(newValues);
  }

  switch (field.type) {
    case 'heading':
      return <h2 className="text-xl font-semibold pt-2">{field.label}</h2>;
    case 'paragraph':
      return <p className="text-muted-foreground text-sm leading-relaxed">{field.label}</p>;
    case 'short-text':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.id} className="text-base">{field.label}</Label>
          <Input 
            id={field.id} 
            value={value || ''} 
            onChange={(e) => onChange?.(e.target.value)} 
            className="h-12"
          />
        </div>
      );
    case 'long-text':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.id} className="text-base">{field.label}</Label>
          <Textarea 
            id={field.id} 
            rows={4} 
            value={value || ''} 
            onChange={(e) => onChange?.(e.target.value)} 
          />
        </div>
      );
    case 'multiple-choice':
      return (
        <div className="space-y-3">
          <Label className="text-base">{field.label}</Label>
          <RadioGroup value={value} onValueChange={onChange}>
            {(field.options || []).map((option, index) => (
              <div key={index} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border transition-colors">
                <RadioGroupItem value={option} id={`${field.id}-${index}`} />
                <Label htmlFor={`${field.id}-${index}`} className="flex-1 cursor-pointer font-normal">{option}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      );
    case 'checkboxes':
      return (
        <div className="space-y-3">
          <Label className="text-base">{field.label}</Label>
          <div className="space-y-2">
            {(field.options || []).map((option, index) => {
                const isChecked = Array.isArray(value) && value.includes(option);
                return (
                    <div key={index} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border transition-colors">
                        <Checkbox 
                            id={`${field.id}-${index}`} 
                            checked={isChecked}
                            onCheckedChange={(checked) => handleCheckboxChange(option, !!checked)}
                        />
                        <Label htmlFor={`${field.id}-${index}`} className="flex-1 cursor-pointer font-normal">{option}</Label>
                    </div>
                )
            })}
          </div>
        </div>
      );
    case 'image-upload':
        return (
            <div className="space-y-4">
                <Label className="text-base">{field.label}</Label>
                <ImageUpload onImageUploaded={(url) => onChange?.(url)} initialImage={value} enableMarkup />
            </div>
        )
    case 'signature':
      return (
        <div className="space-y-2">
          <Label className="text-base">{field.label}</Label>
           <div className={cn("relative rounded-xl border-2 border-dashed border-input w-full h-48 bg-muted/20 overflow-hidden")}>
            {signatureDataUrl ? (
                 <div className="relative w-full h-full p-4">
                    <Image src={signatureDataUrl} alt="signature" layout="fill" objectFit="contain" />
                 </div>
            ) : (
                <>
                    <SignatureCanvas
                        ref={sigCanvas}
                        penColor="currentColor"
                        canvasProps={{ className: 'w-full h-full rounded-md text-foreground' }}
                        onEnd={handleSignatureEnd}
                    />
                    <div className="absolute bottom-6 left-6 right-6 flex items-center gap-3 pointer-events-none opacity-20">
                        <span className="text-muted-foreground text-2xl font-bold">X</span>
                        <div className="flex-1 border-b-2 border-dashed border-muted-foreground"></div>
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-10">
                        <Signature className="w-20 h-20" />
                    </div>
                </>
            )}
            </div>
          <div className="flex justify-end pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={clearSignature} className="text-xs text-muted-foreground">
                {signatureDataUrl ? 'Clear & Sign Again' : 'Clear Signature'}
            </Button>
          </div>
        </div>
      );
    default:
      return null;
  }
};
