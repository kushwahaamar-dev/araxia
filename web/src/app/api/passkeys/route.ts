import { listPasskeys } from "@/lib/passkeys";

export async function GET(req: Request): Promise<Response> {
  const user = new URL(req.url).searchParams.get("user");
  if (!user) return Response.json({ error: "user query parameter is required" }, { status: 400 });
  return Response.json({ passkeys: listPasskeys(user) });
}
