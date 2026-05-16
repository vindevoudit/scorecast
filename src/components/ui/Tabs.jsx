// Tier 11 Chunk 1 — <Tabs> primitive. Wraps @radix-ui/react-tabs.
//
// NOT used for top-level nav (Sidebar handles that). Reserved for admin
// sub-nav + ProfileView section tabs in Chunk 2.

import { forwardRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

const Tabs = TabsPrimitive.Root;

const TabsList = forwardRef(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-2xl border border-default bg-elevated/60 p-1',
        className,
      )}
      {...props}
    />
  );
});

const TabsTrigger = forwardRef(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-sm font-semibold text-fg-muted transition duration-200',
        'data-[state=active]:bg-accent data-[state=active]:text-accent-fg',
        'hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});

const TabsContent = forwardRef(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-4 focus-visible:outline-none', className)}
      {...props}
    />
  );
});

export { Tabs, TabsList, TabsTrigger, TabsContent };
export default Tabs;
