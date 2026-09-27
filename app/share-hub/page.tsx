"use client";

import { useMemo, useState } from "react";
import {
  AlertIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  InfoIcon,
  LockIcon,
  PenIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  ShareIcon,
  SparklesIcon,
} from "@/components/icons";
import {
  SHARE_PROVIDERS,
  modeLabel,
  providerById,
  type ShareProviderId,
} from "@/lib/share-providers";

const initialCaption = "Built this project with DashyCore + D-Code. A focused workspace for turning ideas into something real.";

function ModeBadge({ mode }: { mode: "direct" | "handoff" | "unavailable" }) {
  const styles = mode === "handoff" ? "border-amber-400/20 bg-amber-400/10 text-amber-300" : mode === "direct" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/[.04] text-zinc-400";
  return <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[.08em] ${styles}`}>{modeLabel(mode)}</span>;
}

export default function ShareHubPage() {
  const [selected, setSelected] = useState<ShareProviderId[]>(["x", "linkedin", "whatsapp"]);
  const [active, setActive] = useState<ShareProviderId>("x");
  const [caption, setCaption] = useState(initialCaption);
  const [variants, setVariants] = useState<Partial<Record<ShareProviderId, string>>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = providerById(active);
  const currentCopy = variants[active] ?? caption;
  const toggle = (id: ShareProviderId) => {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  };
  const updateCurrent = (value: string) => setVariants((all) => ({ ...all, [active]: value }));
  const characterCount = currentCopy.length;
  const overLimit = current.textLimit !== undefined && characterCount > current.textLimit;
  const selectedProviders = useMemo(() => SHARE_PROVIDERS.filter((p) => selected.includes(p.id)), [selected]);

  const generateSuggestion = () => {
    const suggestion = active === "linkedin"
      ? "A closer look at how we turn an idea into a shipped project with DashyCore and D-Code. Built for thoughtful iteration, clear previews, and momentum."
      : active === "x"
        ? "Built this with DashyCore + D-Code. One workspace from first idea to live preview."
        : "Built this project with DashyCore + D-Code. #DashyCore #DCode #WebDevelopment";
    updateCurrent(suggestion);
    setNotice("AI suggestion added — make it yours before publishing.");
  };

  return (
    <div className="min-h-full bg-grid">
      <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-300/80"><ShareIcon className="h-3.5 w-3.5" /> Publishing cockpit</div>
            <h1 className="text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">Share Hub</h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">Prepare once, tailor each channel, and stay in control of what leaves DashyCore.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[.05] px-3 py-2 text-xs text-emerald-300"><LockIcon className="h-3.5 w-3.5" /> Nothing publishes without your confirmation</div>
        </div>

        {notice && <div className="mb-5 flex items-center justify-between rounded-xl border border-cyan-400/20 bg-cyan-400/[.07] px-4 py-3 text-sm text-cyan-100"><span>{notice}</span><button className="text-cyan-300" onClick={() => setNotice(null)}>Dismiss</button></div>}

        <section className="mb-6 rounded-2xl border border-white/[.08] bg-[#11152b]/80 p-5 shadow-2xl shadow-black/10 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-zinc-500">01 / Select channels</p><h2 className="mt-1 text-lg font-semibold text-white">Where do you want to share?</h2></div>
            <span className="text-xs text-zinc-500">{selected.length} selected</span>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {SHARE_PROVIDERS.map((provider) => { const isSelected = selected.includes(provider.id); return <button key={provider.id} type="button" onClick={() => { toggle(provider.id); setActive(provider.id); }} className={`group rounded-xl border p-4 text-left transition-all ${isSelected ? "border-cyan-400/45 bg-cyan-400/[.07]" : "border-white/[.07] bg-white/[.02] hover:border-white/20"}`}>
              <div className="mb-4 flex items-start justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[.05] text-sm font-bold" style={{ color: provider.accent }}>{provider.icon}</span><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? "border-cyan-300 bg-cyan-300 text-[#09131b]" : "border-white/15 text-transparent"}`}><CheckIcon className="h-3 w-3" /></span></div>
              <p className="font-medium text-zinc-100">{provider.name}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{provider.description}</p><div className="mt-3"><ModeBadge mode={provider.mode} /></div>
            </button>; })}
          </div>
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="rounded-2xl border border-white/[.08] bg-[#11152b]/80 p-5 sm:p-6">
            <div className="mb-6 flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-zinc-500">02 / Compose</p><h2 className="mt-1 text-lg font-semibold text-white">Master content</h2></div><button type="button" onClick={() => { setCaption(initialCaption); setVariants({}); }} className="text-xs text-zinc-500 hover:text-zinc-200">Reset</button></div>
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300"><CodeMark /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-zinc-100">D-Code project · Untitled project</p><p className="truncate text-xs text-zinc-500">Source reference · preview link available after project is shared</p></div><button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[.05]">Change</button></div>
            <label className="mb-2 block text-xs font-medium text-zinc-300">Caption</label><textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} className="w-full resize-y rounded-xl border border-white/[.09] bg-[#0b0f21] p-4 text-sm leading-6 text-zinc-100 outline-none transition focus:border-cyan-400/50" placeholder="Tell your audience what you made…" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-zinc-600">Master copy is a starting point. Every platform version stays editable.</span><button type="button" onClick={generateSuggestion} className="flex items-center gap-1.5 text-xs font-medium text-cyan-300 hover:text-cyan-200"><SparklesIcon className="h-3.5 w-3.5" /> Generate caption</button></div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-xs font-medium text-zinc-300">Hashtags</label><input defaultValue="#DashyCore #DCode #AI" className="w-full rounded-xl border border-white/[.09] bg-[#0b0f21] px-3.5 py-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/50" /></div><div><label className="mb-2 block text-xs font-medium text-zinc-300">Project URL</label><input placeholder="https://…" className="w-full rounded-xl border border-white/[.09] bg-[#0b0f21] px-3.5 py-3 text-sm text-zinc-500 outline-none focus:border-cyan-400/50" /></div></div>
            <div className="mt-6 flex items-center justify-between border-t border-white/[.07] pt-5"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[.025] text-zinc-600"><ImageIcon className="h-5 w-5" /></div><div><p className="text-sm text-zinc-300">No media attached</p><p className="text-xs text-zinc-600">Studio, upload, or project screenshot</p></div></div><button className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[.05]"><PlusIcon className="h-3.5 w-3.5" /> Attach media</button></div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-white/[.08] bg-[#11152b]/80 p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-zinc-500">03 / Customize</p><h2 className="mt-1 text-lg font-semibold text-white">Platform versions</h2></div><button title="Copy master to all" onClick={() => setVariants(Object.fromEntries(selected.map((id) => [id, caption])))} className="text-xs text-cyan-300 hover:text-cyan-200">Copy master to all</button></div>
              <div className="mb-4 flex gap-1 overflow-x-auto border-b border-white/[.07]">{selectedProviders.map((provider) => <button key={provider.id} type="button" onClick={() => setActive(provider.id)} className={`whitespace-nowrap border-b-2 px-2 pb-2 text-xs font-medium ${active === provider.id ? "border-cyan-400 text-cyan-300" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}>{provider.shortName}</button>)}</div>
              <div className="mb-3 flex items-center justify-between"><span className="text-xs text-zinc-400">{current.name} copy</span><span className={`text-[11px] ${overLimit ? "text-red-300" : "text-zinc-600"}`}>{characterCount}{current.textLimit ? ` / ${current.textLimit}` : " characters"}</span></div>
              <textarea value={currentCopy} onChange={(e) => updateCurrent(e.target.value)} rows={6} className="w-full resize-y rounded-xl border border-white/[.09] bg-[#0b0f21] p-3 text-sm leading-6 text-zinc-100 outline-none focus:border-cyan-400/50" />
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-400/[.06] p-3 text-xs leading-5 text-amber-200/80"><AlertIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{current.warning ?? "This provider is ready for direct publishing after connection."}</div>
            </section>
            <section className="rounded-2xl border border-white/[.08] bg-[#11152b]/80 p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-zinc-500">04 / Preview</p><h2 className="mt-1 text-lg font-semibold text-white">Review {current.name}</h2></div><PenIcon className="h-4 w-4 text-zinc-600" /></div><div className="rounded-xl border border-white/[.08] bg-[#0b0f21] p-4"><div className="mb-4 flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-bold text-cyan-300">D</span><div><p className="text-xs font-medium text-zinc-200">DashyCore</p><p className="text-[10px] text-zinc-600">Just now · {current.name}</p></div></div><p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">{currentCopy || "Your post preview will appear here."}</p><div className="mt-4 flex gap-4 border-t border-white/[.06] pt-3 text-[10px] uppercase tracking-wider text-zinc-600"><span>Text</span><span>{current.supportedMedia.includes("url") ? "Link ready" : "No link"}</span></div></div></section>
          </aside>
        </div>

        <section className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/[.04] p-5 sm:flex sm:items-center sm:justify-between sm:gap-5"><div className="flex gap-3"><InfoIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300" /><div><p className="text-sm font-medium text-amber-100">Review before external action</p><p className="mt-1 text-xs leading-5 text-amber-100/60">Some channels are currently handoffs or unavailable. Dashy will never label a handoff “Published”, and nothing leaves this workspace without your explicit approval.</p></div></div><div className="mt-4 flex flex-shrink-0 gap-2 sm:mt-0"><button onClick={() => { setSaved(true); setNotice("Draft prepared locally for this session. Persistence is not connected yet."); }} className="rounded-lg border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-300 hover:bg-white/[.05]">{saved ? "Draft prepared" : "Save draft"}</button><button disabled={selected.length === 0 || overLimit} onClick={() => setShowConfirm(true)} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-[#06202a] shadow-lg shadow-cyan-400/15 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"><SendIcon className="h-3.5 w-3.5" /> Review & continue</button></div></section>

        {showConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#151a35] p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-300">Final review</p><h2 className="mt-2 text-xl font-semibold text-white">You're about to continue to</h2></div><button onClick={() => setShowConfirm(false)} className="text-zinc-500 hover:text-white">×</button></div><div className="mb-5 space-y-2">{selectedProviders.map((provider) => <div key={provider.id} className="flex items-center justify-between rounded-lg border border-white/[.07] bg-white/[.025] px-3 py-2.5"><span className="text-sm text-zinc-200">{provider.name}</span><ModeBadge mode={provider.mode} /></div>)}</div><p className="mb-5 text-xs leading-5 text-zinc-500">This is an explicit user checkpoint. Direct publishing adapters are not connected in this build; handoffs will open the platform and unavailable providers will remain untouched.</p><div className="flex justify-end gap-2"><button onClick={() => setShowConfirm(false)} className="rounded-lg border border-white/10 px-4 py-2.5 text-xs text-zinc-300">Go back</button><button onClick={() => { setShowConfirm(false); setNotice("Review confirmed. Provider adapters are awaiting secure server-side connections."); }} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-[#06202a]"><CheckIcon className="h-3.5 w-3.5" /> Confirm review</button></div></div></div>}
      </div>
    </div>
  );
}

function CodeMark() { return <span className="font-mono text-sm">&lt;/&gt;</span>; }
