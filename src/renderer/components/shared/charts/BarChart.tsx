import { useState } from 'react';
import { formatRupiah } from '@/lib/format';

export interface BarDatum {
  label: string; // e.g. "01/10" or "Pupuk"
  date?: string;
  value: number; // primary or total
  secondary?: number; // e.g. credit
  count?: number; // invoice count
}

interface BarChartProps {
  title?: string;
  data: BarDatum[];
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
  stacked?: boolean;
  height?: number;
  className?: string;
}

export function BarChart({
  title,
  data,
  primaryLabel = 'Tunai',
  secondaryLabel = 'Kredit',
  primaryColor = '#2e7d32',
  secondaryColor = '#f9a825',
  stacked = true,
  height = 220,
  className = '',
}: BarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground p-6 rounded-xl border ${className}`}>
        Belum ada data grafik.
      </div>
    );
  }

  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;
  const svgWidth = 600;
  const chartW = svgWidth - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const hasSecondary = data.some((d) => d.secondary !== undefined && d.secondary > 0);
  const maxVal = Math.max(
    ...data.map((d) => (stacked && hasSecondary ? d.value + (d.secondary ?? 0) : Math.max(d.value, d.secondary ?? 0))),
    1000,
  );
  const yMax = Math.ceil(maxVal * 1.15);

  const slotW = chartW / data.length;
  const barW = Math.max(4, Math.min(24, slotW * 0.65));

  const active = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className={`rounded-xl border bg-card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        {title && <h3 className="font-semibold text-base">{title}</h3>}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: primaryColor }} />
            <span className="text-muted-foreground">{primaryLabel}</span>
          </div>
          {hasSecondary && (
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: secondaryColor }} />
              <span className="text-muted-foreground">{secondaryLabel}</span>
            </div>
          )}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${svgWidth} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Grid lines */}
          {[0, 0.33, 0.66, 1].map((ratio, idx) => {
            const y = paddingTop + chartH * ratio;
            const val = yMax * (1 - ratio);
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.08"
                  strokeDasharray="3 3"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {val >= 1000000 ? `${(val / 1000000).toFixed(1)}jt` : `${(val / 1000).toFixed(0)}rb`}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {data.map((d, i) => {
            const cx = paddingLeft + i * slotW + slotW / 2;
            const bx = cx - barW / 2;

            if (stacked && hasSecondary) {
              const h1 = Math.max(1, (d.value / yMax) * chartH);
              const h2 = Math.max(0, ((d.secondary ?? 0) / yMax) * chartH);
              const yBase = paddingTop + chartH;
              const y1 = yBase - h1;
              const y2 = y1 - h2;

              return (
                <g key={i}>
                  {/* Primary bar segment */}
                  <rect
                    x={bx}
                    y={y1}
                    width={barW}
                    height={h1}
                    fill={primaryColor}
                    opacity={hoverIndex === i ? 1 : 0.85}
                    rx={h2 === 0 ? 3 : 0}
                  />
                  {/* Secondary bar segment (stacked on top) */}
                  {h2 > 0 && (
                    <rect
                      x={bx}
                      y={y2}
                      width={barW}
                      height={h2}
                      fill={secondaryColor}
                      opacity={hoverIndex === i ? 1 : 0.85}
                      rx={3}
                    />
                  )}
                  {/* Interaction touch box */}
                  <rect
                    x={paddingLeft + i * slotW}
                    y={paddingTop}
                    width={slotW}
                    height={chartH}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                </g>
              );
            }

            // Single bar
            const h = Math.max(1, (d.value / yMax) * chartH);
            const by = paddingTop + chartH - h;
            return (
              <g key={i}>
                <rect
                  x={bx}
                  y={by}
                  width={barW}
                  height={h}
                  fill={primaryColor}
                  opacity={hoverIndex === i ? 1 : 0.85}
                  rx={3}
                />
                <rect
                  x={paddingLeft + i * slotW}
                  y={paddingTop}
                  width={slotW}
                  height={chartH}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverIndex(i)}
                />
              </g>
            );
          })}

          {/* X axis labels (sparse) */}
          {data.map((d, i) => {
            const step = Math.max(1, Math.floor(data.length / 8));
            if (i % step !== 0 && i !== data.length - 1) return null;
            const cx = paddingLeft + i * slotW + slotW / 2;
            return (
              <text
                key={i}
                x={cx}
                y={paddingTop + chartH + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {d.label}
              </text>
            );
          })}
        </svg>

        {/* Floating tooltip */}
        {hoverIndex !== null && active && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: `${((paddingLeft + hoverIndex * slotW + slotW / 2) / svgWidth) * 100}%`,
            }}
          >
            <p className="font-semibold text-foreground mb-1">{active.date ?? active.label}</p>
            <div className="flex items-center gap-2 text-xs">
              <span className="size-2 rounded-full" style={{ backgroundColor: primaryColor }} />
              <span className="text-muted-foreground">{primaryLabel}:</span>
              <span className="font-medium tabular-nums">{formatRupiah(String(active.value))}</span>
            </div>
            {hasSecondary && (
              <div className="flex items-center gap-2 text-xs mt-0.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: secondaryColor }} />
                <span className="text-muted-foreground">{secondaryLabel}:</span>
                <span className="font-medium tabular-nums">{formatRupiah(String(active.secondary ?? 0))}</span>
              </div>
            )}
            {active.count !== undefined && (
              <p className="text-muted-foreground text-[11px] mt-1 pt-1 border-t">
                {active.count} transaksi
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

