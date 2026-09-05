"use client";

/**
 * DashyCore v7 — document / screenshot attachment button.
 *
 * Opens a file picker (PDF, TXT, MD, PNG, JPG) and hands the raw file to the
 * shared digest client (`lib/digest-client`), which posts SAME-ORIGIN to the
 * server-side upload proxy:
 *
 *   POST /api/digest/upload          (credentials: "include")
 *   FormData: { file, filename, sourceType, origin }
 *
 * The proxy (`app/api/digest/upload/route.ts`) resolves the Supabase user from
 * the httpOnly auth cookies and forwards the file to the `dashy-digest` worker
 * with a server-injected `userId`. This component therefore never reads,
 * caches or attaches a userId or an access token — the server is the only
 * source of identity, which is what makes "userId is required" impossible.
 *
 * The client-side session check below is a nicety only (STEP 4 precheck): it
 * disables the control for signed-out visitors. The server re-verifies on
 * every request and answers 401 with "Please log in to upload files.".
 *
 * Progress is surfaced through the toast system:
 *   info "Uploading …" → success "Document indexed to memory ✓" (or error).
 */

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { LoaderIcon, PaperclipIcon } from "@/components/icons";
import {
  DIGEST_LOGIN_REQUIRED_MESSAGE,
  DigestOrigin,
  DigestUploadError,
  digestSourceTypeFor,
  uploadToDigest,
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
   * Advisory only: a user id the host page already loaded. It is NEVER sent
   * anywhere — the upload proxy resolves identity from the auth cookies.
   */
  userId?: string | null;
  /** Surface that owns this control; forwarded as upload metadata. */
  origin?: DigestOrigin;
  disabled?: boolean;
  className?: string;
  /** Called after a successful ingest. */
  onUploaded?: (info: { filename: string; documentId?: string }) => void;
}

export function AttachmentButton({
  userId,
  origin,
  disabled = false,
  className = "",
  onUploaded,
}: AttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  /** `null` = not checked yet (stay enabled so we never block a real user). */
  const [signedIn, setSignedIn] = useState<boolean | null>(
    userId ? true : null
  );
  const toast = useToast();

  /**
   * Precheck only: track whether a Supabase session exists so the control can
   * be disabled for signed-out visitors. Any failure to determine the state
   * leaves the button enabled — the server route is the source of truth and
   * answers 401 with a clean login message.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { hasDigestSession } = await import("@/lib/digest-client");
      if (!cancelled) setSignedIn(await hasDigestSession());
    })();

    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const {
        data: { subscription },
      } = createClient().auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (event === "SIGNED_OUT") {
          setSignedIn(false);
          return;
        }
        if (session?.user?.id) setSignedIn(true);
      });
      unsubscribe = () => subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signedOut = signedIn === false;
  const isDisabled = disabled || uploading || signedOut;

  const openPicker = () => {
    if (disabled || uploading) return;

    // Signed out (or the session just expired): clean toast, no dead picker.
    if (signedOut) {
      toast.error("Sign in required", DIGEST_LOGIN_REQUIRED_MESSAGE);
      return;
    }

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

    setUploading(true);
    const toastId = toast.info(
      `Uploading ${file.name}…`,
      `${digestSourceTypeFor(file).toUpperCase()} · indexing to workspace memory`,
      0
    );

    try {
      // No userId here: /api/digest/upload injects it from the auth cookies.
      const { documentId } = await uploadToDigest({ file, origin });

      toast.update(toastId, {
        type: "success",
        title: "Document indexed to memory ✓",
        message: `${file.name} is now searchable in your workspace.`,
      });
      onUploaded?.({ filename: file.name, documentId });
    } catch (err) {
      console.error("Upload error:", err);
      const isAuthError =
        err instanceof DigestUploadError && err.kind === "unauthenticated";
      if (isAuthError) setSignedIn(false);

      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast.update(toastId, {
        type: "error",
        title: isAuthError ? "Sign in required" : "Upload failed",
        message:
          isAuthError && !message
            ? DIGEST_LOGIN_REQUIRED_MESSAGE
            : message.length > 160
              ? `${message.slice(0, 157)}…`
              : message,
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
        disabled={isDisabled}
        title={
          signedOut
            ? DIGEST_LOGIN_REQUIRED_MESSAGE
            : "Attach PDF, TXT, MD, PNG or JPG — indexes to workspace memory"
        }
        aria-label={
          signedOut
            ? "Attach a document (sign in required)"
            : "Attach a document or screenshot"
        }
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
