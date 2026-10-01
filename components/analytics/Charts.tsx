"use client";

/**
 * DashyCore — lightweight SVG chart kit for /analytics.
 *
 * Zero dependencies: glassmorphism-friendly line / bar / radial charts drawn
 * as plain SVG, measured with a ResizeObserver so text and strokes stay crisp
 * at every width (no preserveAspectRatio stretching). Neon look = gradient
 * strokes + a feGaussianBlur glow layer in Dashy Cyan / Electric Purple.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

export const DASHY_CYAN = "#22d3ee";
export const ELECTRIC_PURPLE = "#a855f7";
export const SOFT_PINK = "#f472b6";

/* ------------------------------------------------------------------------ */
/* Shared helpers                                                            */
/* ------------------------------------------------------------------------ */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** "Nice" axis maximum + tick step for small integer counts. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const step = Math.max(1, Math.round(niceStep));
  return { top: step * ticks, step };
}

/** Smooth monotone-ish path through points (Catmull-Rom → cubic Bézier). */
function smoothPath(points: Array<[number, number]>, floorY: number): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const t = 0.18;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = Math.min(floorY, p1[1] + (p2[1] - p0[1]) * t);
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = Math.min(floorY, p2[1] - (p3[1] - p1[1]) * t);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function Tooltip({
  x,
  width,
  title,
  rows,
}: {
  x: number;
  width: number;
  title: string;
  rows: Array<{ label: string; value: number; color: string }>;
}) {
  const boxWidth = 152;
  const left = Math.min(Math.max(x - boxWidth / 2, 0), Math.max(0, width - boxWidth));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 rounded-xl border border-white/10 bg-[#0b1020]/90 px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-md"
      style={{ left, width: boxWidth }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="mt-1 flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-zinc-300">
            <span className="h-2 w-2 rounded-full" style={{ background: row.color, boxShadow: `0 0 8px ${row.color}` }} />
            {row.label}
          </span>
          <span className="font-semibold tabular-nums text-white">{row.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Line chart                                                                 */
/* ------------------------------------------------------------------------ */

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  /** Filled glow area under the line. */
  area?: boolean;
  dashed?: boolean;
}

export function GlowLineChart({
  labels,
  longLabels,
  series,
  height = 240,
}: {
  labels: string[];
  longLabels?: string[];
  series: LineSeries[];
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 18, right: 14, bottom: 28, left: 34 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const { top, step } = niceScale(max);
  const n = labels.length;
  const xAt = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (v: number) => pad.top + innerH - (innerH * v) / top;
  const floorY = pad.top + innerH;

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = s.values.map((v, i) => [xAt(i), yAt(v)] as [number, number]);
        const line = smoothPath(pts, floorY);
        const area = pts.length
          ? `${line} L${pts[pts.length - 1][0]},${floorY} L${pts[0][0]},${floorY} Z`
          : "";
        return { line, area, pts };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, width, top, height]
  );

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (n === 0 || innerW <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - pad.left;
    const i = Math.round((x / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block touch-none select-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Line chart: ${series.map((s) => s.name).join(", ")}`}
        >
          <defs>
            <filter id={`glow-${uid}`} x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {series.map((s, i) => (
              <linearGradient key={s.name} id={`area-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid + y ticks */}
          {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray={tick === 0 ? undefined : "3 5"}
              />
              <text x={pad.left - 8} y={yAt(tick) + 3.5} textAnchor="end" className="fill-zinc-600 text-[10px] tabular-nums">
                {tick}
              </text>
            </g>
          ))}

          {/* X labels */}
          {labels.map((label, i) => (
            <text
              key={`${label}-${i}`}
              x={xAt(i)}
              y={height - 8}
              textAnchor="middle"
              className={`text-[10px] ${hover === i ? "fill-cyan-200" : "fill-zinc-500"}`}
            >
              {label}
            </text>
          ))}

          {/* Hover guide */}
          {hover !== null && (
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={pad.top}
              y2={floorY}
              stroke="rgba(34,211,238,0.35)"
              strokeDasharray="2 4"
            />
          )}

          {/* Areas, then glowing lines */}
          {series.map((s, i) =>
            s.area ? <path key={`a-${s.name}`} d={paths[i].area} fill={`url(#area-${uid}-${i})`} /> : null
          )}
          {series.map((s, i) => (
            <path
              key={`l-${s.name}`}
              d={paths[i].line}
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "6 6" : undefined}
              filter={`url(#glow-${uid})`}
              className="analytics-draw"
            />
          ))}

          {/* Points */}
          {series.map((s, i) =>
            paths[i].pts.map(([x, y], j) => (
              <circle
                key={`p-${s.name}-${j}`}
                cx={x}
                cy={y}
                r={hover === j ? 5 : j === n - 1 ? 3.5 : 0}
                fill="#0b1020"
                stroke={s.color}
                strokeWidth={2}
                style={{ filter: `drop-shadow(0 0 6px ${s.color})`, transition: "r 120ms ease" }}
              />
            ))
          )}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip
          x={xAt(hover)}
          width={width}
          title={longLabels?.[hover] ?? labels[hover]}
          rows={series.map((s) => ({ label: s.name, value: s.values[hover] ?? 0, color: s.color }))}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Bar chart                                                                  */
/* ------------------------------------------------------------------------ */

export function GlowBarChart({
  labels,
  longLabels,
  values,
  name = "Count",
  height = 220,
  from = DASHY_CYAN,
  to = ELECTRIC_PURPLE,
}: {
  labels: string[];
  longLabels?: string[];
  values: number[];
  name?: string;
  height?: number;
  from?: string;
  to?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 22, right: 8, bottom: 28, left: 30 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const { top, step } = niceScale(Math.max(0, ...values));
  const n = values.length;
  const slot = n ? innerW / n : 0;
  const barW = Math.min(38, slot * 0.56);
  const yAt = (v: number) => pad.top + innerH - (innerH * v) / top;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block select-none"
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Bar chart: ${name}`}
        >
          <defs>
            <linearGradient id={`bar-${uid}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={to} stopOpacity="0.85" />
              <stop offset="100%" stopColor={from} stopOpacity="1" />
            </linearGradient>
            <filter id={`bglow-${uid}`} x="-50%" y="-30%" width="200%" height="160%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray={tick === 0 ? undefined : "3 5"}
              />
              <text x={pad.left - 8} y={yAt(tick) + 3.5} textAnchor="end" className="fill-zinc-600 text-[10px] tabular-nums">
                {tick}
              </text>
            </g>
          ))}
          {values.map((value, i) => {
            const x = pad.left + slot * i + (slot - barW) / 2;
            const y = yAt(value);
            const h = Math.max(value > 0 ? 3 : 0, pad.top + innerH - y);
            const active = hover === i;
            return (
              <g key={i} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                <rect x={pad.left + slot * i} y={pad.top} width={slot} height={innerH} fill="transparent" />
                {value > 0 && (
                  <rect x={x} y={pad.top + innerH - h} width={barW} height={h} rx={7} fill={from} opacity={active ? 0.55 : 0.3} filter={`url(#bglow-${uid})`} />
                )}
                <rect
                  x={x}
                  y={pad.top + innerH - h}
                  width={barW}
                  height={h}
                  rx={7}
                  fill={`url(#bar-${uid})`}
                  opacity={hover === null || active ? 1 : 0.55}
                  className="analytics-grow"
                  style={{ animationDelay: `${i * 45}ms` }}
                />
                {value > 0 && (
                  <text x={x + barW / 2} y={pad.top + innerH - h - 6} textAnchor="middle" className="fill-zinc-300 text-[10px] font-semibold tabular-nums">
                    {value}
                  </text>
                )}
                <text
                  x={pad.left + slot * i + slot / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className={`text-[10px] ${active ? "fill-cyan-200" : "fill-zinc-500"}`}
                >
                  {labels[i]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip
          x={pad.left + slot * hover + slot / 2}
          width={width}
          title={longLabels?.[hover] ?? labels[hover]}
          rows={[{ label: name, value: values[hover] ?? 0, color: from }]}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Radial gauge                                                               */
/* ------------------------------------------------------------------------ */

export function RadialGauge({
  value,
  max,
  size = 200,
  label,
  sublabel,
}: {
  value: number;
  max: number;
  size?: number;
  label: string;
  sublabel?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const stroke = 14;
  const r = (size - stroke) / 2 - 8;
  const c = 2 * Math.PI * r;
  // 270° arc gauge, opening at the bottom.
  const arc = c * 0.75;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  const danger = pct >= 0.9;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${Math.round(pct * 100)}%`}>
        <defs>
          <linearGradient id={`gauge-${uid}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={DASHY_CYAN} />
            <stop offset="100%" stopColor={danger ? SOFT_PINK : ELECTRIC_PURPLE} />
          </linearGradient>
          <filter id={`gglow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${c}`}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#gauge-${uid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, arc * shown)} ${c}`}
            filter={`url(#gglow-${uid})`}
            style={{ transition: "stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1)" }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="bg-gradient-to-br from-cyan-200 to-violet-300 bg-clip-text text-4xl font-bold tabular-nums text-transparent">
          {Math.round(pct * 100)}%
        </span>
        <span className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">{label}</span>
        {sublabel && <span className="mt-1 text-xs tabular-nums text-zinc-400">{sublabel}</span>}
      </div>
    </div>
  );
}

/** Mini sparkline for stat cards. */
export function Sparkline({ values, color, width = 96, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => [n <= 1 ? width / 2 : (width * i) / (n - 1), height - 3 - ((height - 6) * v) / max] as [number, number]);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={smoothPath(pts, height)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}
