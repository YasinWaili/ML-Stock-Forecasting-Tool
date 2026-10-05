export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const joined = path.join("/");
  if (
    !/^(health|stocks\/search|stocks\/[A-Za-z0-9.^=\-]{1,20}\/(dashboard|logo))$/.test(
      joined,
    )
  ) {
    return Response.json({ detail: "Unknown API endpoint." }, { status: 404 });
  }
  const base = process.env.STOCK_API_URL || "http://127.0.0.1:8010";
  const target = new URL(`/api/${joined}`, base);
  target.search = new URL(request.url).search;
  try {
    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
        "Cache-Control": upstream.headers.get("cache-control") || "no-store",
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
