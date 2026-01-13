
'use client';

import React, { useRef, useState } from 'react';
import { FormField } from './FieldEditor';
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

interface FormFieldRendererProps {
  field: FormField;
}

export const FormFieldRenderer: React.FC<FormFieldRendererProps> = ({ field }) => {
  const sigCanvas = useRef<SignatureCanvas | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  const clearSignature = () => {
    sigCanvas.current?.clear();
    setSignatureDataUrl(null);
  };
  
  const handleSignatureEnd = () => {
    if (sigCanvas.current) {
        // Check if the canvas is empty before setting the data URL
        if (!sigCanvas.current.isEmpty()) {
            setSignatureDataUrl(
                sigCanvas.current.getTrimmedCanvas().toDataURL('image/png')
            );
        }
    }
  };

  const handleRedo = () => {
    clearSignature();
  }


  switch (field.type) {
    case 'heading':
      return <h2 className="text-xl font-semibold">{field.label}</h2>;
    case 'paragraph':
      return <p className="text-muted-foreground">{field.label}</p>;
    case 'short-text':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.id}>{field.label}</Label>
          <Input id={field.id} />
        </div>
      );
    case 'long-text':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.id}>{field.label}</Label>
          <Textarea id={field.id} rows={4} />
        </div>
      );
    case 'multiple-choice':
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
          <RadioGroup>
            {(field.options || []).map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <RadioGroupItem value={option} id={`${field.id}-${index}`} />
                <Label htmlFor={`${field.id}-${index}`}>{option}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      );
    case 'checkboxes':
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
          <div className="space-y-2">
            {(field.options || []).map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <Checkbox id={`${field.id}-${index}`} />
                <Label htmlFor={`${field.id}-${index}`}>{option}</Label>
              </div>
            ))}
          </div>
        </div>
      );
    case 'image-upload':
        return (
            <div className="space-y-2">
                <Label>{field.label}</Label>
                <ImageUpload onImageUploaded={() => {}} />
            </div>
        )
    case 'signature':
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
           <div className={cn("relative rounded-md border border-input bg-background w-full aspect-square md:aspect-video")}>
            {signatureDataUrl ? (
                 <Image src={signatureDataUrl} alt="signature" layout="fill" objectFit="contain" />
            ) : (
                <>
                    <SignatureCanvas
                        ref={sigCanvas}
                        penColor="black"
                        canvasProps={{ className: 'w-full h-full rounded-md' }}
                        backgroundColor="rgba(250, 250, 250, 1)"
                        onEnd={handleSignatureEnd}
                    />
                    <div className="absolute bottom-10 left-4 right-4 flex items-center gap-2 pointer-events-none">
                    <span className="text-muted-foreground text-lg">X</span>
                    <div className="flex-1 border-b border-dashed border-muted-foreground"></div>
                    </div>
                </>
            )}
            </div>
          {signatureDataUrl ? (
            <Button type="button" variant="outline" size="sm" onClick={handleRedo}>
                Redo Signature
            </Button>
          ) : (
             <Button type="button" variant="outline" size="sm" onClick={clearSignature}>
                Clear Signature
            </Button>
          )}
        </div>
      );
    default:
      return null;
  }
};
