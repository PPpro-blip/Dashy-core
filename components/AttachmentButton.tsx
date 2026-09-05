"use client";

/**
 * DashyCore v7 — document / screenshot attachment button.
 *
 * Opens a file picker (PDF, TXT, MD, PNG, JPG) and hands the raw file to the
 * shared digest client (`lib/digest-client`), which owns the wire contract:
 *
 *   POST https://dashy-digest.kamleshprathampandey.workers.dev
 *   Authorization: Bearer <supabase access token>
 *   FormData: { file, filename, sourceType, userId }
 *
 * The Supabase user id is resolved from the live session BEFORE the request
 * is sent, so the worker never receives an upload without `userId`. Signed-out
 * visitors get "Please log in to upload files." and the worker is not called.
 *
 * Progress is surfaced through the toast system:
 *   info "Uploading …" → success "Document indexed to memory ✓" (or error).
 */

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { LoaderIcon, PaperclipIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import {
  DIGEST_LOGIN_REQUIRED_MESSAGE,
  type DigestIdentity,
  DigestUploadError,
  digestSourceTypeFor,
  resolveDigestIdentity,
  uploadFileToDigest,
} from "@/lib/digest-client";

const ACCEPT =
  "application/pdf,.pdf,text/plain,.txt,text/markdown,text/x-markdown,.md,.markdown,image/png,.png,image/jpeg,.jpg,.jpeg";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

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
  /**
   * Optional pre-loaded Supabase user id (e.g. the chat page already holds
   * one). Only a fallback — the live session is always consulted first.
   */
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

  /**
   * Warm identity cache. The Knowledge page renders this button immediately,
   * before the Supabase browser client has hydrated its session from cookies.
   * Subscribing to auth state keeps a verified { userId, accessToken } ready
   * (and refreshed on TOKEN_REFRESHED / SIGNED_IN) so a click never races the
   * hydration and never reaches the worker without a userId.
   */
  const identityRef = useRef<DigestIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;

    const remember = (identity: DigestIdentity | null) => {
      if (!cancelled && identity) identityRef.current = identity;
    };

    // Initial hydration (retries internally while the session settles).
    void resolveDigestIdentity(userId).then(remember);

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        identityRef.current = null;
        return;
      }
      const nextUserId = session?.user?.id ?? null;
      const nextToken = session?.access_token ?? null;
      if (nextUserId && nextToken) {
        identityRef.current = { userId: nextUserId, accessToken: nextToken };
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [userId]);

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

    // Resolve the Supabase identity FIRST — a signed-out visitor must get a
    // clean login message instead of the worker's "userId is required".
    // Always re-consult the live session first (it auto-refreshes an expired
    // token); fall back to the warm cache only if that momentarily fails.
    const identity =
      (await resolveDigestIdentity(userId)) ?? identityRef.current;
    if (!identity?.userId || !identity.accessToken) {
      toast.error("Sign in required", DIGEST_LOGIN_REQUIRED_MESSAGE);
      return;
    }

    setUploading(true);
    const toastId = toast.info(
      `Uploading ${file.name}…`,
      `${digestSourceTypeFor(file).toUpperCase()} · sending to dashy-digest`,
      0
    );

    try {
      const { documentId } = await uploadFileToDigest({ file, identity });

      toast.update(toastId, {
        type: "success",
        title: "Document indexed to memory ✓",
        message: `${file.name} is now searchable in your workspace.`,
      });
      onUploaded?.({ filename: file.name, documentId });
    } catch (err) {
      console.error("CRITICAL UPLOAD ERROR:", err);
      const isAuthError =
        err instanceof DigestUploadError && err.kind === "unauthenticated";
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast.update(toastId, {
        type: "error",
        title: isAuthError ? "Sign in required" : "Upload failed",
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
