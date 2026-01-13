
'use client';

import React, { useRef } from 'react';
import { FormField } from './FieldEditor';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Checkbox } from '../ui/checkbox';
import { Signature } from 'lucide-react';
import { Button } from '../ui/button';
import { ImageUpload } from '../shared/ImageUpload';
import SignatureCanvas from 'react-signature-canvas';

interface FormFieldRendererProps {
  field: FormField;
}

export const FormFieldRenderer: React.FC<FormFieldRendererProps> = ({ field }) => {
  const sigCanvas = useRef<SignatureCanvas | null>(null);

  const clearSignature = () => {
    sigCanvas.current?.clear();
  };


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
           <div className="rounded-md border border-input bg-background aspect-video w-full">
             <SignatureCanvas
                ref={sigCanvas}
                penColor="hsl(var(--foreground))"
                canvasProps={{ className: 'w-full h-full rounded-md' }}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clearSignature}>
            Clear
          </Button>
        </div>
      );
    default:
      return null;
  }
};
