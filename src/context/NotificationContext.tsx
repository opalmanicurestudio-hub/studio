

'use client';

import React, { createContext, useContext, useState, ReactNode, useMemo, useEffect } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { differenceInDays, isPast, parseISO, format } from 'date-fns';
import { ShieldAlert, PackageX, Calendar, Landmark, XCircle } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { type Event, type Notification } from '@/lib/data';
import { cn } from '@/lib/utils';

export type AppNotification = {
    id: number | string;
    type: string;
    message: string;
    link: string;
    read: boolean;
    icon: React.ReactNode;
};

interface NotificationContextType {
    notifications: AppNotification[];
    unreadCount: number;
    markAsRead: (id: number | string) => void;
    markAllAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
    const { staff, inventory, billInstances, billDefinitions } = useInventory();
    const { firestore } = useFirebase();
    const { user } = useUser();
    const { selectedTenant, role } = useTenant();
    const tenantId = selectedTenant?.id;

    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        const storedReadIds = localStorage.getItem('read_notification_ids');
        if (storedReadIds) {
            try {
                const parsedIds = JSON.parse(storedReadIds);
                if (Array.isArray(parsedIds)) {
                    setReadNotificationIds(new Set(parsedIds));
                }
            } catch (e) {
                console.error("Failed to parse read notifications from localStorage", e);
            }
        }
    }, []);

    const pendingEventsQuery = useMemoFirebase(() => {
        if (firestore && tenantId && (role === 'owner' || role === 'admin')) {
            return query(collection(firestore, `tenants/${tenantId}/events`), where("status", "==", "pending"));
        }
        return null;
    }, [firestore, tenantId, role]);

    const { data: pendingEvents } = useCollection<Event>(pendingEventsQuery);

    const eventRequestNotifications = useMemo(() => {
        if (!pendingEvents || !staff) return [];
        return pendingEvents.map(event => {
            const staffMember = staff.find(s => s.id === event.staffId);
            const id = `event-request-${event.id}`;
            return {
                id,
                type: 'event-request',
                message: `${staffMember?.name || 'A staff member'} requested time off for "${event.title}".`,
                link: '/planner',
                read: readNotificationIds.has(id),
                icon: <Calendar className="h-4 w-4 text-purple-500" />,
            };
        }).filter((n): n is AppNotification => n !== null);
    }, [pendingEvents, staff, readNotificationIds]);

    const userNotificationsQuery = useMemoFirebase(() => {
        if (firestore && tenantId && user) {
            return query(collection(firestore, `tenants/${tenantId}/notifications`), where("userId", "==", user.uid));
        }
        return null;
    }, [firestore, tenantId, user]);
    
    const { data: userNotificationsData } = useCollection<Notification>(userNotificationsQuery);

    const userSpecificNotifications = useMemo(() => {
        if (!userNotificationsData) return [];
        return userNotificationsData.map(n => {
            const id = `user-notification-${n.id}`;
            let icon = <ShieldAlert className="h-4 w-4 text-gray-500" />;
            if (n.type === 'event_denied') {
                icon = <XCircle className="h-4 w-4 text-destructive" />;
            }
            return {
                id,
                type: n.type,
                message: n.message,
                link: n.link,
                read: readNotificationIds.has(id),
                icon,
            };
        }).filter((n): n is AppNotification => n !== null);
    }, [userNotificationsData, readNotificationIds]);

    const licenseNotifications = useMemo(() => {
        if (!staff) return [];
        return staff.map(member => {
            if (!member.compliance?.licenseExpiry) return null;

            const licenseExpiry = parseISO(member.compliance.licenseExpiry);
            const daysUntil = differenceInDays(licenseExpiry, new Date());
            const expired = isPast(licenseExpiry);
            const id = expired ? `license-${member.id}-expired` : `license-${member.id}-expiring-${daysUntil}`;

            if (expired || (daysUntil >= 0 && daysUntil <= 30)) {
                return {
                    id,
                    type: 'license',
                    message: expired ? `${member.name}'s license has expired.` : `${member.name}'s license is expiring in ${daysUntil} days.`,
                    link: '/staff',
                    read: readNotificationIds.has(id),
                    icon: <ShieldAlert className={cn("h-4 w-4", expired ? "text-destructive" : "text-orange-500")} />,
                };
            }
            
            return null;
        }).filter((n): n is AppNotification => n !== null);
    }, [staff, readNotificationIds]);

    const lowStockNotifications = useMemo(() => {
        if (!inventory) return [];
        return inventory
            .filter(item => item.reorderPoint && item.totalStock <= item.reorderPoint)
            .map(item => {
                const id = `low-stock-${item.id}`;
                return {
                    id,
                    type: 'stock',
                    message: `Low Stock Alert: '${item.name}' is at ${item.totalStock} units.`,
                    link: `/inventory/${item.id}`,
                    read: readNotificationIds.has(id),
                    icon: <PackageX className="h-4 w-4 text-destructive" />
                }
            });
    }, [inventory, readNotificationIds]);

    const expiredStockNotifications = useMemo(() => {
        if (!inventory) return [];
        const expired: AppNotification[] = [];
        inventory.forEach(item => {
            (item.batches || []).forEach(batch => {
                if (batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0) {
                    const id = `expired-${item.id}-${batch.id}`;
                    expired.push({
                        id,
                        type: 'stock',
                        message: `Expired Stock: ${batch.stock} units of '${item.name}' expired on ${format(parseISO(batch.expirationDate), 'MMM d')}.`,
                        link: `/inventory/${item.id}`,
                        read: readNotificationIds.has(id),
                        icon: <PackageX className="h-4 w-4 text-destructive" />
                    });
                }
            });
        });
        return expired;
    }, [inventory, readNotificationIds]);

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
                const id = `bill-due-${instance.id}`;
                return {
                    id,
                    type: 'bill',
                    message: `Bill Due: '${definition?.name || 'A bill'}' ${dueText}.`,
                    link: '/bills',
                    read: readNotificationIds.has(id),
                    icon: <Landmark className="h-4 w-4 text-orange-500" />
                };
            });
    }, [billInstances, billDefinitions, readNotificationIds]);

    useEffect(() => {
        const allNotifications = [
            ...eventRequestNotifications,
            ...licenseNotifications,
            ...lowStockNotifications,
            ...expiredStockNotifications,
            ...billsDueSoonNotifications,
            ...userSpecificNotifications,
        ];
        
        setNotifications(allNotifications.sort((a,b) => (a.read ? 1 : 0) - (b.read ? 1 : 0)));
        
    }, [eventRequestNotifications, licenseNotifications, lowStockNotifications, expiredStockNotifications, billsDueSoonNotifications, userSpecificNotifications]);

    const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

    const markAsRead = (id: number | string) => {
        setReadNotificationIds(prev => {
            const newSet = new Set(prev);
            newSet.add(String(id));
            localStorage.setItem('read_notification_ids', JSON.stringify(Array.from(newSet)));
            return newSet;
        });
    };
    
    const markAllAsRead = () => {
        const allIds = notifications.map(n => String(n.id));
        setReadNotificationIds(prev => {
            const newSet = new Set([...prev, ...allIds]);
            localStorage.setItem('read_notification_ids', JSON.stringify(Array.from(newSet)));
            return newSet;
        });
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
