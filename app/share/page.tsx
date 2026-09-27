"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getProject, listProjects, type DCodeProject } from "@/lib/dcode";
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  FolderIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  LockIcon,
  PenIcon,
  ShareIcon,
  SparklesIcon,
} from "@/components/icons";

type PlatformId = "x" | "linkedin" | "instagram" | "facebook" | "whatsapp";
type Source = { type: "dcode_project"; id: string; title: string; project: DCodeProject };

const platforms: Array<{ id: PlatformId; name: string; mark: string; mode: "handoff" | "unavailable" }> = [
  { id: "x", name: "X", mark: "𝕏", mode: "handoff" },
  { id: "linkedin", name: "LinkedIn", mark: "in", mode: "handoff" },
  { id: "instagram", name: "Instagram", mark: "◎", mode: "unavailable" },
  { id: "facebook", name: "Facebook", mark: "f", mode: "unavailable" },
  { id: "whatsapp", name: "WhatsApp", mark: "◔", mode: "handoff" },
];

function projectSource(project: DCodeProject): Source {
  return { type: "dcode_project", id: project.id, title: project.title, project };
}

export default function SharePage() {
  const params = useSearchParams();
  const sourceId = params.get("sourceId");
  const [projects, setProjects] = useState<DCodeProject[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(Boolean(sourceId));
  const [sourcePicker, setSourcePicker] = useState(!sourceId);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlatformId[]>(["x", "linkedin"]);
  const [caption, setCaption] = useState("Just shipped my new D-Code project.");
  const [tags, setTags] = useState("#DCode #DashyCore");
  const [variants, setVariants] = useState<Record<PlatformId, string>>({
    x: "Just shipped my new D-Code project. #DCode #DashyCore",
    linkedin: "I’m excited to share a new D-Code project built with DashyCore. #DCode #DashyCore",
    instagram: "New project, fresh build. ✨ #DCode #DashyCore",
    facebook: "I just shipped a new D-Code project with DashyCore.",
    whatsapp: "Take a look at my new D-Code project: DashyCore",
  });
  const [activePreview, setActivePreview] = useState<PlatformId>("x");
  const [prepared, setPrepared] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const rows = await listProjects();
      setProjects(rows);
      if (sourceId) {
        // This lookup is intentionally ownership-scoped by the existing Supabase RLS policy.
        const project = await getProject(sourceId);
        if (!project) throw new Error("This project is unavailable or you no longer have access to it.");
        setSource(projectSource(project));
        setCaption(`Just shipped my new ${project.title} project.`);
        setVariants((prev) => ({ ...prev, x: `Just shipped my new ${project.title} project. #DCode #DashyCore` }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load shareable sources.");
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const media = useMemo(() => source?.project.files.filter((file) => /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) ?? [], [source]);
  const chooseSource = (project: DCodeProject) => {
    setSource(projectSource(project));
    setSourcePicker(false);
    setPrepared(false);
    setCaption(`Just shipped my new ${project.title} project.`);
  };
  const togglePlatform = (id: PlatformId) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const updateVariant = (id: PlatformId, value: string) => setVariants((current) => ({ ...current, [id]: value }));

  if (loading) return <div className="flex h-[calc(100vh-4rem)] items-center justify-center gap-2 text-sm text-zinc-500"><LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" /> Loading your share context…</div>;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400"><ShareIcon className="h-4 w-4" /> Publishing cockpit</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Share Hub</h1>
          <p className="mt-1 text-sm text-zinc-500">One source, one draft, platform-aware handoffs.</p>
        </div>
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">No direct provider publishing is connected yet. Nothing is published automatically.</div>
      </div>

      {error && <div role="alert" className="mt-6 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200"><AlertIcon className="h-4 w-4" /> {error}</div>}

      {sourcePicker ? (
        <section className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6">
          <p className="text-sm font-medium text-zinc-200">Choose something to share</p>
          <p className="mt-1 text-xs text-zinc-500">Only sources currently available in DashyCore are shown.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => <button key={project.id} type="button" onClick={() => chooseSource(project)} className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-4 text-left transition hover:border-cyan-400/35 hover:bg-cyan-400/[0.05]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300"><CodeIcon className="h-5 w-5" /></span><span className="min-w-0"><span className="block truncate text-sm font-medium text-zinc-100">{project.title}</span><span className="mt-0.5 block text-xs text-zinc-500">D-Code Project · {project.files.length} files</span></span></button>)}
          </div>
          {projects.length === 0 && <p className="mt-5 rounded-xl border border-dashed border-white/[0.1] p-5 text-center text-sm text-zinc-500">No D-Code projects are available to share yet.</p>}
        </section>
      ) : source ? (
        <>
          <section className="mt-8 rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.08] to-white/[0.02] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300"><FolderIcon className="h-5 w-5" /></span><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Sharing</p><p className="mt-1 text-lg font-semibold text-white">{source.title}</p><p className="text-xs text-zinc-400">D-Code Project · current project state</p></div></div><button type="button" onClick={() => setSourcePicker(true)} className="rounded-lg border border-white/[0.1] bg-black/20 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-cyan-400/30 hover:text-white">Change source</button></div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500"><span className="rounded-md border border-white/[0.08] px-2 py-1">{source.project.files.length} files</span><span className="rounded-md border border-white/[0.08] px-2 py-1">{source.project.language}</span><Link href={`/d-code/${source.id}`} className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-cyan-300 hover:text-cyan-200"><LinkIcon className="h-3 w-3" /> Open source</Link></div>
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
            <main className="space-y-5">
              <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-white">Master composer</h2><p className="mt-1 text-xs text-zinc-500">Edit the source message before creating platform variants.</p></div><SparklesIcon className="h-5 w-5 text-cyan-400" /></div><label className="mt-5 block text-xs font-medium text-zinc-400">Master caption<textarea value={caption} onChange={(event) => { setCaption(event.target.value); setPrepared(false); }} rows={4} className="mt-2 w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 p-3 text-sm leading-relaxed text-zinc-100 outline-none focus:border-cyan-400/40" /></label><label className="mt-4 block text-xs font-medium text-zinc-400">Hashtags / tags<input value={tags} onChange={(event) => setTags(event.target.value)} className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-400/40" /></label><div className="mt-4 flex flex-wrap gap-2">{media.length ? media.map((file) => <span key={file.id} className="flex items-center gap-1.5 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/[0.06] px-2.5 py-1.5 text-xs text-fuchsia-200"><ImageIcon className="h-3.5 w-3.5" />{file.name}</span>) : <span className="text-xs text-zinc-500">No image asset attached. The project source will be used.</span>}</div></section>
              <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><h2 className="text-sm font-semibold text-white">Platform variants</h2><p className="mt-1 text-xs text-zinc-500">Every final copy is editable. Suggestions never publish on their own.</p><div className="mt-4 space-y-3">{selected.map((id) => { const platform = platforms.find((item) => item.id === id)!; return <div key={id}><label className="flex items-center justify-between text-xs font-medium text-zinc-400"><span>{platform.name} copy</span><span className="text-[10px] text-zinc-600">{variants[id].length} chars</span></label><textarea value={variants[id]} onChange={(event) => updateVariant(id, event.target.value)} rows={2} className="mt-1.5 w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 p-3 text-sm text-zinc-100 outline-none focus:border-cyan-400/40" /></div> })}</div></section>
            </main>
            <aside className="space-y-5"><section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><h2 className="text-sm font-semibold text-white">Platforms</h2><div className="mt-4 space-y-2">{platforms.map((platform) => <button key={platform.id} type="button" onClick={() => togglePlatform(platform.id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected.includes(platform.id) ? "border-cyan-400/30 bg-cyan-400/[0.07]" : "border-white/[0.07] bg-black/10 hover:border-white/[0.15]"}`}><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] text-xs font-bold text-zinc-200">{platform.mark}</span><span className="min-w-0 flex-1"><span className="block text-sm text-zinc-200">{platform.name}</span><span className="mt-0.5 block text-[11px] text-zinc-500">{platform.mode === "handoff" ? "↗ Continue on platform" : "⚠ Direct publishing unavailable"}</span></span>{selected.includes(platform.id) && <CheckIcon className="h-4 w-4 text-cyan-300" />}</button>)}</div></section>
              <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Preview</h2><PenIcon className="h-4 w-4 text-zinc-500" /></div><div className="mt-3 flex flex-wrap gap-1.5">{selected.map((id) => <button key={id} type="button" onClick={() => setActivePreview(id)} className={`rounded-lg px-2.5 py-1.5 text-xs ${activePreview === id ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-300"}`}>{platforms.find((p) => p.id === id)?.name}</button>)}</div><div className="mt-3 rounded-xl border border-white/[0.08] bg-black/20 p-4"><p className="text-xs font-medium text-zinc-300">{platforms.find((p) => p.id === activePreview)?.name ?? "Platform"}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{variants[activePreview]}</p><p className="mt-4 text-[11px] text-zinc-600">Preview only · no publication has occurred</p></div></section>
              <button type="button" onClick={() => setPrepared(true)} disabled={!selected.length} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40">{prepared ? <CheckIcon className="h-4 w-4" /> : <SparklesIcon className="h-4 w-4" />}{prepared ? "Draft ready for review" : "Prepare share draft"}</button>
              {prepared && <p className="text-center text-xs leading-relaxed text-zinc-500">Draft prepared locally for review. External publishing requires a verified provider connection and explicit confirmation.</p>}
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
