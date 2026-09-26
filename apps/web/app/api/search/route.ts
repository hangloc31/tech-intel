import { parseSearchQuery, searchStories } from "../../../lib/search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const input: Record<string, string | undefined> = {};
  url.searchParams.forEach((v, k) => {
    input[k] = v;
  });
  try {
    const query = parseSearchQuery(input);
    const { results } = await searchStories(query);
    return Response.json({ results, q: query.q });
  } catch (e) {
    if (e && typeof e === "object" && "status" in e && "body" in e) {
      const err = e as { status: number; body: { code: string; message: string } };
      return Response.json(err.body, { status: err.status });
    }
    return Response.json({ code: "internal", message: "unexpected error" }, { status: 500 });
  }
}
