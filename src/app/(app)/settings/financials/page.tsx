'use client';

import React, { useState, useMemo, ChangeEvent } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DollarSign } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

export default function FinancialsPage() {
  const [costs, setCosts] = useState({
    personal: 3000,
    business: 1500,
  });
  const [schedule, setSchedule] = useState({
    daysPerWeek: 5,
    hoursPerDay: 8,
  });

  const handleCostChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCosts((prev) => ({ ...prev, [name]: Number(value) || 0 }));
  };

  const handleScheduleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSchedule((prev) => ({ ...prev, [name]: Number(value) || 0 }));
  };

  const tmhr = useMemo(() => {
    const totalMonthlyCost = costs.personal + costs.business;
    const totalWeeklyHours = schedule.daysPerWeek * schedule.hoursPerDay;
    const totalMonthlyHours = totalWeeklyHours * 4; // Simplified to 4 weeks/month

    if (totalMonthlyHours === 0) return 0;

    return totalMonthlyCost / totalMonthlyHours;
  }, [costs, schedule]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Settings" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Financial Foundation</CardTitle>
              <CardDescription>
                Define your costs and schedule to calculate your True Minimum
                Hourly Rate (TMHR).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-4">Monthly Costs</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="personal">Personal Lifestyle Costs</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="personal"
                        name="personal"
                        type="number"
                        placeholder="e.g., Rent, groceries, bills"
                        value={costs.personal}
                        onChange={handleCostChange}
                        className="pl-8"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="business">Fixed Business Expenses</Label>
                     <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="business"
                        name="business"
                        type="number"
                        placeholder="e.g., Rent, software, insurance"
                        value={costs.business}
                        onChange={handleCostChange}
                        className="pl-8"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <Separator />
              <div>
                <h3 className="text-lg font-medium mb-4">Work Schedule</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="daysPerWeek">Work Days per Week</Label>
                    <Input
                      id="daysPerWeek"
                      name="daysPerWeek"
                      type="number"
                      placeholder="e.g., 5"
                      value={schedule.daysPerWeek}
                      onChange={handleScheduleChange}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hoursPerDay">Work Hours per Day</Label>
                    <Input
                      id="hoursPerDay"
                      name="hoursPerDay"
                      type="number"
                      placeholder="e.g., 8"
                      value={schedule.hoursPerDay}
                      onChange={handleScheduleChange}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Your True Minimum Hourly Rate</CardTitle>
              <CardDescription>
                This is the minimum you must earn per hour to break even.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-5xl font-bold text-primary">
                ${tmhr.toFixed(2)}
              </p>
              <p className="text-muted-foreground mt-2">per hour</p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button>Save Changes</Button>
          </div>
        </div>
      </main>
    </div>
  );
}
