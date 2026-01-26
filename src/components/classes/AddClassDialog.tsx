
'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '../ui/scroll-area';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Class, Staff, Resource } from '@/lib/data';
import { CalendarIcon, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, setHours, setMinutes, startOfDay } from 'date-fns';

const classSchema = z.object({
  name: z.string().min(1, 'Class name is required'),
  description: z.string().optional(),
  date: z.date({ required_error: 'A date is required' }),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  staffId: z.string().min(1, 'An instructor is required'),
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1'),
  price: z.coerce.number().min(0, 'Price must be 0 or more'),
  requiredResourceIds: z.array(z.string()).optional(),
  costPerAttendee: z.coerce.number().optional(),
  fixedCost: z.coerce.number().optional(),
});

type ClassFormData = z.infer<typeof classSchema>;

interface AddClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (classData: Omit<Class, 'id'>) => void;
  staff: Staff[];
  resources: Resource[];
}

export const AddClassDialog: React.FC<AddClassDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  staff,
  resources
}) => {
  const { control, handleSubmit, register, formState: { errors } } = useForm<ClassFormData>({
    resolver: zodResolver(classSchema),
  });

  const handleSave = (data: ClassFormData) => {
    const [startHours, startMinutes] = data.startTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(data.date), startHours), startMinutes);
    
    const [endHours, endMinutes] = data.endTime.split(':').map(Number);
    const endDateTime = setMinutes(setHours(startOfDay(data.date), endHours), endMinutes);

    onSave({
      name: data.name,
      description: data.description || '',
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      staffId: data.staffId,
      capacity: data.capacity,
      price: data.price,
      requiredResourceIds: data.requiredResourceIds || [],
      attendees: [],
      costPerAttendee: data.costPerAttendee || 0,
      fixedCost: data.fixedCost || 0,
    });
    onOpenChange(false);
  };
  
    const timeOptions = Array.from({ length: 48 }, (_, i) => {
        const hour = Math.floor(i / 2);
        const minute = (i % 2) * 30;
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Class</DialogTitle>
          <DialogDescription>
            Schedule a new group session or workshop.
          </DialogDescription>
        </DialogHeader>
        <form id="add-class-form" onSubmit={handleSubmit(handleSave)}>
          <ScrollArea className="max-h-[60vh] -mr-6 pr-6">
            <div className="grid gap-6 py-4 pl-1">
                <div className="space-y-2">
                    <Label htmlFor="class-name">Class Name</Label>
                    <Input id="class-name" {...register('name')} />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="class-description">Description</Label>
                    <Textarea id="class-description" {...register('description')} />
                </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Controller
                        name="date"
                        control={control}
                        render={({ field }) => (
                            <div className="space-y-2">
                                <Label>Date</Label>
                                <Popover>
                                    <PopoverTrigger className={cn(buttonVariants({variant: 'outline'}), "w-full justify-start font-normal", !field.value && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {field.value ? format(field.value, 'PPP') : 'Pick a date'}
                                    </PopoverTrigger>
                                    <PopoverContent><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
                                </Popover>
                                 {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
                            </div>
                        )}
                    />
                    <Controller 
                        name="staffId"
                        control={control}
                        render={({ field }) => (
                             <div className="space-y-2">
                                <Label htmlFor="instructor">Instructor</Label>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="instructor"><SelectValue placeholder="Select instructor" /></SelectTrigger>
                                    <SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                                </Select>
                                {errors.staffId && <p className="text-sm text-destructive">{errors.staffId.message}</p>}
                            </div>
                        )}
                    />
                </div>
                 <div className="grid grid-cols-2 gap-4">
                    <Controller
                        name="startTime"
                        control={control}
                        render={({ field }) => (
                            <div className="space-y-2">
                                <Label>Start Time</Label>
                                <Select onValueChange={field.onChange} value={field.value}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{timeOptions.map(t => <SelectItem key={t} value={t}>{format(new Date(`1970-01-01T${t}:00`), 'h:mm a')}</SelectItem>)}</SelectContent></Select>
                                {errors.startTime && <p className="text-sm text-destructive">{errors.startTime.message}</p>}
                            </div>
                        )}
                    />
                     <Controller
                        name="endTime"
                        control={control}
                        render={({ field }) => (
                            <div className="space-y-2">
                                <Label>End Time</Label>
                                <Select onValueChange={field.onChange} value={field.value}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{timeOptions.map(t => <SelectItem key={t} value={t}>{format(new Date(`1970-01-01T${t}:00`), 'h:mm a')}</SelectItem>)}</SelectContent></Select>
                                {errors.endTime && <p className="text-sm text-destructive">{errors.endTime.message}</p>}
                            </div>
                        )}
                    />
                </div>
                 <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <Label htmlFor="capacity">Capacity</Label>
                        <Input id="capacity" type="number" {...register('capacity')} />
                         {errors.capacity && <p className="text-sm text-destructive">{errors.capacity.message}</p>}
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="price">Price per Person</Label>
                         <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input id="price" type="number" {...register('price')} className="pl-8"/>
                        </div>
                         {errors.price && <p className="text-sm text-destructive">{errors.price.message}</p>}
                    </div>
                </div>
                 <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <Label htmlFor="fixedCost">Fixed Cost</Label>
                        <Input id="fixedCost" type="number" {...register('fixedCost')} placeholder="e.g., instructor pay" />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="costPerAttendee">Cost per Attendee</Label>
                        <Input id="costPerAttendee" type="number" {...register('costPerAttendee')} placeholder="e.g., materials" />
                    </div>
                </div>
            </div>
          </ScrollArea>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-class-form">Save Class</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
