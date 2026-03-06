'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Bell, LifeBuoy, LogOut, Settings, User, CreditCard, Check, Trash2, Users, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ClientOnly } from './ClientOnly';
import { useUser, useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useNotifications, type Notification } from '@/context/NotificationContext';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export function AppHeader({ title }: { title?: string }) {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const { role } = useTenant();
  const { staff } = useInventory();
  
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearReadNotifications } = useNotifications();
  const hasReadNotifications = notifications.some(n => n.read);
  const hasUnread = unreadCount > 0;

  const handleLogout = async () => {
    if (auth) {
        await signOut(auth);
        router.push('/login');
    }
  };

  const staffMember = useMemo(() => {
    if (role !== 'staff' || !user || !staff) return null;
    return staff.find(s => s.id === user.uid);
  }, [user, staff, role]);

  const displayName = role === 'staff' ? staffMember?.name : user?.displayName;
  const avatarUrl = role === 'staff' ? staffMember?.avatarUrl : user?.photoURL;

  const getInitials = (name?: string | null): string => {
    if (!name) return 'U';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };
  const initials = getInitials(displayName);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border/40 bg-background/80 px-4 backdrop-blur-xl md:px-8 print:hidden">
      <div className="flex flex-1 items-center gap-4">
        <SidebarTrigger className="hover:bg-primary/10 transition-colors" />
        <h1 className="text-xl font-black uppercase tracking-tighter text-slate-900 md:text-2xl">{title}</h1>
      </div>
      
      <div className="flex items-center gap-4 md:gap-6">
        <ClientOnly>
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full relative hover:bg-primary/5 transition-all">
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                          <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary border-2 border-background"></span>
                          </span>
                      )}
                      <span className="sr-only">Toggle notifications</span>
                  </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 rounded-2xl shadow-2xl border-2">
                  <DropdownMenuLabel className="flex justify-between items-center px-4 py-3">
                      <span className="font-black uppercase tracking-widest text-[10px] text-muted-foreground">Notifications</span>
                      {hasUnread && (
                        <Button variant="link" size="xs" className="p-0 h-auto font-black uppercase text-[9px]" onClick={markAllAsRead}>Mark all read</Button>
                      )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="max-h-[400px] overflow-y-auto">
                    {notifications.length > 0 ? (
                        <>
                            {notifications.map(notification => (
                                <DropdownMenuItem key={notification.id} className={cn("flex items-start gap-3 p-4 transition-colors", notification.read ? 'opacity-50' : 'bg-primary/[0.02]')}>
                                    <div className="mt-1">{notification.icon}</div>
                                    <Link href={notification.link || '#'} className="flex-1 space-y-1">
                                        <p className="text-xs font-bold leading-relaxed">{notification.message}</p>
                                    </Link>
                                    {!notification.read && (
                                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); markAsRead(notification.id); }}>
                                            <Check className="h-4 w-4 text-primary" />
                                        </Button>
                                    )}
                                </DropdownMenuItem>
                            ))}
                        </>
                    ) : (
                        <div className="p-10 text-center space-y-2">
                            <Sparkles className="w-8 h-8 text-primary/20 mx-auto" />
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">All caught up</p>
                        </div>
                    )}
                  </div>
                  {hasReadNotifications && (
                    <>
                        <DropdownMenuSeparator />
                        <div className="p-2">
                            <Button variant="secondary" size="sm" className="w-full rounded-xl font-bold uppercase text-[10px] tracking-widest" onClick={clearReadNotifications}>
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Clear History
                            </Button>
                        </div>
                    </>
                  )}
              </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
        
        <ClientOnly>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div className="flex items-center gap-3 cursor-pointer group transition-all">
                    <div className="hidden sm:flex flex-col items-end">
                        <p className="text-sm font-black uppercase tracking-tight text-slate-900 group-hover:text-primary transition-colors">{displayName || 'Admin'}</p>
                        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-60 leading-none">{role}</p>
                    </div>
                    <Avatar className="h-10 w-10 border-2 border-transparent group-hover:border-primary/20 transition-all shadow-sm">
                        <AvatarImage src={avatarUrl || undefined} alt="User" className="object-cover" />
                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
                    </Avatar>
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-2xl shadow-2xl border-2 p-2">
              <DropdownMenuLabel className="px-3 py-2 font-black uppercase tracking-widest text-[10px] text-muted-foreground">My Account</DropdownMenuLabel>
              <DropdownMenuSeparator className="mx-1" />
              {role === 'owner' && (
                <div className="space-y-1">
                  <DropdownMenuItem asChild className="rounded-xl">
                    <Link href="/staff" className="flex items-center w-full font-bold">
                      <Users className="w-4 h-4 mr-2 text-primary" />
                      <span>Team Manager</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="rounded-xl">
                    <Link href="/settings" className="flex items-center w-full font-bold">
                      <Settings className="w-4 h-4 mr-2 text-primary" />
                      <span>Studio Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="rounded-xl">
                    <Link href="/subscriptions" className="flex items-center w-full font-bold">
                      <CreditCard className="w-4 h-4 mr-2 text-primary" />
                      <span>Billing & Pro</span>
                    </Link>
                  </DropdownMenuItem>
                </div>
              )}
              {role === 'staff' && (
                 <DropdownMenuItem asChild className="rounded-xl">
                    <Link href={`/staff/${user?.uid}`} className="flex items-center w-full font-bold">
                      <User className="w-4 h-4 mr-2 text-primary" />
                      <span>My Profile</span>
                    </Link>
                  </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="mx-1" />
              <DropdownMenuItem onClick={handleLogout} className="rounded-xl text-destructive font-bold focus:bg-destructive/5 focus:text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}