"use client";

import { useEffect, useMemo, useState } from "react";
import { listConversationsAsync, type Conversation } from "@/lib/conversations";
import { listProjects, type DCodeProject } from "@/lib/dcode";

const DAY = 86_400_000;
function dayKey(date: Date) { return date.toISOString().slice(0, 10); }

export default function AnalyticsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<DCodeProject[]>([]);
  const [range, setRange] = useState<7 | 30>(7);

  useEffect(() => {
    void Promise.all([listConversationsAsync(), listProjects()]).then(([chats, workspaces]) => {
      setConversations(chats); setProjects(workspaces);
    }).catch(() => { setConversations([]); setProjects([]); });
  }, []);

  const points = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: range }, (_, index) => {
      const date = new Date(today.getTime() - (range - 1 - index) * DAY);
      const key = dayKey(date);
      return { key, label: date.toLocaleDateString(undefined, { weekday: "short" }),
        value: conversations.filter((conversation) => dayKey(new Date(conversation.createdAt)) === key).length };
    });
  }, [conversations, range]);
  const max = Math.max(1, ...points.map((point) => point.value));
  const width = 760, height = 230;
  const polyline = points.map((point, index) => `${(index / Math.max(1, points.length - 1)) * width},${height - (point.value / max) * 190 - 10}`).join(" ");

  return <div className="mx-auto w-full max-w-5xl px-6 py-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-white">Analytics</h1><p className="mt-1 text-sm text-zinc-500">Workspace activity from Supabase timestamps.</p></div>
      <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-1 text-xs"><button onClick={() => setRange(7)} className={`rounded-md px-3 py-1.5 ${range === 7 ? "bg-cyan-500/15 text-cyan-300" : "text-zinc-500"}`}>Last 7 Days</button><button onClick={() => setRange(30)} className={`rounded-md px-3 py-1.5 ${range === 30 ? "bg-violet-500/15 text-violet-300" : "text-zinc-500"}`}>Last 30 Days</button></div>
    </div>
    <div className="mt-7 grid gap-4 sm:grid-cols-3"><Metric label="Conversations" value={conversations.length} color="text-cyan-300" /><Metric label="Projects" value={projects.length} color="text-violet-300" /><Metric label="Active days" value={points.filter((point) => point.value > 0).length} color="text-cyan-300" /></div>
    <section className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-zinc-200">Conversation activity</h2><p className="mt-1 text-xs text-zinc-500">Filtered by each conversation&apos;s created_at timestamp</p></div><span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee]" /></div><div className="mt-5 overflow-x-auto"><svg viewBox={`0 0 ${width} ${height + 25}`} className="h-64 min-w-[620px] w-full" role="img" aria-label="Conversation activity chart"><defs><linearGradient id="dashyLine" x1="0" x2="1"><stop stopColor="#22d3ee" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs><line x1="0" y1={height - 10} x2={width} y2={height - 10} stroke="#272c49" /><polyline fill="none" stroke="url(#dashyLine)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={polyline} style={{ filter: "drop-shadow(0 0 7px rgba(34,211,238,.65))" }} />{points.map((point, index) => <circle key={point.key} cx={(index / Math.max(1, points.length - 1)) * width} cy={height - (point.value / max) * 190 - 10} r="4" fill="#22d3ee" />)}{points.map((point, index) => <text key={`${point.key}-label`} x={(index / Math.max(1, points.length - 1)) * width} y={height + 12} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fill="#71789a" fontSize="11">{point.label}</text>)}</svg></div>{conversations.length === 0 && <p className="text-center text-xs text-zinc-600">No activity yet — your chart will populate as you work.</p>}</section>
  </div>;
}
function Metric({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"><p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p><p className={`mt-2 text-3xl font-semibold ${color}`}>{value}</p></div>; }
