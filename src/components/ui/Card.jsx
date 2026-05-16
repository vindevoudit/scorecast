// Tier 11 Chunk 1 — <Card> primitive.
//
// Wraps the rounded-3xl border bg-elevated/85 shell pattern repeated across
// ~25 components. Slot anatomy:
//   <Card>
//     <CardHeader>...</CardHeader>
//     <CardBody>...</CardBody>
//     <CardFooter>...</CardFooter>
//   </Card>
//
// `variant`:
//   default — the standard elevated panel
//   subtle  — flatter; for inline read-only surfaces (e.g. InlineGatePanel)

import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const cardStyles = cva('rounded-3xl border', {
  variants: {
    variant: {
      default: 'border-default bg-elevated/85',
      subtle: 'border-default bg-elevated/50',
    },
    padded: { true: 'p-6', false: '' },
  },
  defaultVariants: { variant: 'default', padded: false },
});

const Card = forwardRef(function Card({ variant, padded, className, ...props }, ref) {
  return <div ref={ref} className={cardStyles({ variant, padded, className })} {...props} />;
});

const CardHeader = forwardRef(function CardHeader({ className, ...props }, ref) {
  return <div ref={ref} className={cn('flex flex-col gap-2 p-6 pb-3', className)} {...props} />;
});

const CardBody = forwardRef(function CardBody({ className, ...props }, ref) {
  return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
});

const CardFooter = forwardRef(function CardFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-3 border-t border-default px-6 py-4', className)}
      {...props}
    />
  );
});

export { Card, CardHeader, CardBody, CardFooter, cardStyles };
export default Card;
