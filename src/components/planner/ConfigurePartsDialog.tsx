'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { type Service, type Staff } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Zap, Workflow, Sparkles, Check, Loader } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';

export type PartConfig = {
  serviceId: string;
  staffId: string;
  isConcurrent: boolean;
};

interface ConfigurePartsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newServices: Service[];
  staff: Staff[];
  defaultStaffId?: string;
  onConfirm: (configs: PartConfig[]) => void;
}

export const ConfigurePartsDialog: React.FC<ConfigurePartsDialogProps> = ({
  open,
  onOpenChange,
  newServices,
  staff,
  defaultStaffId,
  onConfirm,
}) => {
  const [configs, setConfigs] = useState<Record<string, PartConfig>>({});

  useEffect(() => {
    if (open && newServices.length > 0) {
      const initialConfigs: Record<string, PartConfig> = {};
      newServices.forEach((s) => {
        initialConfigs[s.id] = {
          serviceId: s.id,
          staffId: defaultStaffId || '',
          isConcurrent: false,
        };
      });
      setConfigs(initialConfigs);
    }
  }, [open, newServices, defaultStaffId]);

  const handleUpdateConfig = (serviceId: string, updates: Partial<PartConfig>) => {
    setConfigs((prev) => ({
      ...prev,
      [serviceId]: { ...prev[serviceId], ...updates },
    }));
  };

  const handleConfirm = () => {
    onConfirm(Object.values(configs));
    onOpenChange(false);
  };

  const activeStaff = staff.filter((s) => s.active && !s.onBreak);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl h-[90vh] max-h-[90vh] flex flex-col p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              Session Configuration
            </span>
          </div>
          <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900">
            Configure New Parts
          </DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
            Assign staff and flow for added services.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-8 space-y-8">
            {newServices.map((service) => (
              <div
                key={service.id}
                className="space-y-6 p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner"
              >
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <p className="font-black text-xl uppercase tracking-tight text-slate-900 leading-tight">
                      {service.name}
                    </p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                      {service.duration}m duration
                    </p>
                  </div>
                  <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black uppercase tracking-widest">
                    New Part
                  </Badge>
                </div>

                <div className="grid gap-6">
                  <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                      Assigned Pro
                    </Label>
                    <Select
                      value={configs[service.id]?.staffId}
                      onValueChange={(val) => handleUpdateConfig(service.id, { staffId: val })}
                    >
                      <SelectTrigger className="h-14 rounded-2xl border-2 shadow-inner bg-background font-bold">
                        <SelectValue placeholder="Select Professional" />
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl border-2 shadow-2xl">
                        {activeStaff.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="rounded-xl">
                            <div className="flex items-center gap-3 py-1">
                              <Avatar className="h-8 w-8 border shadow-sm rounded-xl">
                                <AvatarImage src={s.avatarUrl} className="object-cover" />
                                <AvatarFallback className="font-black text-xs">
                                  {(s.name || 'S').charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-bold uppercase tracking-tight">{s.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                      Flow Type
                    </Label>
                    <RadioGroup
                      value={configs[service.id]?.isConcurrent ? 'concurrent' : 'sequential'}
                      onValueChange={(val) =>
                        handleUpdateConfig(service.id, { isConcurrent: val === 'concurrent' })
                      }
                      className="grid grid-cols-2 gap-3"
                    >
                      <label htmlFor={`seq-${service.id}`} className="cursor-pointer">
                        <div
                          className={cn(
                            'flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all',
                            !configs[service.id]?.isConcurrent
                              ? 'border-primary bg-primary/5 shadow-md'
                              : 'border-border bg-background hover:border-primary/20'
                          )}
                        >
                          <Workflow
                            className={cn(
                              'w-5 h-5 mb-2',
                              !configs[service.id]?.isConcurrent
                                ? 'text-primary'
                                : 'text-muted-foreground opacity-40'
                            )}
                          />
                          <span className="text-[10px] font-black uppercase tracking-widest">
                            Sequential
                          </span>
                          <RadioGroupItem
                            value="sequential"
                            id={`seq-${service.id}`}
                            className="sr-only"
                          />
                        </div>
                      </label>
                      <label htmlFor={`con-${service.id}`} className="cursor-pointer">
                        <div
                          className={cn(
                            'flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all',
                            configs[service.id]?.isConcurrent
                              ? 'border-primary bg-primary/5 shadow-md'
                              : 'border-border bg-background hover:border-primary/20'
                          )}
                        >
                          <Zap
                            className={cn(
                              'w-5 h-5 mb-2',
                              configs[service.id]?.isConcurrent
                                ? 'text-primary'
                                : 'text-muted-foreground opacity-40'
                            )}
                          />
                          <span className="text-[10px] font-black uppercase tracking-widest">
                            Concurrent
                          </span>
                          <RadioGroupItem
                            value="concurrent"
                            id={`con-${service.id}`}
                            className="sr-only"
                          />
                        </div>
                      </label>
                    </RadioGroup>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-background shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-14 px-8 rounded-2xl font-bold uppercase tracking-tight"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={Object.values(configs).some((c) => !c.staffId)}
            className="h-14 px-12 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20"
          >
            Apply Configurations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
