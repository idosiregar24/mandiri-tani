import { useState } from 'react';
import { formatRupiah } from '@/lib/format';

export interface TrendPoint {
  label: string; // e.g. "01/10" or "Sen"
  date?: string; // full date
  value: number; // primary (e.g. Omzet)
  secondary?: number; // secondary (e.g. Laba)
}

interface AreaTrendChartProps {
  title?: string;
  data: TrendPoint[];
  primaryLabel?: string;
  secondaryLabel?: string;
  height?: number;
  className?: string;
}

export function AreaTrendChart({
  title,
  data,
  primaryLabel = 'Omzet',
  secondaryLabel = 'Laba Kotor',
  height = 220,
  className = '',
}: AreaTrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground p-6 rounded-xl border ${className}`}>
        Belum ada data tren penjualan.
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

  const maxVal = Math.max(...data.map((d) => Math.max(d.value, d.secondary ?? 0)), 1000);
  // Round up to nice number
  const yMax = Math.ceil(maxVal * 1.15);

  const getX = (i: number) => paddingLeft + (i / Math.max(1, data.length - 1)) * chartW;
  const getY = (val: number) => paddingTop + chartH - (val / yMax) * chartH;

  // Build SVG path
  const primaryPoints = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');
  const areaPoints = `${getX(0)},${paddingTop + chartH} ${primaryPoints} ${getX(data.length - 1)},${paddingTop + chartH}`;

  const hasSecondary = data.some((d) => d.secondary !== undefined);
  const secondaryPoints = hasSecondary
    ? data.map((d, i) => `${getX(i)},${getY(d.secondary ?? 0)}`).join(' ')
    : '';

  const activePoint = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className={`rounded-xl border bg-card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        {title && <h3 className="font-semibold text-base">{title}</h3>}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#2e7d32]" />
            <span className="text-muted-foreground">{primaryLabel}</span>
          </div>
          {hasSecondary && (
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[#f9a825]" />
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
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2e7d32" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2e7d32" stopOpacity="0.0" />
            </linearGradient>
          </defs>

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

          {/* Area fill */}
          <polygon points={areaPoints} fill="url(#areaGradient)" />

          {/* Primary Line */}
          <polyline
            points={primaryPoints}
            fill="none"
            stroke="#2e7d32"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Secondary Line */}
          {hasSecondary && (
            <polyline
              points={secondaryPoints}
              fill="none"
              stroke="#f9a825"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="4 2"
            />
          )}

          {/* X axis labels (sparse) */}
          {data.map((d, i) => {
            // Show every ~5th point or first/last
            const step = Math.max(1, Math.floor(data.length / 6));
            if (i % step !== 0 && i !== data.length - 1) return null;
            return (
              <text
                key={i}
                x={getX(i)}
                y={paddingTop + chartH + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {d.label}
              </text>
            );
          })}

          {/* Hover interactive vertical guide */}
          {hoverIndex !== null && activePoint && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={paddingTop}
                x2={getX(hoverIndex)}
                y2={paddingTop + chartH}
                stroke="#2e7d32"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
              <circle
                cx={getX(hoverIndex)}
                cy={getY(activePoint.value)}
                r="4.5"
                fill="#ffffff"
                stroke="#2e7d32"
                strokeWidth="2.5"
              />
              {activePoint.secondary !== undefined && (
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(activePoint.secondary)}
                  r="4"
                  fill="#ffffff"
                  stroke="#f9a825"
                  strokeWidth="2"
                />
              )}
            </g>
          )}

          {/* Hover overlay touch points */}
          {data.map((_, i) => (
            <rect
              key={i}
              x={getX(i) - chartW / (data.length * 2)}
              y={paddingTop}
              width={chartW / data.length}
              height={chartH}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHoverIndex(i)}
            />
          ))}
        </svg>

        {/* Floating tooltip */}
        {hoverIndex !== null && activePoint && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(getX(hoverIndex) / svgWidth) * 100}%`,
            }}
          >
            <p className="font-semibold text-foreground mb-1">{activePoint.date ?? activePoint.label}</p>
            <div className="flex items-center gap-2 text-xs">
              <span className="size-2 rounded-full bg-[#2e7d32]" />
              <span className="text-muted-foreground">{primaryLabel}:</span>
              <span className="font-medium tabular-nums">{formatRupiah(String(activePoint.value))}</span>
            </div>
            {activePoint.secondary !== undefined && (
              <div className="flex items-center gap-2 text-xs mt-0.5">
                <span className="size-2 rounded-full bg-[#f9a825]" />
                <span className="text-muted-foreground">{secondaryLabel}:</span>
                <span className="font-medium tabular-nums">{formatRupiah(String(activePoint.secondary))}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

