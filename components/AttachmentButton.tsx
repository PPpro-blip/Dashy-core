"use client";

/**
 * DashyCore v7 — document / screenshot attachment button.
 *
 * Opens a file picker (PDF, TXT, MD, PNG, JPG) and uploads the raw file to
 * the `dashy-digest` worker via multipart FormData:
 *
 *   POST https://dashy-digest.kamleshprathampandey.workers.dev
 *   FormData: { file, userId, filename }
 *
 * Progress is surfaced through the toast system:
 *   info "Uploading …" → success "Document indexed to memory ✓" (or error).
 */

import { useRef, useState } from "react";
import { DASHY_DIGEST_URL } from "@/lib/chat-client";
import { useToast } from "@/components/Toast";
import { LoaderIcon, PaperclipIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

const ACCEPT =
  "application/pdf,.pdf,text/plain,.txt,text/markdown,text/x-markdown,.md,.markdown,image/png,.png,image/jpeg,.jpg,.jpeg";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

function sourceTypeFor(file: File): string {
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.includes("markdown") || file.name.match(/\.(md|markdown)$/i)) {
    return "markdown";
  }
  return "text";
}

function isSupported(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "text/x-markdown" ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    /\.(pdf|txt|md|markdown|png|jpe?g)$/i.test(file.name)
  );
}

interface AttachmentButtonProps {
  userId?: string | null;
  disabled?: boolean;
  className?: string;
  /** Called after a successful ingest. */
  onUploaded?: (info: { filename: string; documentId?: string }) => void;
}

export function AttachmentButton({
  userId,
  disabled = false,
  className = "",
  onUploaded,
}: AttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const openPicker = () => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  const handleFiles = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    // Reset so re-selecting the same file re-triggers change.
    if (inputRef.current) inputRef.current.value = "";

    if (!isSupported(file)) {
      toast.error(
        "Unsupported file type",
        "Supported: PDF, TXT, MD, PNG and JPG."
      );
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      toast.error("File too large", "Maximum upload size is 15 MB.");
      return;
    }

    let uploadUserId = userId ?? null;
    let token: string | undefined;

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      token = session?.access_token;
      if (!uploadUserId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        uploadUserId = user?.id ?? null;
      }
    } catch {
      // Auth lookup is best-effort — the worker validates the token anyway.
    }

    if (!token) {
      toast.error(
        "Not signed in",
        "Please sign in again before uploading documents."
      );
      return;
    }

    setUploading(true);
    const toastId = toast.info(
      `Uploading ${file.name}…`,
      `${sourceTypeFor(file).toUpperCase()} · sending to dashy-digest`,
      0
    );

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("filename", file.name);
      formData.append("sourceType", sourceTypeFor(file));
      if (uploadUserId) formData.append("userId", uploadUserId);

      const response = await fetch(DASHY_DIGEST_URL.replace(/\/$/, ""), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      let payload: Record<string, unknown> = {};
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch {
        // Non-JSON response body — status code still tells the story.
      }

      if (!response.ok) {
        const message =
          typeof payload.error === "string" && payload.error.length > 0
            ? payload.error
            : `Upload failed (HTTP ${response.status})`;
        throw new Error(message);
      }

      const documentId =
        typeof payload.documentId === "string" ? payload.documentId : undefined;
      toast.update(toastId, {
        type: "success",
        title: "Document indexed to memory ✓",
        message: `${file.name} is now searchable in your workspace.`,
      });
      onUploaded?.({ filename: file.name, documentId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      toast.update(toastId, {
        type: "error",
        title: "Upload failed",
        message: message.length > 160 ? `${message.slice(0, 157)}…` : message,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled || uploading}
        title="Attach PDF, TXT, MD, PNG or JPG — indexes to workspace memory"
        aria-label="Attach a document or screenshot"
        className={`inline-flex items-center justify-center rounded-md text-zinc-500 transition-all hover:bg-white/[0.06] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        {uploading ? (
          <LoaderIcon className="h-4 w-4 animate-spin" />
        ) : (
          <PaperclipIcon className="h-4 w-4" />
        )}
      </button>
    </>
  );
}
