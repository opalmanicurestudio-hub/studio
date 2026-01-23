

'use client';

import React, { useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DollarSign, Gift, Save, ListChecks, MessageSquare, Clock, Building } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';

const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const totalMinutes = i * 30;
    const hours24 = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    const date = new Date(2000, 0, 1, hours24, minutes);

    return {
        value: format(date, 'HH:mm'),
        label: format(date, 'h:mm a'),
    };
});

const DayHoursRow = ({ day, hours, onHourChange, onStatusChange }: { day: string; hours: { isOpen: boolean, open: string, close: string }; onHourChange: (day: string, type: 'open' | 'close', value: string) => void; onStatusChange: (day: string, isOpen: boolean) => void }) => {
    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-b last:border-b-0">
            <div className="flex items-center gap-3 w-full sm:w-auto">
                <Switch checked={hours.isOpen} onCheckedChange={(checked) => onStatusChange(day, checked)} />
                <span className="font-medium capitalize w-20">{day}</span>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select
                    value={hours.open}
                    onValueChange={(value) => onHourChange(day, 'open', value)}
                    disabled={!hours.isOpen}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {timeOptions.map(time => (
                            <SelectItem key={`open-${time.value}`} value={time.value}>{time.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <span className="text-muted-foreground">-</span>
                <Select
                    value={hours.close}
                    onValueChange={(value) => onHourChange(day, 'close', value)}
                    disabled={!hours.isOpen}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {timeOptions.map(time => (
                            <SelectItem key={`close-${time.value}`} value={time.value}>{time.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [referrerReward, setReferrerReward] = useState('10.00');
  const [newClientDiscount, setNewClientDiscount] = useState('15.00');
  const [queueSkipTime, setQueueSkipTime] = useState(5);
  const [smsMessage, setSmsMessage] = useState(
    "Hi {clientName}, your spot at {businessName} is ready! Please head to the front desk."
  );
  
  const [businessHours, setBusinessHours] = useState({
    monday: { isOpen: true, open: '09:00', close: '17:00' },
    tuesday: { isOpen: true, open: '09:00', close: '17:00' },
    wednesday: { isOpen: true, open: '09:00', close: '19:00' },
    thursday: { isOpen: true, open: '09:00', close: '19:00' },
    friday: { isOpen: true, open: '09:00', close: '19:00' },
    saturday: { isOpen: true, open: '10:00', close: '16:00' },
    sunday: { isOpen: false, open: '09:00', close: '17:00' },
  });

  const [lateGracePeriod, setLateGracePeriod] = useState(15);
  const [cancellationFee, setCancellationFee] = useState('25.00');
  const [autoCancel, setAutoCancel] = useState(false);

  const handleHourChange = (day: string, type: 'open' | 'close', value: string) => {
    setBusinessHours(prev => ({
        ...prev,
        [day]: { ...prev[day as keyof typeof prev], [type]: value }
    }));
  };

  const handleStatusChange = (day: string, isOpen: boolean) => {
      setBusinessHours(prev => ({
          ...prev,
          [day]: { ...prev[day as keyof typeof prev], isOpen }
      }));
  };

  const handleSaveSettings = (section: string) => {
    toast({
      title: `${section} Settings Saved`,
      description: `Your ${section.toLowerCase()} settings have been updated.`,
    });
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Settings" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold">Business Settings</h1>
            <p className="text-muted-foreground mt-1">
              Manage your application-wide settings and configurations.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="w-5 h-5 text-primary" />
                Business Hours
              </CardTitle>
              <CardDescription>
                Set your operating hours for the walk-in queue.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
               {Object.entries(businessHours).map(([day, hours]) => (
                 <DayHoursRow
                    key={day}
                    day={day}
                    hours={hours}
                    onHourChange={handleHourChange}
                    onStatusChange={handleStatusChange}
                />
               ))}
            </CardContent>
             <CardFooter className="pt-6">
              <Button onClick={() => handleSaveSettings('Business Hours')}>
                <Save className="mr-2 h-4 w-4" />
                Save Business Hours
              </Button>
            </CardFooter>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Scheduling Policies
              </CardTitle>
              <CardDescription>
                Define rules for appointments, cancellations, and late arrivals.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                <Label htmlFor="late-grace-period">Late Arrival Grace Period (minutes)</Label>
                <Input
                    id="late-grace-period"
                    type="number"
                    value={lateGracePeriod}
                    onChange={(e) => setLateGracePeriod(Number(e.target.value))}
                    placeholder="e.g., 15"
                />
                <p className="text-xs text-muted-foreground">
                    Time after which a client is considered late.
                </p>
                </div>
                <div className="space-y-2">
                <Label htmlFor="cancellation-fee">Late Cancellation / No-Show Fee</Label>
                <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                    id="cancellation-fee"
                    type="number"
                    value={cancellationFee}
                    onChange={(e) => setCancellationFee(e.target.value)}
                    placeholder="25.00"
                    className="pl-8"
                    />
                </div>
                <p className="text-xs text-muted-foreground">
                    Fee charged for late cancellations or no-shows.
                </p>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4 md:col-span-2">
                <div className="space-y-0.5">
                    <Label htmlFor="auto-cancel" className="font-semibold">Auto-Cancel Late Arrivals</Label>
                    <p className="text-xs text-muted-foreground">
                        Automatically cancel appointments if the client is late beyond the grace period.
                    </p>
                </div>
                <Switch
                    id="auto-cancel"
                    checked={autoCancel}
                    onCheckedChange={setAutoCancel}
                />
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={() => handleSaveSettings('Scheduling Policies')}>
                <Save className="mr-2 h-4 w-4" />
                Save Policies
                </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-primary" />
                Referral Program
              </CardTitle>
              <CardDescription>
                Define the rewards for your client referral program.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="referrer-reward">Referrer Reward</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="referrer-reward"
                    type="number"
                    value={referrerReward}
                    onChange={(e) => setReferrerReward(e.target.value)}
                    placeholder="10.00"
                    className="pl-8"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Store credit given to the existing client for a successful referral.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-client-discount">New Client Discount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="new-client-discount"
                    type="number"
                    value={newClientDiscount}
                    onChange={(e) => setNewClientDiscount(e.target.value)}
                    placeholder="15.00"
                    className="pl-8"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Discount applied to the new client's first service.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleSaveSettings('Referral Program')}>
                <Save className="mr-2 h-4 w-4" />
                Save Referral Settings
              </Button>
            </CardFooter>
          </Card>
          
           <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-primary" />
                Walk-in Queue
              </CardTitle>
              <CardDescription>
                Configure the behavior of your smart walk-in queue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="skip-timer">Skip Timer (minutes)</Label>
                <Input
                  id="skip-timer"
                  type="number"
                  value={queueSkipTime}
                  onChange={(e) => setQueueSkipTime(Number(e.target.value))}
                  placeholder="e.g., 5"
                />
                <p className="text-xs text-muted-foreground">
                  Time a client has to claim their spot after being notified before they are automatically skipped.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleSaveSettings('Walk-in Queue')}>
                <Save className="mr-2 h-4 w-4" />
                Save Queue Settings
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                SMS Notifications
              </CardTitle>
              <CardDescription>
                Customize the SMS message sent to walk-in clients when it's their turn.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="sms-message">Walk-in Notification Message</Label>
                <Textarea
                  id="sms-message"
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  placeholder="Enter your SMS message..."
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Use placeholders like {"{clientName}"} and {"{businessName}"} which will be replaced automatically.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleSaveSettings('SMS Notifications')}>
                <Save className="mr-2 h-4 w-4" />
                Save Message
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
