

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
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  PlusCircle,
  Users,
  Calendar,
  Clock,
  DollarSign,
  BarChart,
  User,
  BookOpen
} from 'lucide-react';
import { format } from 'date-fns';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import type { Service as Class, Staff, Resource } from '@/lib/data';
import { AddClassDialog } from '@/components/classes/AddClassDialog';
import { Badge } from '@/components/ui/badge';
import { nanoid } from 'nanoid';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { useTenant } from '@/context/TenantContext';

const ClassCard = ({ classItem, staff, resources }: { classItem: Class, staff: Staff[], resources: Resource[] }) => {
    const instructor = staff.find(s => s.id === classItem.staffId);
    const attendeesCount = (classItem as any).attendees?.length || 0;
    const capacityProgress = (attendeesCount / (classItem.capacity || 1)) * 100;
    
    const breakEvenPoint = useMemo(() => {
        const fixed = classItem.fixedCost || 0;
        const perAttendee = classItem.costPerAttendee || 0;
        const price = classItem.price || 0;
        
        if (price - perAttendee <= 0) return Infinity; // Cannot break even if price is less than per-attendee cost
        
        return Math.ceil(fixed / (price - perAttendee));

    }, [classItem]);

    const isProfitable = attendeesCount >= breakEvenPoint;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{classItem.name}</CardTitle>
                <CardDescription>{classItem.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center text-sm text-muted-foreground"><Calendar className="w-4 h-4 mr-2"/>{format(new Date(classItem.startTime), 'MMM d, yyyy')}</div>
                <div className="flex items-center text-sm text-muted-foreground"><Clock className="w-4 h-4 mr-2"/>{format(new Date(classItem.startTime), 'h:mm a')} - {format(new Date(classItem.endTime), 'h:mm a')}</div>
                <div className="flex items-center text-sm text-muted-foreground"><User className="w-4 h-4 mr-2"/>{instructor?.name || 'Unassigned'}</div>
                <div className="flex items-center text-sm text-muted-foreground"><DollarSign className="w-4 h-4 mr-2"/>${classItem.price.toFixed(2)} per person</div>
                
                <div>
                    <Label className="text-xs">Capacity</Label>
                    <div className="flex items-center gap-2">
                        <Progress value={capacityProgress} className="w-full" />
                        <span className="text-xs font-semibold">{attendeesCount}/{classItem.capacity}</span>
                    </div>
                </div>
                 <div>
                    <Label className="text-xs">Profitability</Label>
                    <div className="flex items-center gap-2">
                         <Progress value={isProfitable ? 100 : (attendeesCount / breakEvenPoint) * 100} className={isProfitable ? '[&>div]:bg-green-500' : '[&>div]:bg-amber-500'} />
                         <Badge variant={isProfitable ? 'default' : 'secondary'} className={isProfitable ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>{breakEvenPoint} seats to break even</Badge>
                    </div>
                </div>
            </CardContent>
            <CardFooter>
                 <Button variant="outline" className="w-full">Manage Class</Button>
            </CardFooter>
        </Card>
    );
};


export default function ClassesPage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  
  const classesQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/classes`);
  }, [firestore, tenantId]);

  const staffQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/staff`);
  }, [firestore, tenantId]);

  const resourcesQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/resources`);
  }, [firestore, tenantId]);

  const { data: classes, isLoading: classesLoading } = useCollection<Class>(classesQuery);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: resources, isLoading: resourcesLoading } = useCollection<Resource>(resourcesQuery);

  const [isAddClassDialogOpen, setIsAddClassDialogOpen] = useState(false);
  
  const handleSaveClass = (classData: Omit<Class, 'id'>) => {
    if (!firestore || !tenantId) return;

    const newClass = {
        ...classData,
        id: nanoid(),
    };
    const classRef = collection(firestore, 'tenants', tenantId, 'classes');
    addDocumentNonBlocking(classRef, newClass);
    toast({
        title: "Class Created!",
        description: `${newClass.name} has been added to your schedule.`
    });
    setIsAddClassDialogOpen(false);
  };

  const isLoading = classesLoading || staffLoading || resourcesLoading;

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Classes & Workshops" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Class Management</h1>
            <p className="text-muted-foreground mt-1">
              Create, schedule, and manage your group classes and workshops.
            </p>
          </div>
          <Button onClick={() => setIsAddClassDialogOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Class
          </Button>
        </div>
        {isLoading ? (
            <p>Loading...</p>
        ) : (classes && classes.length > 0) ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {classes.map(classItem => (
                    <ClassCard key={classItem.id} classItem={classItem} staff={staff || []} resources={resources || []}/>
                ))}
            </div>
        ) : (
            <Card>
                <CardContent className="py-20 flex flex-col items-center justify-center text-center text-muted-foreground">
                    <BookOpen className="w-16 h-16 mb-4"/>
                    <h3 className="text-xl font-semibold mb-2 text-foreground">No Classes Created Yet</h3>
                    <p className="mb-4">Click the button to schedule your first group class or workshop.</p>
                </CardContent>
            </Card>
        )}
      </main>
      <AddClassDialog
        open={isAddClassDialogOpen}
        onOpenChange={setIsAddClassDialogOpen}
        onSave={handleSaveClass}
        staff={staff || []}
        resources={resources || []}
      />
    </div>
  );
}
