import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch (err) {
    console.error("[img-proxy] Invalid image URL provided:", rawUrl, err);
    return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(35000),
      redirect: "follow",
      headers: {
        Accept: "image/jpeg, image/png, image/webp, image/*, */*",
        "User-Agent": "DashyCore-ImgProxy/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `[img-proxy] Provider failed with status ${response.status} (${response.statusText}) for URL: ${url.toString()}`
      );
      return NextResponse.json(
        {
          error: `Image provider failed with status ${response.status}: ${response.statusText}`,
          status: response.status,
        },
        { status: response.status >= 500 ? 502 : response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, immutable",
    };

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    return new NextResponse(buffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error(`[img-proxy] Error fetching image URL: ${url.toString()}`, error);
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    return NextResponse.json(
      {
        error: timedOut
          ? "Image request timed out (35s)"
          : error instanceof Error
            ? error.message
            : "Could not fetch image",
      },
      { status: timedOut ? 504 : 502 }
    );
  }
}
