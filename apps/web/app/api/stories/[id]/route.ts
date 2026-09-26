import { getStory } from "../../../../lib/stories";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ code: "bad_id", message: "id must be a positive integer" }, { status: 400 });
  }
  try {
    const story = await getStory(id);
    if (!story) return Response.json({ code: "not_found", message: "story not found" }, { status: 404 });
    return Response.json({ story });
  } catch {
    return Response.json({ code: "internal", message: "unexpected error" }, { status: 500 });
  }
}
