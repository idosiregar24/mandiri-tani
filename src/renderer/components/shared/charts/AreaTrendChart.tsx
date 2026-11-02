import { useState } from 'react';
import { Info } from 'lucide-react';
import { formatRupiah } from '@/lib/format';

export interface TrendPoint {
  label: string;
  date?: string;
  value: number;
  secondary?: number;
}

interface AreaTrendChartProps {
  title?: string;
  data: TrendPoint[];
  primaryLabel?: string;
  secondaryLabel?: string;
  height?: number;
  className?: string;
  showInfo?: boolean;
}

export function AreaTrendChart({
  title,
  data,
  primaryLabel = 'Omzet',
  secondaryLabel = 'Laba Kotor',
  height = 220,
  className = '',
  showInfo = true,
}: AreaTrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground p-8 rounded-2xl border border-border bg-card shadow-xs ${className}`}>
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
  const yMax = Math.ceil(maxVal * 1.15);

  const getX = (i: number) => paddingLeft + (i / Math.max(1, data.length - 1)) * chartW;
  const getY = (val: number) => paddingTop + chartH - (val / yMax) * chartH;

  const primaryPoints = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');
  const areaPoints = `${getX(0)},${paddingTop + chartH} ${primaryPoints} ${getX(data.length - 1)},${paddingTop + chartH}`;

  const hasSecondary = data.some((d) => d.secondary !== undefined);
  const secondaryPoints = hasSecondary
    ? data.map((d, i) => `${getX(i)},${getY(d.secondary ?? 0)}`).join(' ')
    : '';

  const activePoint = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className={`rounded-2xl border border-border bg-card p-6 shadow-xs ${className}`}>
      <div className="flex items-center justify-between mb-4">
        {title && (
          <h3 className="font-bold text-base text-foreground tracking-tight flex items-center gap-1.5">
            {title}
            {showInfo && <Info className="size-3.5 text-muted-foreground/60" />}
          </h3>
        )}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-xs bg-[#2e7d32]" />
            <span className="text-muted-foreground font-medium">{primaryLabel}</span>
          </div>
          {hasSecondary && (
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-xs bg-[#f9a825]" />
              <span className="text-muted-foreground font-medium">{secondaryLabel}</span>
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
              <stop offset="0%" stopColor="#2e7d32" stopOpacity="0.18" />
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
                  stroke="#e5e5e2"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums font-mono"
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

          {/* X axis labels */}
          {data.map((d, i) => {
            const step = Math.max(1, Math.floor(data.length / 6));
            if (i % step !== 0 && i !== data.length - 1) return null;
            return (
              <text
                key={i}
                x={getX(i)}
                y={paddingTop + chartH + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px] font-medium"
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
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-card px-3.5 py-2 text-xs shadow-md"
            style={{
              left: `${(getX(hoverIndex) / svgWidth) * 100}%`,
            }}
          >
            <p className="font-bold text-foreground mb-1">{activePoint.date ?? activePoint.label}</p>
            <div className="flex items-center gap-2 text-xs">
              <span className="size-2 rounded-xs bg-[#2e7d32]" />
              <span className="text-muted-foreground">{primaryLabel}:</span>
              <span className="font-semibold text-foreground tabular-nums">{formatRupiah(String(activePoint.value))}</span>
            </div>
            {activePoint.secondary !== undefined && (
              <div className="flex items-center gap-2 text-xs mt-0.5">
                <span className="size-2 rounded-xs bg-[#f9a825]" />
                <span className="text-muted-foreground">{secondaryLabel}:</span>
                <span className="font-semibold text-foreground tabular-nums">{formatRupiah(String(activePoint.secondary))}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
