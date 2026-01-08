
'use client';

import React from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DollarSign,
  PlusCircle,
  Home,
  Heartbeat,
  Car,
  ShoppingCart,
  GraduationCap,
  Sparkles,
  Building,
  Monitor,
  Briefcase,
  Brush,
  Wifi,
  MoreHorizontal,
} from 'lucide-react';

const BillItemCard = ({
  title,
  isCustom = false,
}: {
  title: string;
  isCustom?: boolean;
}) => (
  <Card className="w-72 shrink-0">
    <CardContent className="p-3">
      <div className="space-y-2">
        {isCustom ? (
          <Input defaultValue={title} className="font-semibold border-dashed" />
        ) : (
          <Label className="font-semibold">{title}</Label>
        )}
        <div className="relative">
          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="number" placeholder="0.00" className="pl-8" />
        </div>
      </div>
    </CardContent>
  </Card>
);

const BillEditor = ({
  categories,
}: {
  categories: {
    name: string;
    icon: React.ReactNode;
    bills: { title: string }[];
  }[];
}) => (
  <Card>
    <CardContent className="p-4 space-y-4">
      <Accordion type="multiple" defaultValue={['category-0']} className="w-full space-y-2">
        {categories.map((category, index) => (
          <AccordionItem key={index} value={`category-${index}`}>
            <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline">
              <div className="flex items-center gap-3">
                {category.icon}
                <span className="font-semibold">{category.name}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4">
              <ScrollArea>
                <div className="flex space-x-4 pb-4">
                  {category.bills.map((bill) => (
                    <BillItemCard key={bill.title} title={bill.title} />
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        ))}
        <AccordionItem value="custom">
            <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline">
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="font-semibold">Custom Costs</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4">
                <div className="flex items-center gap-4">
                    <ScrollArea>
                        <div className="flex space-x-4 pb-4">
                             <BillItemCard title="Custom Expense" isCustom />
                        </div>
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    <Button variant="outline" size="icon"><PlusCircle className="w-4 h-4" /></Button>
                </div>
            </AccordionContent>
          </AccordionItem>
      </Accordion>
    </CardContent>
    <CardFooter className="bg-muted/50 p-4 justify-between">
      <div>
        <p className="text-sm text-muted-foreground">Monthly Total</p>
        <p className="text-2xl font-bold">$0.00</p>
      </div>
      <div className="text-right">
        <p className="text-sm text-muted-foreground">Annual Total</p>
        <p className="text-xl font-semibold text-muted-foreground">$0.00</p>
      </div>
    </CardFooter>
  </Card>
);

const lifestyleCategories = [
  {
    name: 'Housing',
    icon: <Home className="w-5 h-5 text-primary" />,
    bills: [{ title: 'Rent / Mortgage' }, { title: 'Utilities' }],
  },
  {
    name: 'Health',
    icon: <Heartbeat className="w-5 h-5 text-primary" />,
    bills: [{ title: 'Insurance' }, { title: 'Gym' }],
  },
  {
    name: 'Transportation',
    icon: <Car className="w-5 h-5 text-primary" />,
    bills: [{ title: 'Car Payment' }, { title: 'Insurance' }, { title: 'Gas' }],
  },
  {
    name: 'Daily Living',
    icon: <ShoppingCart className="w-5 h-5 text-primary" />,
    bills: [{ title: 'Groceries' }, { title: 'Personal Care' }],
  },
   {
    name: 'Education',
    icon: <GraduationCap className="w-5 h-5 text-primary" />,
    bills: [{ title: 'Student Loans' }],
  },
];

const businessCategories = [
   { name: "Rent & Utilities", icon: <Building className="w-5 h-5 text-primary"/>, bills: [{title: "Studio Rent"}, {title: "Water & Electric"}, {title: "Business Internet"}]},
   { name: "Software & Subscriptions", icon: <Monitor className="w-5 h-5 text-primary"/>, bills: [{title: "Booking Software"}, {title: "Website Hosting"}]},
   { name: "Professional", icon: <Briefcase className="w-5 h-5 text-primary"/>, bills: [{title: "Liability Insurance"}, {title: "Licensing Fees"}, {title: "Continuing Ed."}]},
   { name: "Supplies", icon: <Brush className="w-5 h-5 text-primary"/>, bills: [{title: "Backbar"}, {title: "Color"}, {title: "Styling Products"}]},
]

const LifestyleTab = () => (
    <div>
        <h2 className="text-2xl font-semibold">What does it cost to be you?</h2>
        <p className="text-muted-foreground mt-2">Log all your monthly personal living expenses to establish your lifestyle cost.</p>
        <div className="mt-6">
            <BillEditor categories={lifestyleCategories} />
        </div>
    </div>
)
const BusinessTab = () => (
     <div>
        <h2 className="text-2xl font-semibold">What does it cost to keep the lights on?</h2>
        <p className="text-muted-foreground mt-2">Log all your fixed, recurring business operating costs.</p>
        <div className="mt-6">
            <BillEditor categories={businessCategories} />
        </div>
    </div>
)

const DayScheduleRow = ({ day }: { day: string }) => {
    const timeOptions = Array.from({ length: 25 }, (_, i) => {
        const hour = Math.floor(i / 2) + 8;
        const minute = i % 2 === 0 ? '00' : '30';
        const period = hour < 12 ? 'AM' : 'PM';
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        return `${displayHour}:${minute} ${period}`;
    });

    return (
        <div className="flex flex-col sm:flex-row items-center gap-4 p-4 border-b">
            <div className="flex items-center gap-3 w-full sm:w-28">
                <Switch defaultChecked={!['Saturday', 'Sunday'].includes(day)} id={`switch-${day}`} />
                <Label htmlFor={`switch-${day}`} className="font-semibold text-base">{day}</Label>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-4 w-full">
                <Select defaultValue="9:00 AM">
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {timeOptions.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select defaultValue="5:00 PM">
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {timeOptions.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </div>
    )
}

const ScheduleTab = () => (
    <div>
        <h2 className="text-2xl font-semibold">How much time do you have to earn?</h2>
        <p className="text-muted-foreground mt-2">Define your available work hours to calculate your total billable time.</p>
        <div className="mt-6">
            <Card>
                <CardContent className="p-0">
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                        <DayScheduleRow key={day} day={day} />
                    ))}
                </CardContent>
            </Card>
            <Card className="mt-6">
                <CardHeader><CardTitle>Time Off</CardTitle></CardHeader>
                <CardContent className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label>Vacation Days / Year</Label>
                        <Input type="number" defaultValue="10" />
                    </div>
                     <div className="space-y-2">
                        <Label>Statutory Holidays / Year</Label>
                        <Input type="number" defaultValue="8" />
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>
)

const TmhrBreakdownCard = () => (
    <Card className="sticky top-24">
        <CardHeader>
            <CardTitle>Your Financial Snapshot</CardTitle>
            <CardDescription>Select your profiles to see the magic.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
                <Select defaultValue="default">
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent><SelectItem value="default">Default Lifestyle</SelectItem></SelectContent>
                </Select>
                <Select defaultValue="default">
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent><SelectItem value="default">Default Schedule</SelectItem></SelectContent>
                </Select>
            </div>
            <Card className="bg-primary/10 border-primary/20 text-center p-6">
                <p className="text-sm text-primary font-semibold">True Minimum Hourly Rate</p>
                <p className="text-6xl font-bold text-primary">$0.00</p>
            </Card>
            <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex justify-between"><span>Lifestyle Cost / Hour:</span> <span className="font-mono">$0.00</span></div>
                <div className="flex justify-between"><span>Business Cost / Hour:</span> <span className="font-mono">$0.00</span></div>
                <div className="flex justify-between border-t pt-2 mt-2"><span>Total Billable Hours / Month:</span><span className="font-mono">0</span></div>
            </div>
        </CardContent>
        <CardFooter>
            <Button className="w-full">Set as Default Rate</Button>
        </CardFooter>
    </Card>
)

export default function FinancialFoundationPage() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Financial Foundation" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold">Your True Minimum Hourly Rate</h1>
              <p className="text-muted-foreground mt-2 max-w-3xl">
                The bedrock of your entire business. This is the exact amount you must earn per hour to cover all your expenses and fund your desired lifestyle.
              </p>
            </div>

            <div className="grid lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-2">
                     <Tabs defaultValue="lifestyle" className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="lifestyle">1. Lifestyle</TabsTrigger>
                            <TabsTrigger value="business">2. Business</TabsTrigger>
                            <TabsTrigger value="schedule">3. Schedule</TabsTrigger>
                        </TabsList>
                        <TabsContent value="lifestyle" className="mt-6">
                           <LifestyleTab />
                        </TabsContent>
                        <TabsContent value="business" className="mt-6">
                           <BusinessTab />
                        </TabsContent>
                        <TabsContent value="schedule" className="mt-6">
                           <ScheduleTab />
                        </TabsContent>
                    </Tabs>
                </div>
                <div className="hidden lg:block">
                    <TmhrBreakdownCard />
                </div>
                 <div className="lg:hidden mt-8">
                     <Accordion type="single" collapsible>
                        <AccordionItem value="summary">
                            <AccordionTrigger>View Financial Snapshot</AccordionTrigger>
                            <AccordionContent className="pt-4">
                                <TmhrBreakdownCard />
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                 </div>
            </div>
        </div>
      </main>
    </div>
  );
}

    