

'use client';

import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUpload } from '@/components/shared/ImageUpload';
import NextImage from 'next/image';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';


export const incidentSchema = z.object({
  type: z.string().min(1, "Incident type is required."),
  severity: z.string().min(1, "Severity is required."),
  description: z.string().min(1, "A detailed description is required."),
  actionsTaken: z.string().optional(),
  photoUrls: z.array(z.string()).optional(),
});

export type IncidentFormData = z.infer<typeof incidentSchema>;

export const LogIncidentForm = () => {
  const { control, watch, setValue, formState: { errors } } = useFormContext<IncidentFormData>();
  const photoUrls = watch('photoUrls') || [];

  const handleImageUploaded = (newUrl: string) => {
    if (newUrl) {
      const currentUrls = watch('photoUrls') || [];
      setValue('photoUrls', [...currentUrls, newUrl]);
    }
  };

  const handleRemoveImage = (urlToRemove: string) => {
    const currentUrls = watch('photoUrls') || [];
    setValue('photoUrls', currentUrls.filter(url => url !== urlToRemove));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="incident-type">Incident Type</Label>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger id="incident-type">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Allergic Reaction">Allergic Reaction</SelectItem>
                  <SelectItem value="Medical Issue">Medical Issue</SelectItem>
                  <SelectItem value="Client Complaint">Client Complaint</SelectItem>
                  <SelectItem value="Property Damage">Property Damage</SelectItem>
                  <SelectItem value="Facility Issue">Facility Issue</SelectItem>
                  <SelectItem value="Inappropriate Behavior">Inappropriate Behavior</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.type && <p className="text-sm text-destructive">{errors.type.message}</p>}
            </div>
          )}
        />
        <Controller
          name="severity"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="severity">Severity</Label>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger id="severity">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Minor">Minor</SelectItem>
                  <SelectItem value="Moderate">Moderate</SelectItem>
                  <SelectItem value="Severe">Severe</SelectItem>
                </SelectContent>
              </Select>
               {errors.severity && <p className="text-sm text-destructive">{errors.severity.message}</p>}
            </div>
          )}
        />
      </div>
      <Controller
        name="description"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="description">Description of Incident</Label>
            <Textarea id="description" placeholder="Provide a detailed, objective, and factual account of what happened." {...field} />
             {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
          </div>
        )}
      />
      <Controller
        name="actionsTaken"
        control={control}
        render={({ field }) => (
          <div className="space-y-2">
            <Label htmlFor="actions-taken">Actions Taken</Label>
            <Textarea id="actions-taken" placeholder="Document the steps taken to resolve the situation (e.g., offered a refund)." {...field} />
          </div>
        )}
      />
      <div className="space-y-2">
        <Label>Photo Evidence</Label>
        <div className="grid grid-cols-3 gap-2">
          {photoUrls.map((url, index) => (
            <div key={index} className="relative aspect-square">
              <NextImage src={url} alt={`Evidence ${index + 1}`} fill className="object-cover rounded-md" />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                onClick={() => handleRemoveImage(url)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {photoUrls.length < 5 && (
            <div className="aspect-square border-2 border-dashed rounded-md flex items-center justify-center">
                <ImageUpload onImageUploaded={handleImageUploaded} />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">You can upload up to 5 images.</p>
      </div>
    </div>
  );
};
