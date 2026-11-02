import { Info } from 'lucide-react';
import { formatNumber, formatRupiah } from '@/lib/format';

export interface RankItem {
  id: string;
  name: string;
  subtitle?: string;
  amount: number;
  qty?: number | string;
  unit?: string;
  percentage?: number;
}

interface HorizontalBarChartProps {
  title?: string;
  subtitle?: string;
  items: RankItem[];
  maxItems?: number;
  barColor?: string;
  className?: string;
  showInfo?: boolean;
  formatValue?: (val: number) => string;
}

export function HorizontalBarChart({
  title,
  subtitle,
  items,
  maxItems = 5,
  barColor = '#2e7d32',
  className = '',
  showInfo = true,
  formatValue = (val) => formatRupiah(String(val)),
}: HorizontalBarChartProps) {
  const displayItems = items.slice(0, maxItems);
  const maxVal = Math.max(...displayItems.map((item) => item.amount), 1);

  if (displayItems.length === 0) {
    return (
      <div className={`rounded-2xl border border-border bg-card p-6 shadow-xs ${className}`}>
        {title && <h3 className="font-bold text-base text-foreground tracking-tight mb-2">{title}</h3>}
        <p className="text-muted-foreground text-xs py-4">Belum ada data peringkat.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-border bg-card p-6 shadow-xs ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          {title && (
            <h3 className="font-bold text-base text-foreground tracking-tight flex items-center gap-1.5">
              {title}
              {showInfo && <Info className="size-3.5 text-muted-foreground/60" />}
            </h3>
          )}
          {subtitle && <p className="text-muted-foreground text-xs mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="space-y-4">
        {displayItems.map((item, idx) => {
          const ratio = Math.max(4, Math.round((item.amount / maxVal) * 100));
          return (
            <div key={item.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="text-muted-foreground font-mono font-bold w-4 text-xs">{idx + 1}.</span>
                  <span className="font-semibold text-foreground truncate">{item.name}</span>
                  {item.qty !== undefined && (
                    <span className="text-muted-foreground text-xs shrink-0 tabular-nums">
                      ({formatNumber(String(item.qty))} {item.unit ?? ''})
                    </span>
                  )}
                </div>
                <span className="font-bold text-foreground tabular-nums text-xs sm:text-sm shrink-0">
                  {formatValue(item.amount)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${ratio}%`,
                    backgroundColor: barColor,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
