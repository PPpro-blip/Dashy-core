"use client";

/**
 * DashyCore v7 — lightweight glassmorphism charts for /analytics.
 *
 * Pure inline SVG (no charting dependency) so the bundle stays tiny and the
 * charts always render — including the "honest zero" state, which is a
 * first-class look here rather than an error.
 */

export interface BarDatum {
  label: string;
  value: number;
  color: string;
  href?: string;
  emptyHint?: string;
}

export function GlassBarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3.5">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-zinc-300">{d.label}</span>
            <span className="font-mono text-zinc-500">{d.value}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: `linear-gradient(90deg, ${d.color}99, ${d.color})`,
                boxShadow: d.value > 0 ? `0 0 12px ${d.color}55` : undefined,
              }}
            />
          </div>
          {d.value === 0 && d.emptyHint && (
            <p className="mt-1 text-[10.5px] text-zinc-600">{d.emptyHint}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export interface LinePoint {
  label: string;
  value: number;
}

export function GlassLineChart({ points }: { points: LinePoint[] }) {
  const width = 560;
  const height = 160;
  const padding = 24;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (p.value / max) * (height - padding * 2);
    return { x, y, ...p };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padding} L ${coords[0].x.toFixed(1)} ${height - padding} Z`
      : "";

  const allZero = points.every((p) => p.value === 0);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Activity over the last 7 days"
      >
        <defs>
          <linearGradient id="analyticsLineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Baseline grid */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={padding}
            x2={width - padding}
            y1={padding + t * (height - padding * 2)}
            y2={padding + t * (height - padding * 2)}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
          />
        ))}
        {!allZero && <path d={areaPath} fill="url(#analyticsLineFill)" />}
        <path
          d={linePath}
          fill="none"
          stroke="#22d3ee"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={allZero ? 0.25 : 1}
        />
        {coords.map((c) => (
          <circle
            key={c.label}
            cx={c.x}
            cy={c.y}
            r={2.5}
            fill="#0d1020"
            stroke="#22d3ee"
            strokeWidth={1.5}
            opacity={allZero ? 0.35 : 1}
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
        {points.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
      {allZero && (
        <p className="mt-2 text-center text-xs text-zinc-500">
          No activity yet — send a message in Chat to see it here.
        </p>
      )}
    </div>
  );
}
