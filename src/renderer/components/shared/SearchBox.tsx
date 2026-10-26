import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** The search field at the top of every list. */
export function SearchBox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <div className={cn('relative w-full max-w-md', className)}>
      <Search className="text-muted-foreground absolute top-1/2 left-3 size-5 -translate-y-1/2" aria-hidden />
      <Input type="search" {...props} className="h-11 pl-10 text-base md:text-base" />
    </div>
  );
}
