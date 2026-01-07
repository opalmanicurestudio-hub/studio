
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DollarSign, Home, Briefcase, Clock, PlusCircle, Edit, Save } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';

const BillItemCard = ({
  title,
  isCustom = false,
  isEditing = false,
}: {
  title: string;
  isCustom?: boolean;
  isEditing?: boolean;
}) => {
  return (
    <Card className="w-full shrink-0">
      <CardContent className="p-4 space-y-4">
        <div className='space-y-2'>
            {isCustom && isEditing ? (
            <Input defaultValue={title} className="font-medium" disabled={!isEditing} />
            ) : (
            <Label className="font-medium">{title}</Label>
            )}
            <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="number" placeholder="0.00" className="pl-8" disabled={!isEditing} />
            </div>
        </div>

        {isEditing && (
          <div className="space-y-4 pt-4 border-t">
             <div className='space-y-2'>
                <Label className="text-xs text-muted-foreground">Payment URL</Label>
                <Input type="url" placeholder="https://" disabled={!isEditing} />
             </div>
             <div className="grid grid-cols-3 gap-2">
                <div className='space-y-2'>
                    <Label className="text-xs text-muted-foreground">Due Day</Label>
                    <Input type="number" placeholder="15" disabled={!isEditing} />
                </div>
                <div className='space-y-2'>
                    <Label className="text-xs text-muted-foreground">Late By</Label>
                    <Input type="number" placeholder="20" disabled={!isEditing} />
                </div>
                <div className='space-y-2'>
                    <Label className="text-xs text-muted-foreground">Late Fee</Label>
                    <Input type="number" placeholder="25" disabled={!isEditing} />
                </div>
             </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ExpenseCategory = ({
  title,
  children,
  isEditing
}: {
  title: string;
  children: React.ReactNode;
  isEditing: boolean;
}) => (
  <AccordionItem value={title}>
    <AccordionTrigger className="px-4 py-3 text-base font-medium hover:no-underline bg-muted/50 rounded-t-lg">
      {title}
    </AccordionTrigger>
    <AccordionContent className="p-4 border border-t-0 rounded-b-lg">
      <div className="md:hidden space-y-4">
        {React.Children.map(children, child => React.cloneElement(child as React.ReactElement<any>, { isEditing, className: 'md:w-72' }))}
        {isEditing && (
         <div className="flex items-center justify-center w-full shrink-0">
             <Button variant="outline" className="w-full h-full border-dashed">
                 <PlusCircle className="mr-2" /> Add Custom Cost
             </Button>
          </div>
        )}
      </div>
      <ScrollArea className="hidden md:block">
        <div className="flex space-x-4 pb-4">
          {React.Children.map(children, child => React.cloneElement(child as React.ReactElement<any>, { isEditing }))}
          {isEditing && (
            <div className="flex items-center justify-center w-72 shrink-0">
               <Button variant="outline" className="w-full h-full border-dashed">
                   <PlusCircle className="mr-2" /> Add Custom Cost
               </Button>
            </div>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </AccordionContent>
  </AccordionItem>
);

const DayScheduleRow = ({ day }: { day: string }) => {
  const isChecked = !['Saturday', 'Sunday'].includes(day);
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-lg border p-4 gap-4">
      <div className="flex items-center gap-4">
        <Switch defaultChecked={isChecked} id={`switch-${day}`} />
        <Label htmlFor={`switch-${day}`} className="text-base font-medium">{day}</Label>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <Input type="time" defaultValue="09:00" className="w-full sm:w-32" disabled={!isChecked} />
        <span className='px-2'>-</span>
        <Input type="time" defaultValue="17:00" className="w-full sm:w-32" disabled={!isChecked} />
      </div>
    </div>
  );
};

export default function FinancialsPage() {
  const [costs, setCosts] = useState({
    personal: 3000,
    business: 1500,
  });
  const [schedule, setSchedule] = useState({
    daysPerWeek: 5,
    hoursPerDay: 8,
  });
  const [isEditing, setIsEditing] = useState(false);

  const tmhr = useMemo(() => {
    const totalMonthlyCost = costs.personal + costs.business;
    const totalWeeklyHours = schedule.daysPerWeek * schedule.hoursPerDay;
    const totalMonthlyHours = totalWeeklyHours * 4; // Simplified

    if (totalMonthlyHours === 0) return 0;

    return totalMonthlyCost / totalMonthlyHours;
  }, [costs, schedule]);
  
  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Financials" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-center md:text-left">
                <h1 className="text-3xl font-bold">Financial Foundation</h1>
                <p className="text-muted-foreground mt-2">
                Discover the True Minimum Hourly Rate (TMHR) that powers your business.
                </p>
            </div>
            <Button variant="outline" onClick={() => setIsEditing(!isEditing)}>
                {isEditing ? <Save className="mr-2" /> : <Edit className="mr-2" />}
                {isEditing ? 'Save Changes' : 'Edit'}
            </Button>
          </div>

          <Tabs defaultValue="lifestyle" className="w-full">
            <ScrollArea className="w-full whitespace-nowrap">
              <TabsList className="inline-grid w-max grid-cols-4">
                <TabsTrigger value="lifestyle"><Home className="mr-2 h-4 w-4"/>Lifestyle</TabsTrigger>
                <TabsTrigger value="business"><Briefcase className="mr-2 h-4 w-4"/>Business</TabsTrigger>
                <TabsTrigger value="schedule"><Clock className="mr-2 h-4 w-4"/>Schedule</TabsTrigger>
                <TabsTrigger value="tmhr" className="font-bold text-primary data-[state=active]:text-primary"><DollarSign className="mr-2 h-4 w-4"/>TMHR</TabsTrigger>
              </TabsList>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
            
            <TabsContent value="lifestyle" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Lifestyle Costs</CardTitle>
                  <CardDescription>What does it cost to be you? Input your monthly personal expenses.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" defaultValue={['Housing']} className="w-full space-y-4">
                    <ExpenseCategory title="Housing" isEditing={isEditing}>
                        <BillItemCard title="Rent/Mortgage" />
                        <BillItemCard title="Property Taxes" />
                        <BillItemCard title="HOA Fees" />
                        <BillItemCard title="Insurance (Homeowner's/Renter's)" />
                    </ExpenseCategory>
                     <ExpenseCategory title="Utilities" isEditing={isEditing}>
                        <BillItemCard title="Electric" />
                        <BillItemCard title="Water" />
                        <BillItemCard title="Gas" />
                        <BillItemCard title="Waste Management" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Internet & Phone" isEditing={isEditing}>
                      <BillItemCard title="Internet Bill" />
                      <BillItemCard title="Cell Phone Bill" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Streaming & Subscriptions" isEditing={isEditing}>
                      <BillItemCard title="Netflix" />
                      <BillItemCard title="Spotify" />
                      <BillItemCard title="News Subscription" />
                      <BillItemCard title="Cloud Storage (iCloud, Google Drive, etc.)" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Food" isEditing={isEditing}>
                      <BillItemCard title="Groceries" />
                      <BillItemCard title="Restaurants" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Transportation" isEditing={isEditing}>
                      <BillItemCard title="Car Payment" />
                      <BillItemCard title="Car Insurance" />
                      <BillItemCard title="Gas/Fuel" />
                      <BillItemCard title="Public Transit" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Health & Wellness" isEditing={isEditing}>
                      <BillItemCard title="Personal Health Insurance" />
                      <BillItemCard title="Gym Membership" />
                      <BillItemCard title="Therapy/Counseling" />
                      <BillItemCard title="Medication" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Debt Repayment" isEditing={isEditing}>
                      <BillItemCard title="Student Loans" />
                      <BillItemCard title="Credit Card Payments" />
                      <BillItemCard title="Buy Now, Pay Later" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Family & Childcare" isEditing={isEditing}>
                      <BillItemCard title="Childcare / Daycare" />
                      <BillItemCard title="Kids' Activities" />
                      <BillItemCard title="Child Support" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Pets" isEditing={isEditing}>
                      <BillItemCard title="Pet Food & Supplies" />
                      <BillItemCard title="Pet Insurance" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Personal Spending" isEditing={isEditing}>
                      <BillItemCard title="Shopping (Clothes, etc.)" />
                      <BillItemCard title="Entertainment (Movies, Concerts, etc.)" />
                      <BillItemCard title="Hobbies & Recreation" />
                      <BillItemCard title="Personal Care" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Gifts & Donations" isEditing={isEditing}>
                      <BillItemCard title="Gifts & Donations" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Financial Goals" isEditing={isEditing}>
                      <BillItemCard title="Personal Savings" />
                      <BillItemCard title="Retirement (IRA/401k)" />
                    </ExpenseCategory>
                  </Accordion>
                </CardContent>
                <CardFooter className="bg-muted/50 p-4 rounded-b-lg mt-4 flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-4 sm:gap-8">
                    <div className="text-right flex-1">
                        <div className="text-sm text-muted-foreground">Monthly Total</div>
                        <div className="text-2xl font-bold">$3,000.00</div>
                    </div>
                    <div className="text-right flex-1">
                        <div className="text-sm text-muted-foreground">Annual Total</div>
                        <div className="text-2xl font-bold">$36,000.00</div>
                    </div>
                </CardFooter>
              </Card>
            </TabsContent>

            <TabsContent value="business" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Business Costs</CardTitle>
                  <CardDescription>What does it cost to keep the lights on? Input your fixed business expenses.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" defaultValue={['Rent & Facility']} className="w-full space-y-4">
                    <ExpenseCategory title="Rent & Facility" isEditing={isEditing}>
                        <BillItemCard title="Studio Rent/Mortgage" />
                        <BillItemCard title="Business Insurance (Liability, Property)" />
                    </ExpenseCategory>
                     <ExpenseCategory title="Utilities" isEditing={isEditing}>
                        <BillItemCard title="Electric" />
                        <BillItemCard title="Water" />
                        <BillItemCard title="Gas" />
                        <BillItemCard title="Waste Management" />
                    </ExpenseCategory>
                     <AccordionItem value="Capital Equipment">
                        <AccordionTrigger className="px-4 py-3 text-base font-medium hover:no-underline bg-muted/50 rounded-t-lg">Capital Equipment</AccordionTrigger>
                        <AccordionContent className="p-4 border border-t-0 rounded-b-lg text-sm text-muted-foreground">
                            Monthly depreciation of items from your Inventory Hub under &quot;Equipment&quot; is automatically calculated here.
                        </AccordionContent>
                    </AccordionItem>
                    <ExpenseCategory title="Software & Systems" isEditing={isEditing}>
                        <BillItemCard title="Booking Software" />
                        <BillItemCard title="Website Hosting" />
                        <BillItemCard title="Email Marketing" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Tech & Comms" isEditing={isEditing}>
                        <BillItemCard title="Business Phone Line" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Professional & Admin" isEditing={isEditing}>
                        <BillItemCard title="Accountant/Bookkeeper" />
                        <BillItemCard title="Licensing & Dues" />
                    </ExpenseCategory>
                     <ExpenseCategory title="Marketing & Growth" isEditing={isEditing}>
                        <BillItemCard title="Social Media Ads" />
                        <BillItemCard title="Print Materials (Business Cards, Flyers)" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Retail & Marketing Materials" isEditing={isEditing}>
                        <BillItemCard title="Packaging & Bags" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Business Debt" isEditing={isEditing}>
                        <BillItemCard title="Business Loan" />
                        <BillItemCard title="Tax Debt Payment" />
                    </ExpenseCategory>
                    <ExpenseCategory title="Miscellaneous" isEditing={isEditing}>
                        <BillItemCard title="Bank Fees" />
                    </ExpenseCategory>
                  </Accordion>
                </CardContent>
                <CardFooter className="bg-muted/50 p-4 rounded-b-lg mt-4 flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-4 sm:gap-8">
                    <div className="text-right flex-1">
                        <div className="text-sm text-muted-foreground">Monthly Total</div>
                        <div className="text-2xl font-bold">$1,500.00</div>
                    </div>
                    <div className="text-right flex-1">
                        <div className="text-sm text-muted-foreground">Annual Total</div>
                        <div className="text-2xl font-bold">$18,000.00</div>
                    </div>
                </CardFooter>
              </Card>
            </TabsContent>
            
            <TabsContent value="schedule" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Work Schedule</CardTitle>
                        <CardDescription>How much time do you have to earn? Define your available work hours.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-4">
                            {daysOfWeek.map(day => <DayScheduleRow key={day} day={day} />)}
                        </div>
                        <Separator />
                        <div>
                            <h3 className="text-lg font-medium mb-4">Time Off</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label>Vacation Days / Year</Label>
                                    <Input type="number" defaultValue={20} />
                                </div>
                                <div className="space-y-2">
                                     <Label>Statutory Holidays</Label>
                                    <Input type="number" defaultValue={10} />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="tmhr" className="mt-6">
                 <Card className="bg-primary/5 border-primary/20 text-center">
                    <CardHeader>
                        <CardTitle className="text-2xl md:text-3xl">Your True Minimum Hourly Rate</CardTitle>
                        <CardDescription className="text-sm md:text-base">
                            This is the minimum you must earn per hour to break even and fund your life.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div>
                            <p className="text-6xl md:text-7xl font-bold text-primary">${tmhr.toFixed(2)}</p>
                            <p className="text-muted-foreground mt-2">per billable hour</p>
                        </div>
                        <Card className="max-w-md mx-auto bg-background/50">
                            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
                                <div className="text-center px-2 py-2 sm:py-0">
                                    <p className="text-sm text-muted-foreground">Lifestyle Cost</p>
                                    <p className="text-lg md:text-xl font-semibold">${(costs.personal / (schedule.daysPerWeek * schedule.hoursPerDay * 4)).toFixed(2)}/hr</p>
                                </div>
                                <div className="text-center px-2 py-2 sm:py-0">
                                    <p className="text-sm text-muted-foreground">Business Cost</p>
                                    <p className="text-lg md:text-xl font-semibold">${(costs.business / (schedule.daysPerWeek * schedule.hoursPerDay * 4)).toFixed(2)}/hr</p>
                                </div>
                                 <div className="text-center px-2 py-2 sm:py-0">
                                    <p className="text-sm text-muted-foreground">Billable Hours</p>
                                    <p className="text-lg md:text-xl font-semibold">{schedule.daysPerWeek * schedule.hoursPerDay * 4}/mo</p>
                                </div>
                            </CardContent>
                        </Card>
                    </CardContent>
                    <CardFooter className="justify-center p-6">
                        <Button size="lg">Set as Default Rate</Button>
                    </CardFooter>
                 </Card>
            </TabsContent>

          </Tabs>
        </div>
      </main>
    </div>
  );
}
