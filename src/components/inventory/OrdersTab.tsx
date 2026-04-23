
'use client';
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Truck, Check, Package, Clock, MoreHorizontal } from 'lucide-react';
import { type Order } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import { AddOrderDialog } from './AddOrderDialog';
import { useInventory } from '@/context/InventoryContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';


export const OrderCard = ({ order, onSelect, onTrack, onReceive }: {
    order: Order;
    onSelect?: (order: Order) => void;
    onTrack?: (e: React.MouseEvent, url?: string) => void;
    onReceive?: (order: Order) => void;
}) => {
    const getStatusVariant = (status: Order['status']) => {
        switch (status) {
            case 'Placed': return { icon: <Clock className="h-3 w-3" />, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' };
            case 'Shipped': return { icon: <Truck className="h-3 w-3" />, className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' };
            case 'Received':
            case 'Partially Received':
                return { icon: <Check className="h-3 w-3" />, className: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' };
            default: return { icon: <Package className="h-3 w-3" />, className: 'bg-gray-100 text-gray-700' };
        }
    };
    const statusInfo = getStatusVariant(order.status);
    const totalItems = order.items.reduce((acc, item) => acc + item.quantity, 0);
    const totalCost = order.items.reduce((acc, item) => acc + (item.quantity * item.costPerUnit), 0);

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-base">{order.supplier}</CardTitle>
                        <CardDescription>Order placed: {format(parseISO(order.orderDate), 'MMM d, yyyy')}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className={statusInfo.className}>{statusInfo.icon} <span className="ml-1.5">{order.status}</span></Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem>View/Edit Order</DropdownMenuItem>
                                <DropdownMenuItem>Receive Stock</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-sm space-y-2">
                    <p><strong>{totalItems}</strong> items ordered</p>
                    <p>Total Cost: <strong>${totalCost.toFixed(2)}</strong></p>
                    {order.trackingNumber && <p>Tracking: <strong>{order.trackingNumber}</strong></p>}
                    {order.expectedArrivalDate && <p>Expected: <strong>{format(parseISO(order.expectedArrivalDate), 'MMM d, yyyy')}</strong></p>}
                </div>
            </CardContent>
        </Card>
    );
}

export const OrdersTab = ({ orders, isLoading, onAddOrder }: { orders: Order[], isLoading: boolean, onAddOrder: (order: Omit<Order, 'id'>) => void }) => {
    const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
    
    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Purchase Orders</CardTitle>
                            <CardDescription>Track your inventory supply orders.</CardDescription>
                        </div>
                        <Button onClick={() => setIsAddOrderOpen(true)}><PlusCircle className="mr-2"/>New Order</Button>
                    </div>
                </CardHeader>
                <CardContent>
                     {isLoading ? <p>Loading orders...</p> : orders.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {orders.map(order => <OrderCard key={order.id} order={order} />)}
                        </div>
                    ) : (
                         <div className="text-center py-10 px-6 border-2 border-dashed rounded-lg">
                            <Truck className="mx-auto h-12 w-12 text-muted-foreground" />
                            <h3 className="mt-2 text-sm font-semibold">No orders yet</h3>
                            <p className="mt-1 text-sm text-muted-foreground">Create your first purchase order to start tracking supplies.</p>
                         </div>
                    )}
                </CardContent>
            </Card>

            <AddOrderDialog
                open={isAddOrderOpen}
                onOpenChange={setIsAddOrderOpen}
                onSave={onAddOrder}
            />
        </>
    );
};
