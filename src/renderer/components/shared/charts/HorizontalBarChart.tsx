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
}

export function HorizontalBarChart({
  title,
  subtitle,
  items,
  maxItems = 5,
  barColor = '#2e7d32',
  className = '',
}: HorizontalBarChartProps) {
  const displayItems = items.slice(0, maxItems);
  const maxVal = Math.max(...displayItems.map((item) => item.amount), 1);

  if (displayItems.length === 0) {
    return (
      <div className={`rounded-xl border bg-card p-5 ${className}`}>
        {title && <h3 className="font-semibold text-base mb-2">{title}</h3>}
        <p className="text-muted-foreground text-sm py-4">Belum ada data peringkat.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border bg-card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          {title && <h3 className="font-semibold text-base">{title}</h3>}
          {subtitle && <p className="text-muted-foreground text-xs">{subtitle}</p>}
        </div>
      </div>

      <div className="space-y-3.5">
        {displayItems.map((item, idx) => {
          const ratio = Math.max(4, Math.round((item.amount / maxVal) * 100));
          return (
            <div key={item.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="text-muted-foreground text-xs font-mono w-4">{idx + 1}.</span>
                  <span className="font-medium truncate">{item.name}</span>
                  {item.qty !== undefined && (
                    <span className="text-muted-foreground text-xs shrink-0 tabular-nums">
                      ({formatNumber(String(item.qty))} {item.unit ?? ''})
                    </span>
                  )}
                </div>
                <span className="font-semibold tabular-nums text-sm shrink-0">
                  {formatRupiah(String(item.amount))}
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

