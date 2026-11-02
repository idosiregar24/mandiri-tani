import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border-transparent [a&]:hover:bg-primary/90',
        secondary: 'bg-surface-muted text-foreground border-border/60 [a&]:hover:bg-accent',
        destructive: 'bg-rose-50 text-rose-800 border-border/60 [a&]:hover:bg-rose-100',
        success: 'bg-emerald-50 text-emerald-800 border-border/60',
        warning: 'bg-amber-50 text-amber-800 border-border/60',
        info: 'bg-blue-50 text-blue-800 border-border/60',
        outline: 'border-border text-foreground bg-white [a&]:hover:bg-accent',
        ghost: 'border-transparent text-muted-foreground [a&]:hover:bg-accent',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
