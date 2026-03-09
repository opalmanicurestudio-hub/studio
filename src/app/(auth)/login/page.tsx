'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Loader, KeyRound, Mail, Sparkles, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

const loginSchema = z.object({
  email: z.string().email('Invalid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    const auth = getAuth();
    try {
      await signInWithEmailAndPassword(auth, data.email, data.password);
      router.push('/dashboard');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Sign-in Failed',
        description: 'Invalid email or password. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!resetEmail || !resetEmail.includes('@')) {
      toast({
        variant: 'destructive',
        title: 'Invalid Identity',
        description: 'Please provide a valid professional email address.',
      });
      return;
    }

    setIsResetting(true);
    const auth = getAuth();
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetSent(true);
    } catch (error: any) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Recovery Failed',
        description: 'We could not initiate the recovery protocol for this email.',
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-sm"
    >
        <Card className="border-4 rounded-[3rem] shadow-3xl overflow-hidden bg-white/80 backdrop-blur-xl">
            <CardHeader className="p-8 pb-4 text-center border-b bg-muted/5">
                <div className="flex justify-center mb-6">
                    <div className="p-4 bg-white rounded-[1.5rem] shadow-xl border-2 border-primary/10">
                        <ClarityFlowLogo className="w-10 h-10" />
                    </div>
                </div>
                <div className="flex items-center justify-center gap-3 mb-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Secure Access</span>
                </div>
                <CardTitle className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                    Welcome Back
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-4">
                    Authorized studio entry required
                </CardDescription>
            </CardHeader>
            
            <CardContent className="p-8 pb-4">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <div className="space-y-2 text-left">
                        <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Identity (Email)</Label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                            <Input 
                                id="email" 
                                type="email" 
                                placeholder="ALEX@EXAMPLE.COM" 
                                {...register('email')} 
                                className="h-14 pl-12 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20"
                            />
                        </div>
                        {errors.email && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.email.message}</p>}
                    </div>
                    
                    <div className="space-y-2 text-left">
                        <div className="flex justify-between items-center px-1">
                            <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Security Key</Label>
                            <button 
                                type="button" 
                                onClick={() => setIsForgotPasswordOpen(true)}
                                className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline underline-offset-4 decoration-2"
                            >
                                Forgot?
                            </button>
                        </div>
                        <div className="relative">
                            <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                            <Input 
                                id="password" 
                                type="password" 
                                {...register('password')} 
                                className="h-14 pl-12 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20"
                            />
                        </div>
                        {errors.password && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.password.message}</p>}
                    </div>

                    <Button type="submit" className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all group" disabled={isLoading}>
                        {isLoading ? (
                            <Loader className="h-6 w-6 animate-spin" />
                        ) : (
                            <span className="flex items-center gap-2">
                                Access Portal
                                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                            </span>
                        )}
                    </Button>
                </form>
            </CardContent>
            
            <CardFooter className="p-8 pt-0 flex flex-col gap-4">
                <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">
                    New Creator? <Link href="/signup" className="text-primary underline decoration-2 underline-offset-4">Initialize Account</Link>
                </p>
            </CardFooter>
        </Card>

        <Dialog open={isForgotPasswordOpen} onOpenChange={(val) => { setIsForgotPasswordOpen(val); if(!val) setResetSent(false); }}>
            <DialogContent className="sm:max-w-md p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-white/95 backdrop-blur-xl">
                <AnimatePresence mode="wait">
                    {!resetSent ? (
                        <motion.div 
                            key="reset-form"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                        >
                            <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
                                <div className="flex items-center gap-3 mb-2">
                                    <ShieldCheck className="w-5 h-5 text-primary" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Security Protocol</span>
                                </div>
                                <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                                    Key Recovery
                                </DialogTitle>
                                <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
                                    Initiate a secure password reset sequence.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="p-8 space-y-6">
                                <div className="space-y-3 text-left">
                                    <Label htmlFor="reset-email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Verified Professional Email</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                                        <Input 
                                            id="reset-email" 
                                            type="email" 
                                            placeholder="ALEX@EXAMPLE.COM" 
                                            value={resetEmail}
                                            onChange={(e) => setResetEmail(e.target.value)}
                                            className="h-14 pl-12 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground font-black uppercase leading-relaxed tracking-tight opacity-60">
                                    We will dispatch a secure one-time recovery link to this address to re-establish your studio credentials.
                                </p>
                            </div>
                            <DialogFooter className="p-8 pt-0 flex flex-col gap-3">
                                <Button 
                                    onClick={handleForgotPassword} 
                                    disabled={isResetting}
                                    className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-2xl shadow-primary/30"
                                >
                                    {isResetting ? <Loader className="animate-spin h-6 w-6" /> : 'Authorize Recovery'}
                                </Button>
                                <Button variant="ghost" onClick={() => setIsForgotPasswordOpen(false)} className="w-full font-black uppercase text-[10px] tracking-widest">Abort Protocol</Button>
                            </DialogFooter>
                        </motion.div>
                    ) : (
                        <motion.div 
                            key="reset-success"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="p-12 text-center space-y-8"
                        >
                            <div className="w-24 h-24 bg-green-500/10 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6">
                                <CheckCircle2 className="w-12 h-12 text-green-500 -rotate-6" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-2xl font-black uppercase tracking-tighter">Dispatch Complete</h3>
                                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight opacity-80">
                                    Check your inbox for <strong>{resetEmail}</strong> to finalize the recovery sequence.
                                </p>
                            </div>
                            <Button 
                                onClick={() => setIsForgotPasswordOpen(false)} 
                                className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20"
                            >
                                Return to Terminal
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </DialogContent>
        </Dialog>
    </motion.div>
  );
}
