import { apiError, listStories, parseListQuery } from "../../../lib/stories";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const input: Record<string, string | undefined> = {};
  url.searchParams.forEach((v, k) => {
    input[k] = v;
  });
  try {
    const query = parseListQuery(input);
    const { stories, next_cursor } = await listStories(query);
    return Response.json({ stories, next_cursor, limit: query.limit });
  } catch (e) {
    if (e && typeof e === "object" && "status" in e && "body" in e) {
      const err = e as { status: number; body: { code: string; message: string } };
      return Response.json(err.body, { status: err.status });
    }
    return Response.json(apiError(500, "internal", "unexpected error").body, { status: 500 });
  }
}
