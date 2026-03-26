import { NextResponse } from "next/server";
import { supabaseRest, supabaseRestAsUser } from "@/lib/supabase/rest";
import { requireAdmin } from "@/lib/server-auth";
import { normalizeCategory } from "@/lib/inventory";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await supabaseRest("/part_locations?select=id,code,created_at&order=code.asc");
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text }, { status: res.status });
    }
    return NextResponse.json({ data: JSON.parse(text) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireAdmin(req);
    const body = (await req.json()) as { code?: string };
    const code = normalizeCategory(body.code);

    if (!code) {
      return NextResponse.json({ error: "위치 코드를 입력하세요." }, { status: 400 });
    }

    const res = await supabaseRestAsUser("/part_locations", me.token, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        code,
        created_by: me.userId,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text }, { status: res.status });
    }
    return NextResponse.json({ data: JSON.parse(text) });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message.includes("Forbidden") ? 403 : message.includes("Unauthorized") ? 401 : 400 },
    );
  }
}
