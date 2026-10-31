export function publicSharePayload(row: Record<string, unknown>) {
  const files = Array.isArray(row.files)
    ? row.files.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const file = entry as Record<string, unknown>;
        if (typeof file.name !== "string" || typeof file.content !== "string") return [];
        return [{
          ...(typeof file.id === "string" ? { id: file.id } : {}),
          name: file.name,
          ...(typeof file.language === "string" ? { language: file.language } : {}),
          content: file.content,
        }];
      })
    : [];
  return {
    title: typeof row.title === "string" ? row.title : "Untitled project",
    description: typeof row.description === "string" ? row.description : null,
    language: typeof row.language === "string" ? row.language : "typescript",
    files,
    is_public: true as const,
    share_slug: typeof row.share_slug === "string" ? row.share_slug : null,
  };
}
