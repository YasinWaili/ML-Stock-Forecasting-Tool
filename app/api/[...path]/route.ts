async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const joined = path.join("/");
  if (
    !(request.method === "POST"
      ? joined === "jobs"
      : /^(health|stocks\/search|stocks\/[A-Za-z0-9.^=\-]{1,20}\/(dashboard|logo)|jobs(?:\/[a-f0-9]{32}(?:\/ledger)?)?|replays\/[a-f0-9]{32}\/reveal)$/.test(
          joined,
        ))
  ) {
    return Response.json({ detail: "Unknown API endpoint." }, { status: 404 });
  }
  const base = process.env.STOCK_API_URL || "http://127.0.0.1:8010";
  const target = new URL(`/api/${joined}`, base);
  target.search = new URL(request.url).search;
  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (body.length > 8_192)
      return Response.json({ detail: "Request too large." }, { status: 413 });
  }
  try {
    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
      method: request.method,
      body,
      headers: body ? { "Content-Type": "application/json" } : undefined,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
        "Cache-Control": upstream.headers.get("cache-control") || "no-store",
        ...(upstream.headers.get("content-disposition")
          ? {
              "Content-Disposition": upstream.headers.get(
                "content-disposition",
              )!,
            }
          : {}),
      },
    });
  } catch {
    return Response.json(
      {
        detail:
          "The local API is not responding. Start both services with npm.cmd run dev, then retry.",
      },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
