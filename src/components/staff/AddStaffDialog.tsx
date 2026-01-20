

'use client';

import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type Staff } from '@/lib/data';

const addStaffSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  role: z.enum(['admin', 'staff']),
  payStructure: z.enum(['commission', 'hourly', 'salary']),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
}).refine(data => {
    if (data.payStructure === 'commission') {
        return data.commissionRate !== undefined && data.commissionRate !== null;
    }
    if (data.payStructure === 'hourly') {
        return data.hourlyRate !== undefined && data.hourlyRate !== null;
    }
    return true;
}, {
    message: "A rate is required for this pay structure.",
    path: ["commissionRate"], // This is an approximation, ideally we'd show the error on the correct field
});


type AddStaffFormData = z.infer<typeof addStaffSchema>;

interface AddStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (staffData: Omit<Staff, 'id' | 'avatarUrl'>) => void;
}

export const AddStaffDialog: React.FC<AddStaffDialogProps> = ({
  open,
  onOpenChange,
  onSave,
}) => {
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AddStaffFormData>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: {
      name: '',
      email: '',
      role: 'staff',
      payStructure: 'commission',
      commissionRate: 40,
    },
  });

  const payStructure = watch('payStructure');

  const handleSave = (data: AddStaffFormData) => {
    onSave(data);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Staff Member</DialogTitle>
          <DialogDescription>
            Enter the details for your new team member. They will receive an invitation via email.
          </DialogDescription>
        </DialogHeader>
        <form id="add-staff-form" onSubmit={handleSubmit(handleSave)} className="space-y-4 py-4">
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" placeholder="e.g., Brenda Barnes" {...field} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
            )}
          />
          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" placeholder="brenda@example.com" {...field} />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
            )}
          />
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
              </div>
            )}
          />
           <Controller
            name="payStructure"
            control={control}
            render={({ field }) => (
                <div className="space-y-2">
                <Label htmlFor="payStructure">Pay Structure</Label>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <SelectTrigger id="payStructure">
                        <SelectValue placeholder="Select a pay structure" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="commission">Commission</SelectItem>
                        <SelectItem value="hourly">Hourly</SelectItem>
                        <SelectItem value="salary">Salary</SelectItem>
                    </SelectContent>
                </Select>
                {errors.payStructure && <p className="text-sm text-destructive">{errors.payStructure.message}</p>}
                </div>
            )}
        />
        {payStructure === 'commission' && (
            <Controller
                name="commissionRate"
                control={control}
                render={({ field }) => (
                <div className="space-y-2">
                    <Label htmlFor="commissionRate">Commission Rate (%)</Label>
                    <Input id="commissionRate" type="number" placeholder="e.g., 40" {...field} />
                    {errors.commissionRate && <p className="text-sm text-destructive">{errors.commissionRate.message}</p>}
                </div>
                )}
            />
        )}
        {payStructure === 'hourly' && (
            <Controller
                name="hourlyRate"
                control={control}
                render={({ field }) => (
                <div className="space-y-2">
                    <Label htmlFor="hourlyRate">Hourly Rate ($)</Label>
                    <Input id="hourlyRate" type="number" placeholder="e.g., 25" {...field} />
                    {errors.hourlyRate && <p className="text-sm text-destructive">{errors.hourlyRate.message}</p>}
                </div>
                )}
            />
        )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-staff-form">
            Save & Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
