import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertCircle } from 'lucide-react';

import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Button } from '@/components/ui/button.js';
import { PasswordInput } from '@/components/shared/PasswordInput.js';
import { useAuth } from '@/contexts/AuthContext.js';
import { loginSchema, type LoginFormValues } from './loginSchema.js';

import signPng from '@/assets/sign.png';

/** Card entrance animation */
const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

/** Error alert animation */
const errorVariants = {
  hidden: { opacity: 0, y: -8, height: 0 },
  visible: { opacity: 1, y: 0, height: 'auto' },
  exit: { opacity: 0, y: -8, height: 0 },
};

export function LoginPage() {
  const { login } = useAuth();
  const [serverError, setServerError] = useState('');

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: 'admin', password: '' },
  });

  const { isSubmitting } = form.formState;

  const onSubmit = useCallback(
    async (values: LoginFormValues) => {
      setServerError('');
      try {
        await login(values.username, values.password);
      } catch (err: unknown) {
        const msg =
          err instanceof Error && 'response' in err
            ? (
                err as {
                  response?: { data?: { error?: { message?: string } } };
                }
              ).response?.data?.error?.message
            : null;
        setServerError(msg ?? '登录失败，请重试');
      }
    },
    [login],
  );

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#0F172A' }}
    >
      {/* ── Background glow orbs (exact Figma values) ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Top-right: 280×280, blur 120px, #10B981 at 10% */}
        <div
          className="absolute rounded-full"
          style={{
            width: 280,
            height: 280,
            top: 100,
            right: 120,
            backgroundColor: 'rgba(16, 185, 129, 0.10)',
            filter: 'blur(120px)',
          }}
        />
        {/* Bottom-left: 350×350, blur 150px, #10B981 at 12% */}
        <div
          className="absolute rounded-full"
          style={{
            width: 350,
            height: 350,
            bottom: 100,
            left: 80,
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            filter: 'blur(150px)',
          }}
        />
        {/* Card backlight: 500×200, blur 80px, #10B981 at 10% */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: 500,
            height: 200,
            backgroundColor: 'rgba(16, 185, 129, 0.10)',
            filter: 'blur(80px)',
          }}
        />
      </div>

      {/* ── Card ── */}
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-md px-4"
      >
        <div
          className="flex w-full flex-col items-center gap-6 rounded-xl backdrop-blur-md transition-shadow duration-500 hover:shadow-[0_0_48px_rgba(16,185,129,0.08)]"
          style={{
            backgroundColor: 'rgba(30, 41, 59, 0.92)',
            border: '1px solid rgba(51, 84, 102, 0.80)',
            padding: '48px 48px 48px 48px',
            boxShadow: '0 4px 32px rgba(0, 0, 0, 0.30)',
          }}
        >
          {/* ── Logo ── */}
          <div className="flex h-20 w-20 items-center justify-center">
            <img
              src={signPng}
              alt="unturned-manager 标志"
              className="h-16 w-16"
            />
          </div>

          {/* ── Titles ── */}
          <div className="flex flex-col items-center gap-2">
            <h1
              className="m-0 text-3xl font-semibold leading-none tracking-tight"
              style={{ color: '#F1F5FB' }}
            >
              unturned-manager
            </h1>
            <p className="m-0 text-base leading-none" style={{ color: '#94A3B8' }}>
              Unturned 服务端管理面板
            </p>
          </div>

          {/* ── Form ── */}
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex w-full flex-col"
            style={{ gap: 24 }}
            aria-label="登录表单"
            noValidate
          >
            {/* Username */}
            <div className="flex flex-col" style={{ gap: 6 }}>
              <Label
                htmlFor="login-username"
                className="text-sm font-medium"
                style={{ color: '#F1F5FB' }}
              >
                用户名
              </Label>
              <Input
                id="login-username"
                autoFocus
                autoComplete="username"
                required
                className="h-10 rounded-lg text-sm"
                style={{
                  backgroundColor: '#0F172A',
                  borderColor: '#334059',
                }}
                aria-invalid={!!form.formState.errors.username}
                aria-describedby={
                  form.formState.errors.username ? 'login-username-error' : undefined
                }
                {...form.register('username')}
              />
              {form.formState.errors.username && (
                <p
                  id="login-username-error"
                  className="m-0 text-sm"
                  style={{ color: '#EF4444' }}
                  role="alert"
                >
                  {form.formState.errors.username.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="flex flex-col" style={{ gap: 6 }}>
              <Label
                htmlFor="login-password"
                className="text-sm font-medium"
                style={{ color: '#F1F5FB' }}
              >
                密码
              </Label>
              <PasswordInput
                id="login-password"
                required
                className="h-10 rounded-lg text-sm"
                style={{
                  backgroundColor: '#0F172A',
                  borderColor: '#334059',
                }}
                aria-invalid={!!form.formState.errors.password}
                aria-describedby={
                  form.formState.errors.password ? 'login-password-error' : undefined
                }
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p
                  id="login-password-error"
                  className="m-0 text-sm"
                  style={{ color: '#EF4444' }}
                  role="alert"
                >
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            {/* Error alert — glass-style with icon */}
            <AnimatePresence mode="wait">
              {serverError && (
                <motion.div
                  variants={errorVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <div
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm backdrop-blur-sm"
                    role="alert"
                    aria-live="assertive"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: 'rgba(252, 165, 165, 0.95)',
                    }}
                  >
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ color: 'rgba(239, 68, 68, 0.85)' }}
                    />
                    <span>{serverError}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit button */}
            <Button
              type="submit"
              className="h-10 w-full text-sm font-medium transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
              style={{
                backgroundColor: '#10B981',
                color: '#F1F5FB',
                borderRadius: 6,
              }}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>

          {/* ── Footer ── */}
          <p className="m-0 text-xs" style={{ color: '#64748B' }}>
            v0.1.0 · unturned-manager
          </p>
        </div>
      </motion.div>
    </div>
  );
}
