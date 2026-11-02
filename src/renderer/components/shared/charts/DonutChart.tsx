import { useState } from 'react';
import { Info } from 'lucide-react';
import { formatRupiah } from '@/lib/format';

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color?: string;
  desc?: string;
}

interface DonutChartProps {
  title?: string;
  segments: DonutSegment[];
  centerLabel?: string;
  className?: string;
  showInfo?: boolean;
}

const DEFAULT_COLORS = ['#2e7d32', '#1565c0', '#f9a825', '#6d4c41', '#7b1fa2', '#00838f'];

export function DonutChart({
  title,
  segments,
  centerLabel = 'Total',
  className = '',
  showInfo = true,
}: DonutChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (segments.length === 0 || total === 0) {
    return (
      <div className={`rounded-2xl border border-border bg-card p-6 shadow-xs ${className}`}>
        {title && <h3 className="font-bold text-base text-foreground tracking-tight mb-2">{title}</h3>}
        <p className="text-muted-foreground text-xs py-4">Belum ada data distribusi.</p>
      </div>
    );
  }

  const coloredSegments = segments.map((s, idx) => ({
    ...s,
    color: s.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]!,
    percentage: Math.round((s.value / total) * 100),
  }));

  const radius = 64;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;

  const arcs = coloredSegments.map((s, idx) => {
    const priorSum = coloredSegments.slice(0, idx).reduce((acc, curr) => acc + curr.value, 0);
    const strokeDasharray = `${(s.value / total) * circumference} ${circumference}`;
    const strokeDashoffset = -((priorSum / total) * circumference);
    return { ...s, strokeDasharray, strokeDashoffset };
  });

  const activeSegment = hoveredId ? coloredSegments.find((s) => s.id === hoveredId) : null;

  return (
    <div className={`rounded-2xl border border-border bg-card p-6 shadow-xs ${className}`}>
      {title && (
        <h3 className="font-bold text-base text-foreground tracking-tight mb-4 flex items-center gap-1.5">
          {title}
          {showInfo && <Info className="size-3.5 text-muted-foreground/60" />}
        </h3>
      )}

      <div className="grid gap-6 sm:grid-cols-[180px_1fr] items-center">
        {/* SVG Donut */}
        <div className="relative flex justify-center items-center">
          <svg viewBox="0 0 180 180" className="size-40 -rotate-90 select-none">
            {/* Background ring */}
            <circle
              cx="90"
              cy="90"
              r={radius}
              fill="transparent"
              stroke="#f0f0ed"
              strokeWidth={strokeWidth}
            />
            {/* Segment arcs */}
            {arcs.map((arc) => (
              <circle
                key={arc.id}
                cx="90"
                cy="90"
                r={radius}
                fill="transparent"
                stroke={arc.color}
                strokeWidth={hoveredId === arc.id ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={arc.strokeDasharray}
                strokeDashoffset={arc.strokeDashoffset}
                strokeLinecap="round"
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHoveredId(arc.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            ))}
          </svg>

          {/* Center text */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">
              {activeSegment ? activeSegment.label : centerLabel}
            </span>
            <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
              {activeSegment
                ? `${activeSegment.percentage}%`
                : total >= 1000000
                  ? `${(total / 1000000).toFixed(1)}jt`
                  : formatRupiah(String(total))}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="space-y-2.5">
          {coloredSegments.map((s) => (
            <div
              key={s.id}
              className={`flex items-center justify-between text-xs p-2 rounded-xl transition-all cursor-pointer ${
                hoveredId === s.id ? 'bg-surface-muted font-medium' : ''
              }`}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <span className="size-2.5 rounded-xs shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate font-semibold text-foreground">{s.label}</span>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-muted-foreground tabular-nums font-medium">{s.percentage}%</span>
                <span className="font-bold tabular-nums text-foreground">{formatRupiah(String(s.value))}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
