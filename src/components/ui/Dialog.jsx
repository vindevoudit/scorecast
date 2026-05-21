// Tier 11 Chunk 1 — <Dialog> primitive. Wraps @radix-ui/react-dialog.
//
// Radix gives us focus trap, return-focus-on-close, Escape-to-close,
// click-outside-to-close, and the aria-modal role for free. ConfirmModal +
// SignInModal both rebuild on this in Chunk 2.
//
// Anatomy (matches Radix's slot model):
//   <Dialog open onOpenChange>
//     <DialogTrigger>...</DialogTrigger>        (optional)
//     <DialogContent>
//       <DialogTitle>...</DialogTitle>
//       <DialogDescription>...</DialogDescription>  (optional)
//       {body}
//       <DialogFooter>...</DialogFooter>
//     </DialogContent>
//   </Dialog>

import { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from './cn';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-base/70 backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'duration-150 ease-out-expo',
        className,
      )}
      {...props}
    />
  );
});

const DialogContent = forwardRef(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-3xl border border-default bg-elevated p-6 shadow-glow',
          'focus:outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'duration-180 ease-out-expo',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

const DialogTitle = forwardRef(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-semibold text-fg', className)}
      {...props}
    />
  );
});

const DialogDescription = forwardRef(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('mt-2 text-sm text-fg-muted', className)}
      {...props}
    />
  );
});

function DialogFooter({ className, ...props }) {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};
export default Dialog;
