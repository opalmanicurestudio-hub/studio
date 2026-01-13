
'use client';

import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUpload } from '@/components/shared/ImageUpload';

export const incidentSchema = z.object({
  type: z.string().min(1, "Incident type is required."),
  severity: z.string().min(1, "Severity is required."),
  description: z.string().min(1, "A detailed description is required."),
  actionsTaken: z.string().optional(),
  photoUrl: z.string().optional(),
});

export type IncidentFormData = z.infer<typeof incidentSchema>;

export const LogIncidentForm = () => {
  const { control, formState: { errors } } = useFormContext<IncidentFormData>();

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
      <Controller
        name="photoUrl"
        control={control}
        render={({ field }) => (
            <div className="space-y-2">
                <Label>Photo Evidence</Label>
                <ImageUpload onImageUploaded={field.onChange} />
            </div>
        )}
      />
    </div>
  );
};
