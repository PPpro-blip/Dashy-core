"use client";

/**
 * DashyCore v7 — workspace memory documents list.
 *
 * Lists documents from the Supabase `documents` table (RAG memory) with
 * per-row delete. Shared by the /knowledge page and the settings Memory
 * section. `reloadKey` lets parents trigger a reload (e.g. after an upload).
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import {
  FileTextIcon,
  ImageIcon,
  LoaderIcon,
  TrashIcon,
} from "@/components/icons";

export interface DocumentRow {
  id: string;
  title: string | null;
  source_type: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

function sourceIcon(sourceType: string | null) {
  if (sourceType === "pdf") return { Icon: FileTextIcon, label: "PDF" };
  if (sourceType === "image") return { Icon: ImageIcon, label: "Image" };
  if (sourceType === "markdown") return { Icon: FileTextIcon, label: "Markdown" };
  return { Icon: FileTextIcon, label: "Text" };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DocumentsList({ reloadKey = 0 }: { reloadKey?: number }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useToast();

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, source_type, source, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setDocuments((data as DocumentRow[]) ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load documents.";
      toast.error("Could not load your memory", message);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments, reloadKey]);

  const handleDeleteDocument = async (document: DocumentRow) => {
    if (deletingId) return;
    setDeletingId(document.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("documents").delete().eq("id", document.id);
      if (error) throw error;
      setDocuments((prev) => prev.filter((d) => d.id !== document.id));
      toast.success(
        "Document deleted",
        `${document.title ?? "Untitled document"} was removed from memory.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed.";
      toast.error("Delete failed", message);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
        <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
        Loading your documents…
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] bg-black/20 px-4 py-8 text-center">
        <p className="text-sm text-zinc-400">No documents yet</p>
        <p className="mt-1 text-xs text-zinc-600">
          Upload a PDF, TXT, MD, PNG or JPG and it will show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
      {documents.map((document) => {
        const { Icon, label } = sourceIcon(document.source_type);
        return (
          <li
            key={document.id}
            className="flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-zinc-900/50"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-400">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-200">
                {document.title ?? "Untitled document"}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {label} · indexed {formatDate(document.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleDeleteDocument(document)}
              disabled={deletingId !== null}
              title="Delete document from memory"
              aria-label={`Delete ${document.title ?? "document"}`}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingId === document.id ? (
                <LoaderIcon className="h-3 w-3 animate-spin" />
              ) : (
                <TrashIcon className="h-3 w-3" />
              )}
              {deletingId === document.id ? "Deleting…" : "Delete"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
