
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { OrderLine } from '@/components/pos/OrderLine';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type InventoryItem, type Client } from '@/lib/data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { Badge } from '@/components/ui/badge';

export default function POSPage() {
    const { inventory, services, appointments, clients, walkIns, staff } = useInventory();
    const [activeOrder, setActiveOrder] = useState<Appointment | null>(null);
    const [cart, setCart] = useState<any[]>([]);

    const posAppointments = useMemo(() => {
        if (!appointments || !clients || !services) return [];
        return appointments.map(apt => {
            const client = clients.find(c => c.id === apt.clientId);
            const service = services.find(s => s.id === apt.serviceId);
            return {
                ...apt,
                client: client,
                service: service
            };
        }).filter((a): a is Appointment & { client: Client, service: Service } => !!(a.client && a.service));
    }, [appointments, clients, services]);

    const handleSelectOrder = (order: Appointment) => {
        setActiveOrder(order);
        
        const service = services.find(s => s.id === order.serviceId);
        const addOns = (order.addOnIds || []).map(id => services.find(s => s.id === id)).filter(Boolean);

        const newCart = [];
        if (service) {
             newCart.push({
                id: service.id,
                name: service.name,
                price: service.price,
                quantity: 1,
                type: 'service',
            });
        }
        addOns.forEach(addon => {
            if(addon) {
                newCart.push({
                    id: addon.id,
                    name: addon.name,
                    price: addon.price,
                    quantity: 1,
                    type: 'service',
                });
            }
        });
        setCart(newCart);
    };

    const handleAddToCart = (item: InventoryItem | Service) => {
        setCart(prevCart => {
            const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
            if (existingItem) {
                return prevCart.map(cartItem => 
                    cartItem.id === item.id 
                    ? { ...cartItem, quantity: cartItem.quantity + 1 }
                    : cartItem
                );
            }
            const price = 'msrp' in item ? (item.msrp || item.costPerUnit || 0) : item.price;
            return [...prevCart, { ...item, quantity: 1, price }];
        });
    };

    const handleCartChange = (newCart: any[]) => {
        setCart(newCart);
    }
    
    return (
        <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950">
            <AppHeader />
            <div className="flex-1 grid lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px] overflow-hidden">
                <main className="flex-1 flex flex-col overflow-auto p-4 md:p-6 lg:p-8 gap-6">
                    <OrderLine 
                        appointments={posAppointments}
                        onSelectOrder={handleSelectOrder}
                        selectedOrderId={activeOrder?.id}
                    />
                    
                    <Tabs defaultValue="catalog" className="flex-1 flex flex-col">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="catalog">Retail Catalog</TabsTrigger>
                            <TabsTrigger value="queue">
                                Walk-in Queue
                                <Badge className="ml-2">{walkIns?.filter(w => w.status === 'waiting' || w.status === 'notified').length || 0}</Badge>
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="catalog" className="flex-1 mt-6">
                            <RetailCatalog 
                                services={services || []}
                                inventory={inventory || []}
                                onAddToCart={handleAddToCart}
                            />
                        </TabsContent>
                        <TabsContent value="queue" className="flex-1 mt-6">
                            <WalkInQueue 
                                walkIns={walkIns}
                                appointments={appointments}
                                services={services}
                                staff={staff}
                            />
                        </TabsContent>
                    </Tabs>

                </main>
                <aside className="border-l bg-card p-4 lg:p-6 flex flex-col h-full overflow-y-auto">
                    <CheckoutHub 
                        order={activeOrder}
                        cart={cart}
                        onCartChange={handleCartChange}
                    />
                </aside>
            </div>
        </div>
    )
}
