
'use client';

import React, { useState, useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type Service,
  type Staff
} from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Clock, DollarSign, Users, Calendar } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';


const StaffSelectionCard = ({ staff, isSelected, onSelect }: { staff: Staff, isSelected: boolean, onSelect: () => void }) => {
    return (
        <label htmlFor={`staff-${staff.id}`} className="block cursor-pointer">
            <Card className={`transition-all ${isSelected ? 'border-primary ring-2 ring-primary' : 'hover:border-primary/50'}`}>
                <CardContent className="p-4 flex flex-col items-center gap-3">
                    <Avatar className="w-16 h-16">
                        {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} /> : null}
                        <AvatarFallback>{staff.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <p className="font-semibold text-sm text-center">{staff.name}</p>
                    <RadioGroupItem value={staff.id} id={`staff-${staff.id}`} className="sr-only" />
                </CardContent>
            </Card>
        </label>
    );
};

interface BookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service;
  staff: Staff[];
}

export const BookingSheet: React.FC<BookingSheetProps> = ({
  open,
  onOpenChange,
  service,
  staff,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  
  const [selectedStaffId, setSelectedStaffId] = useState('any');

  const progress = (step / totalSteps) * 100;
  
  const qualifiedStaff = useMemo(() => {
    if (!service.requiredSkills || service.requiredSkills.length === 0) {
        return staff;
    }
    return staff.filter(s => 
        service.requiredSkills!.every(skill => (s.skillSet || []).includes(skill))
    );
  }, [service, staff]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle>Book Your Appointment</SheetTitle>
          <div className="pt-2">
            <Progress value={progress} className="h-2" />
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1">
            <div className="p-6 space-y-8">
                {/* Step 1: Service Confirmation (already selected) */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                         <h3 className="text-lg font-medium">Your Selected Service</h3>
                        <Button variant="link" size="sm" className="p-0" onClick={() => onOpenChange(false)}>Change</Button>
                    </div>
                    <Card className="bg-muted/50">
                        <CardContent className="p-4 flex gap-4 items-center">
                            <Image
                                src={service.imageUrl || 'https://picsum.photos/seed/1/100/100'}
                                alt={service.name}
                                width={80}
                                height={80}
                                className="rounded-md object-cover"
                            />
                            <div className="space-y-1">
                                <p className="font-semibold">{service.name}</p>
                                <div className="text-sm text-muted-foreground flex items-center gap-4">
                                    <span className="flex items-center gap-1.5"><Clock className="w-4 h-4"/>{service.duration} min</span>
                                    <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4"/>{service.price.toFixed(2)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                
                 {/* Step 2: Staff Selection */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Choose Your Provider</h3>
                    <RadioGroup value={selectedStaffId} onValueChange={setSelectedStaffId} className="grid grid-cols-3 gap-4">
                        <label htmlFor="staff-any" className="block cursor-pointer">
                            <Card className={cn("transition-all", selectedStaffId === 'any' ? 'border-primary ring-2 ring-primary' : 'hover:border-primary/50')}>
                                <CardContent className="p-4 flex flex-col items-center justify-center gap-3 h-full">
                                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                                        <Users className="w-8 h-8 text-muted-foreground" />
                                    </div>
                                    <p className="font-semibold text-sm text-center">Any Available</p>
                                    <RadioGroupItem value="any" id="staff-any" className="sr-only" />
                                </CardContent>
                            </Card>
                        </label>
                        {qualifiedStaff.map(s => (
                            <StaffSelectionCard 
                                key={s.id} 
                                staff={s} 
                                isSelected={selectedStaffId === s.id} 
                                onSelect={() => setSelectedStaffId(s.id)}
                            />
                        ))}
                    </RadioGroup>
                </div>

                {/* Step 3: Date & Time - Placeholder */}
                <div className="space-y-4 opacity-50 pointer-events-none">
                     <h3 className="text-lg font-medium flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" />Select Date & Time</h3>
                     <Card>
                        <CardContent className="p-4 text-center text-muted-foreground">
                            <p>Select a provider to see available times.</p>
                        </CardContent>
                     </Card>
                </div>
            </div>
        </ScrollArea>
        <SheetFooter className="p-6 border-t">
          <Button className="w-full" size="lg" disabled>Continue</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
