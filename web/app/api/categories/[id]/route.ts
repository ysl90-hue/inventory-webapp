import { NextResponse } from "next/server";
import { supabaseRestAsUser } from "@/lib/supabase/rest";
import { requireAdmin } from "@/lib/server-auth";
import { normalizeCategory } from "@/lib/inventory";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin(req);
    const { id } = await params;
    const body = (await req.json()) as { name?: string };
    const name = normalizeCategory(body.name);

    if (!name) {
      return NextResponse.json({ error: "구분명을 입력하세요." }, { status: 400 });
    }

    const res = await supabaseRestAsUser(`/part_categories?id=eq.${encodeURIComponent(id)}`, me.token, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({ name }),
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin(req);
    const { id } = await params;
    const res = await supabaseRestAsUser(`/part_categories?id=eq.${encodeURIComponent(id)}`, me.token, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message.includes("Forbidden") ? 403 : message.includes("Unauthorized") ? 401 : 400 },
    );
  }
}
