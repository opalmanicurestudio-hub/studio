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
import { useNotifications } from '@/context/NotificationContext';
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
        {title && (
          <h1 className="text-sm sm:text-lg font-black uppercase tracking-tighter text-slate-900 md:text-xl truncate max-w-[150px] sm:max-w-none">
            {title}
          </h1>
        )}
      </div>
      
      <div className="flex items-center gap-2 md:gap-6">
        <ClientOnly>
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full relative hover:bg-primary/5 transition-all h-10 w-10">
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                          <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary border-2 border-background"></span>
                          </span>
                      )}
                      <span className="sr-only">Toggle notifications</span>
                  </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 md:w-96 rounded-[2.5rem] shadow-3xl border-4 p-0 overflow-hidden bg-background">
                  <DropdownMenuLabel className="flex justify-between items-center px-6 py-5 bg-muted/5 border-b">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="font-black uppercase tracking-[0.2em] text-[10px] text-slate-900">Studio Intel</span>
                      </div>
                      {hasUnread && (
                        <Button 
                          variant="ghost" 
                          size="xs" 
                          className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm" 
                          onClick={markAllAsRead}
                        >
                          Clear Alerts
                        </Button>
                      )}
                  </DropdownMenuLabel>
                  <div className="max-h-[450px] overflow-y-auto">
                    {notifications.length > 0 ? (
                        <div className="divide-y-2 divide-dashed divide-border/50">
                            {notifications.map(notification => (
                                <DropdownMenuItem 
                                  key={notification.id} 
                                  className={cn(
                                    "flex items-start gap-4 p-5 transition-all focus:bg-primary/[0.03] cursor-pointer", 
                                    notification.read ? 'opacity-40 grayscale-[0.5]' : 'bg-primary/[0.01]'
                                  )}
                                >
                                    <div className="mt-1 p-2 bg-background rounded-xl border shadow-inner shrink-0">{notification.icon}</div>
                                    <Link href={notification.link || '#'} className="flex-1 space-y-1 min-w-0">
                                        <p className="text-[11px] md:text-xs font-black uppercase tracking-tight leading-relaxed text-slate-900 line-clamp-2">{notification.message}</p>
                                        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-primary/60">Tap to Review</p>
                                    </Link>
                                    {!notification.read && (
                                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full hover:bg-primary/10 hover:text-primary" onClick={(e) => { e.stopPropagation(); markAsRead(notification.id); }}>
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    )}
                                </DropdownMenuItem>
                            ))}
                        </div>
                    ) : (
                        <div className="p-16 text-center space-y-4">
                            <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto shadow-inner">
                                <Sparkles className="w-8 h-8 text-primary/20" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs font-black text-slate-900 uppercase tracking-widest">Agenda Clear</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">No pending intelligence alerts.</p>
                            </div>
                        </div>
                    )}
                  </div>
                  {hasReadNotifications && (
                    <div className="p-4 bg-muted/5 border-t">
                        <Button variant="outline" size="sm" className="w-full h-10 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] border-2 shadow-sm" onClick={clearReadNotifications}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Purge History
                        </Button>
                    </div>
                  )}
              </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
        
        <ClientOnly>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div className="flex items-center gap-3 cursor-pointer group transition-all">
                    <div className="hidden sm:flex flex-col items-end">
                        <p className="text-sm font-black uppercase tracking-tight text-slate-900 group-hover:text-primary transition-colors leading-none">{displayName || 'Admin'}</p>
                        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-60 leading-none mt-1">{role}</p>
                    </div>
                    <Avatar className="h-10 w-10 border-2 border-transparent group-hover:border-primary/20 transition-all shadow-sm rounded-xl">
                        <AvatarImage src={avatarUrl || undefined} alt="User" className="object-cover" />
                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
                    </Avatar>
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-[2rem] shadow-3xl border-4 p-2 overflow-hidden bg-background">
              <DropdownMenuLabel className="px-4 py-3 font-black uppercase tracking-widest text-[10px] text-muted-foreground opacity-60 border-b mb-1">
                Account Signature
              </DropdownMenuLabel>
              {role === 'owner' && (
                <div className="space-y-1">
                  <DropdownMenuItem asChild className="rounded-xl h-11 focus:bg-primary/5 focus:text-primary cursor-pointer">
                    <Link href="/staff" className="flex items-center w-full font-black uppercase text-[10px] tracking-widest">
                      <Users className="w-4 h-4 mr-3 text-primary opacity-40" />
                      <span>Team Manager</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="rounded-xl h-11 focus:bg-primary/5 focus:text-primary cursor-pointer">
                    <Link href="/settings" className="flex items-center w-full font-black uppercase text-[10px] tracking-widest">
                      <Settings className="w-4 h-4 mr-3 text-primary opacity-40" />
                      <span>Studio Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="rounded-xl h-11 focus:bg-primary/5 focus:text-primary cursor-pointer">
                    <Link href="/subscriptions" className="flex items-center w-full font-black uppercase text-[10px] tracking-widest">
                      <CreditCard className="w-4 h-4 mr-3 text-primary opacity-40" />
                      <span>Billing & Pro</span>
                    </Link>
                  </DropdownMenuItem>
                </div>
              )}
              {role === 'staff' && (
                 <DropdownMenuItem asChild className="rounded-xl h-11 focus:bg-primary/5 focus:text-primary cursor-pointer">
                    <Link href={`/staff/${user?.uid}`} className="flex items-center w-full font-black uppercase text-[10px] tracking-widest">
                      <User className="w-4 h-4 mr-3 text-primary opacity-40" />
                      <span>My Profile</span>
                    </Link>
                  </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="mx-1 my-2" />
              <DropdownMenuItem 
                onClick={handleLogout} 
                className="rounded-xl h-11 text-destructive font-black uppercase text-[10px] tracking-widest focus:bg-destructive/5 focus:text-destructive cursor-pointer"
              >
                <LogOut className="w-4 h-4 mr-3" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
