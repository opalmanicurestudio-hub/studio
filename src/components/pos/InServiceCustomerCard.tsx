
'use client';

import React from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, type Staff } from '@/lib/data';
import { formatDistanceToNow, parseISO, addMinutes } from 'date-fns';
import { User, Clock, CheckCircle } from 'lucide-react';

interface InServiceCustomerCardProps {
    walkIn: WalkIn;
    services: Service[] | null;
    staff: Staff[] | null;
    onSendToCheckout: () => void;
}

export const InServiceCustomerCard: React.FC<InServiceCustomerCardProps> = ({ walkIn, services, staff, onSendToCheckout }) => {
    const selectedServices = services?.filter(s => walkIn.serviceIds.includes(s.id));
    const assignedStaff = staff?.find(s => s.id === walkIn.assignedStaffId);
    const endTime = walkIn.serviceStartTime ? addMinutes(parseISO(walkIn.serviceStartTime), walkIn.estimatedDuration) : null;
    const isReady = walkIn.status === 'ready_for_checkout';
    
    return (
        <Card className={isReady ? "border-green-500" : ""}>
            <CardContent className="p-4">
                 <div className="flex justify-between items-start">
                    <div>
                        <p className="font-semibold flex items-center gap-2"><User className="w-4 h-4"/>{walkIn.customerName}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="w-4 h-4"/>With {assignedStaff?.name || 'N/A'}</p>
                    </div>
                     <div className="text-right">
                        {selectedServices?.map(s => <p key={s.id} className="text-sm">{s.name}</p>)}
                        {endTime && <p className="text-xs text-muted-foreground">Ends ~{formatDistanceToNow(endTime, { addSuffix: true })}</p>}
                    </div>
                </div>
            </CardContent>
             <CardFooter className="p-2 border-t">
                <Button className="w-full" onClick={onSendToCheckout} disabled={isReady}>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {isReady ? "Ready for Checkout" : "Send to Checkout"}
                </Button>
            </CardFooter>
        </Card>
    );
};
