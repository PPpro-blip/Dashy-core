import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { DCodeWorkspace } from "@/components/dcode/DCodeWorkspace";
import { CodeIcon, GlobeIcon, LockIcon } from "@/components/icons";
import { getSharedDCodeProject } from "@/lib/dcode-shares";

type SharePageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { slug } = await params;
  const shared = await getSharedDCodeProject(slug);
  const requestHeaders = await headers();
  const rawHost = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    ""
  )
    .split(",")[0]
    .trim();
  const safeHost = /^[a-z0-9.:-]+$/i.test(rawHost) ? rawHost : "dashycore.ai";
  const protocol =
    requestHeaders.get("x-forwarded-proto") === "http" ? "http" : "https";
  const metadataBase = new URL(`${protocol}://${safeHost}`);

  // Anonymous crawlers (and other non-owners) must never receive private
  // project metadata, even if they already know its slug.
  if (!shared) {
    return {
      metadataBase,
      title: "Private project",
      description: "This DashyCore project is only available to its owner.",
      robots: { index: false, follow: false },
    };
  }

  const { project } = shared;
  const description =
    project.description?.trim() ||
    `Explore ${project.title} in D-Code, the DashyCore workspace.`;
  const title = `${project.title} · D-Code`;

  return {
    metadataBase,
    title,
    description,
    alternates: { canonical: `/s/${slug}` },
    ...(!project.isPublic ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title,
      description,
      siteName: "DashyCore",
      type: "website",
      url: `/s/${slug}`,
      images: [
        {
          url: "/share-card.png",
          width: 1200,
          height: 630,
          alt: "D-Code on DashyCore",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/share-card.png"],
    },
  };
}

export default async function SharedDCodePage({ params }: SharePageProps) {
  const { slug } = await params;
  const shared = await getSharedDCodeProject(slug);
  // RLS is the final authority. Middleware returns an HTTP 403 on ordinary
  // requests; keep a fail-closed guard here for render paths without it.
  if (!shared) notFound();

  const { project, isOwner } = shared;
  return (
    <div className="flex min-h-screen flex-col bg-navy">
      <header className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#0b1020] px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="DashyCore home"
        >
          <Image
            src="/icon-512.png"
            alt=""
            width={29}
            height={29}
            className="rounded-lg"
          />
          <span className="text-sm font-semibold tracking-tight text-white sm:text-base">
            DashyCore
          </span>
        </Link>
        <span className="hidden rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400 sm:inline-flex">
          D-Code
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-zinc-300">
            {project.isPublic ? (
              <GlobeIcon className="h-3.5 w-3.5 text-cyan-300" />
            ) : (
              <LockIcon className="h-3.5 w-3.5 text-violet-300" />
            )}
            {project.isPublic ? "Public view" : "Owner-only view"}
          </span>
          <Link
            href={isOwner ? `/d-code/${project.id}` : "/chat"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1.5 text-[11px] font-semibold text-[#05212a] transition-colors hover:bg-cyan-300"
          >
            <CodeIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {isOwner ? "Edit project" : "Open DashyCore"}
            </span>
            <span className="sm:hidden">{isOwner ? "Edit" : "Open"}</span>
          </Link>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <DCodeWorkspace project={project} readOnly />
      </main>
    </div>
  );
}
