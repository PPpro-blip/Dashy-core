import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/* (route handlers like /api/img-proxy must never queue behind
     *   a Supabase session refresh — the image proxy streams bytes, not auth)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico / icons (static assets)
     * - public files with extensions (images, svg, png, jpg, etc.)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon-512.png|dcode-icon-512.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};