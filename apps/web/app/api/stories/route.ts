// M2: reads from Postgres `stories` ordered by score. MVP stub keeps contract stable.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const cursor = url.searchParams.get("cursor");
  if (cursor && Number.isNaN(Date.parse(cursor))) {
    return Response.json({ code: "bad_cursor", message: "cursor must be ISO date" }, { status: 400 });
  }
  return Response.json({ stories: [], next_cursor: null, limit });
}
