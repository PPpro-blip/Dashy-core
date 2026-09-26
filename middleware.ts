import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // updateSession exempts /s/<slug> (and legacy D-Code shares) from the
  // sign-in redirect and returns 403 for private links opened by non-owners.
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico / icons (static assets)
     * - api/img-proxy (the <IMG> engine's fallback lane — pure byte
     *   streaming, cookieless, so it never pays a Supabase session
     *   roundtrip and can never be disturbed by an auth hiccup)
     * - public files with extensions (images, svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|icon-512.png|dcode-icon-512.png|api/img-proxy|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};