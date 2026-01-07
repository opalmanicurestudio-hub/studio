
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Users,
  Calendar,
  DollarSign,
  ArrowUp,
  Sparkles,
  Loader,
} from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { clients, appointments, services } from '@/lib/data';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { endOfDayDebrief } from '@/ai/flows/end-of-day-debrief';
import { useToast } from '@/hooks/use-toast';

const chartData = [
  { day: 'Sun', profit: 450 },
  { day: 'Mon', profit: 680 },
  { day: 'Tue', profit: 820 },
  { day: 'Wed', profit: 760 },
  { day: 'Thu', profit: 910 },
  { day: 'Fri', profit: 1150 },
  { day: 'Sat', profit: 1300 },
];

const chartConfig = {
  profit: {
    label: 'Profit',
    color: 'hsl(var(--primary))',
  },
};

export default function DashboardPage() {
  const [isDebriefDialogOpen, setIsDebriefDialogOpen] = useState(false);
  const [debriefContent, setDebriefContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const handleGenerateDebrief = async () => {
    setIsGenerating(true);
    setDebriefContent('');
    try {
      const result = await endOfDayDebrief({
        dailyRevenue: 910,
        dailyExpenses: 150,
        inventoryLevels: { 'Pro Color Tube 5N': 20, 'Retail Shine Serum': 15 },
        completedAppointments: 5,
      });
      setDebriefContent(result.summary);
    } catch (error) {
      console.error('Error generating debrief:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate end-of-day debrief.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const todayAppointments = useMemo(() => {
    const today = new Date().toDateString();
    return appointments.filter(
      (apt) => new Date(apt.startTime).toDateString() === today
    );
  }, []);

  const recentActivities = useMemo(() => {
    // Sort appointments by date descending to get the most recent ones
    return [...appointments]
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, 5)
      .map(apt => {
          const client = clients.find(c => c.id === apt.clientId);
          const service = services.find(s => s.id === apt.serviceId);
          return { apt, client, service };
      });
    }, []);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Dashboard" />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Today's Revenue
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">$910.00</div>
              <p className="text-xs text-muted-foreground">
                +12% from yesterday
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Today's Appointments
              </CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{todayAppointments.length}</div>
              <p className="text-xs text-muted-foreground">2 completed, 3 upcoming</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">New Clients</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">+3</div>
              <p className="text-xs text-muted-foreground">this week</p>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle>End-of-Day Debrief</CardTitle>
              <CardDescription>Get an AI summary of your day.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  setIsDebriefDialogOpen(true);
                  handleGenerateDebrief();
                }}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Now
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Weekly Profit</CardTitle>
              <CardDescription>Your profit over the last 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
              <ChartContainer config={chartConfig} className="h-[300px] w-full">
                <BarChart accessibilityLayer data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                  />
                   <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent />}
                  />
                  <Bar dataKey="profit" fill="var(--color-profit)" radius={8} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Recent appointments and client activity.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              {recentActivities.map(({ apt, client, service }) => {
                  if (!client || !service) return null;
                  return (
                    <div key={apt.id} className="flex items-center gap-4">
                      <Avatar className="hidden h-9 w-9 sm:flex">
                        <AvatarImage src={client.avatarUrl} alt="Avatar" />
                        <AvatarFallback>
                          {client.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid gap-1">
                        <p className="text-sm font-medium leading-none">
                          {client.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {service.name}
                        </p>
                      </div>
                      <div className="ml-auto font-medium text-primary">
                        +${service.profit.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        </div>
      </main>
      <Dialog
        open={isDebriefDialogOpen}
        onOpenChange={setIsDebriefDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End-of-Day Debrief</DialogTitle>
            <DialogDescription>
              Here is your AI-powered summary for today's performance.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isGenerating && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader className="h-5 w-5 animate-spin" />
                <span>Generating your summary...</span>
              </div>
            )}
            {debriefContent && (
              <p className="text-sm leading-relaxed">{debriefContent}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsDebriefDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
