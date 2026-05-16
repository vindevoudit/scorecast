// Tier 11 Chunk 1 — <Toast> primitive. Wraps @radix-ui/react-toast.
//
// Replaces the ad-hoc `NotificationContext.status` banner in Chunk 2.
// Mount <ToastProvider> + <ToastViewport> at the app root; emit toasts
// imperatively via a small useToast() hook layered on top of Radix's
// controlled API.

import { forwardRef } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const ToastProvider = ToastPrimitive.Provider;

const ToastViewport = forwardRef(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn(
        'fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-4 sm:right-4 sm:max-w-sm',
        className,
      )}
      {...props}
    />
  );
});

const toastStyles = cva(
  [
    'pointer-events-auto relative flex w-full items-start gap-3 rounded-2xl border p-4 shadow-glow',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
  ].join(' '),
  {
    variants: {
      tone: {
        neutral: 'border-default bg-elevated text-fg',
        success: 'border-success/40 bg-elevated text-fg',
        danger: 'border-danger/40 bg-elevated text-fg',
        info: 'border-info/40 bg-elevated text-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const Toast = forwardRef(function Toast({ className, tone, ...props }, ref) {
  return <ToastPrimitive.Root ref={ref} className={toastStyles({ tone, className })} {...props} />;
});

const ToastTitle = forwardRef(function ToastTitle({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Title
      ref={ref}
      className={cn('text-sm font-semibold text-fg', className)}
      {...props}
    />
  );
});

const ToastDescription = forwardRef(function ToastDescription({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Description
      ref={ref}
      className={cn('mt-0.5 text-xs text-fg-muted', className)}
      {...props}
    />
  );
});

const ToastClose = forwardRef(function ToastClose({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Close
      ref={ref}
      className={cn(
        'absolute right-2 top-2 rounded-md p-1 text-fg-subtle transition hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      aria-label="Dismiss"
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      </svg>
    </ToastPrimitive.Close>
  );
});

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  toastStyles,
};
export default Toast;
