
'use client';

import React, { createContext, useContext, useState, ReactNode, useMemo, useEffect } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { differenceInDays, isPast, parseISO, format } from 'date-fns';
import { ShieldAlert, PackageX, Calendar, Landmark } from 'lucide-react';
import { errorEmitter } from '@/firebase/error-emitter';

export type Notification = {
    id: number | string;
    type: string;
    message: string;
    link: string;
    read: boolean;
    icon: React.ReactNode;
};

interface NotificationContextType {
    notifications: Notification[];
    unreadCount: number;
    markAsRead: (id: number | string) => void;
    markAllAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
    const { staff, inventory, billInstances, billDefinitions } = useInventory();
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const licenseNotifications = useMemo(() => {
        if (!staff) return [];
        return staff.map(member => {
            if (!member.compliance?.licenseExpiry) return null;

            const licenseExpiry = parseISO(member.compliance.licenseExpiry);
            const daysUntil = differenceInDays(licenseExpiry, new Date());
            const expired = isPast(licenseExpiry);

            if (expired) {
                return {
                    id: `license-${member.id}-expired`,
                    type: 'license',
                    message: `${member.name}'s license has expired.`,
                    link: '/staff',
                    read: false,
                    icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
                };
            }
            
            if (daysUntil <= 30) {
                return {
                    id: `license-${member.id}-expiring`,
                    type: 'license',
                    message: `${member.name}'s license is expiring in ${daysUntil} days.`,
                    link: '/staff',
                    read: false,
                    icon: <ShieldAlert className="h-4 w-4 text-orange-500" />,
                };
            }
            
            return null;
        }).filter((n): n is Notification => n !== null);
    }, [staff]);

    const lowStockNotifications = useMemo(() => {
        if (!inventory) return [];
        return inventory
            .filter(item => item.reorderPoint && item.totalStock <= item.reorderPoint)
            .map(item => ({
                id: `low-stock-${item.id}`,
                type: 'stock',
                message: `Low Stock Alert: '${item.name}' is at ${item.totalStock} units.`,
                link: `/inventory/${item.id}`,
                read: false,
                icon: <PackageX className="h-4 w-4 text-destructive" />
            }));
    }, [inventory]);

    const expiredStockNotifications = useMemo(() => {
        if (!inventory) return [];
        const expired: Notification[] = [];
        inventory.forEach(item => {
            (item.batches || []).forEach(batch => {
                if (batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0) {
                    expired.push({
                        id: `expired-${item.id}-${batch.id}`,
                        type: 'stock',
                        message: `Expired Stock: ${batch.stock} units of '${item.name}' expired on ${format(parseISO(batch.expirationDate), 'MMM d')}.`,
                        link: `/inventory/${item.id}`,
                        read: false,
                        icon: <PackageX className="h-4 w-4 text-destructive" />
                    });
                }
            });
        });
        return expired;
    }, [inventory]);

    const billsDueSoonNotifications = useMemo(() => {
        if (!billInstances || !billDefinitions) return [];
        const today = new Date();
        return billInstances
            .filter(instance => {
                if (instance.status === 'paid') return false;
                const dueDate = parseISO(instance.dueDate);
                const daysUntilDue = differenceInDays(dueDate, today);
                return daysUntilDue >= 0 && daysUntilDue <= 7;
            })
            .map(instance => {
                const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
                const daysUntilDue = differenceInDays(parseISO(instance.dueDate), today);
                const dueText = daysUntilDue === 0 ? 'is due today' : `is due in ${daysUntilDue} days`;
                return {
                    id: `bill-due-${instance.id}`,
                    type: 'bill',
                    message: `Bill Due: '${definition?.name || 'A bill'}' ${dueText}.`,
                    link: '/bills',
                    read: false,
                    icon: <Landmark className="h-4 w-4 text-orange-500" />
                };
            });
    }, [billInstances, billDefinitions]);
    
    useEffect(() => {
        const handleNewIncident = ({ clientName, clientId, incidentType }: { clientName: string, clientId: string, incidentType: string }) => {
            const newNotification: Notification = {
                id: `incident-${Date.now()}`,
                type: 'incident',
                message: `New incident for ${clientName}: ${incidentType}`,
                link: `/clients/${clientId}`,
                read: false,
                icon: <ShieldAlert className="h-4 w-4 text-orange-500" />,
            };
            setNotifications(prev => [newNotification, ...prev]);
        };
        
        const handleNewEventRequest = ({ staffName, eventTitle, eventId }: { staffName: string; eventTitle: string; eventId: string }) => {
            const newNotification: Notification = {
                id: `event-request-${eventId}`,
                type: 'event-request',
                message: `${staffName} requested time off for "${eventTitle}".`,
                link: '/planner',
                read: false,
                icon: <Calendar className="h-4 w-4 text-purple-500" />,
            };
            setNotifications(prev => [newNotification, ...prev.filter(n => n.id !== newNotification.id)]);
        };
        
        errorEmitter.on('incident-reported', handleNewIncident);
        errorEmitter.on('event-request', handleNewEventRequest);
        
        return () => {
            errorEmitter.off('incident-reported', handleNewIncident);
            errorEmitter.off('event-request', handleNewEventRequest);
        }
    }, []);

    useEffect(() => {
        const backgroundNotifs = [
            ...licenseNotifications,
            ...lowStockNotifications,
            ...expiredStockNotifications,
            ...billsDueSoonNotifications,
        ];

        setNotifications(currentNotifs => {
            const realTimeNotifs = currentNotifs.filter(n => n.type === 'incident' || n.type === 'event-request');
            const notifMap = new Map<string | number, Notification>();
            
            realTimeNotifs.forEach(n => notifMap.set(n.id, n));
            
            backgroundNotifs.forEach(n => {
                const existing = currentNotifs.find(cn => cn.id === n.id);
                notifMap.set(n.id, { ...n, read: existing?.read || false });
            });

            const backgroundIds = new Set(backgroundNotifs.map(n => n.id));
            currentNotifs.forEach(n => {
                if (n.type !== 'incident' && n.type !== 'event-request' && !backgroundIds.has(n.id)) {
                    // This logic is flawed, but for now we'll just not delete old ones.
                    // This can cause stale real-time notifications to persist.
                    // notifMap.delete(n.id);
                }
            });
                
            return Array.from(notifMap.values()).sort((a,b) => (a.read ? 1 : 0) - (b.read ? 1 : 0));
        });
        
    }, [licenseNotifications, lowStockNotifications, expiredStockNotifications, billsDueSoonNotifications]);

    const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

    const markAsRead = (id: number | string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    };
    
    const markAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({...n, read: true})));
    };

    const value = {
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
    };

    return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}
