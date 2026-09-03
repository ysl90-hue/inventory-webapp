import { NextResponse } from "next/server";
import { supabaseRest, supabaseRestAsUser } from "@/lib/supabase/rest";

export const runtime = "nodejs";

function toKstIso(date: string, endOfDay = false) {
  return new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00"}+09:00`).toISOString();
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const { searchParams } = new URL(req.url);
    const pageParam = Number(searchParams.get("page") || "1");
    const limitParam = Number(searchParams.get("limit") || "100");
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 500) : 100;
    const offset = (page - 1) * limit;
    const txType = searchParams.get("txType");
    const grade = searchParams.get("grade");
    const partId = searchParams.get("partId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const filters: string[] = [];
    if (txType === "IN" || txType === "OUT" || txType === "ADJUST") {
      filters.push(`tx_type=eq.${encodeURIComponent(txType)}`);
    }
    if (grade === "NORMAL") {
      filters.push("is_b_grade=eq.false");
    } else if (grade === "B_GRADE") {
      filters.push("is_b_grade=eq.true");
    }
    if (partId) {
      filters.push(`part_id=eq.${encodeURIComponent(partId)}`);
    }
    if (from) {
      filters.push(`created_at=gte.${encodeURIComponent(toKstIso(from))}`);
    }
    if (to) {
      filters.push(`created_at=lte.${encodeURIComponent(toKstIso(to, true))}`);
    }
    const filterQuery = filters.length > 0 ? `&${filters.join("&")}` : "";

    const txPath =
      `/stock_transactions?select=id,part_id,created_by,tx_type,qty,memo,is_b_grade,created_at,parts!inner(id,item_number,designation,current_stock,location,is_b_grade)&order=created_at.desc&limit=${limit}&offset=${offset}${filterQuery}`;
    const res = bearerToken
      ? await supabaseRestAsUser(txPath, bearerToken)
      : await supabaseRest(txPath);
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const txRows = JSON.parse(text) as Array<{
      id: string;
      part_id: string;
      created_by?: string | null;
      tx_type: "IN" | "OUT" | "ADJUST";
      qty: number;
      memo: string | null;
      is_b_grade: boolean;
      created_at: string;
      parts?: {
        id: string;
        item_number: string;
        designation: string;
        current_stock?: number;
        location?: string | null;
        is_b_grade?: boolean;
      } | null;
    }>;

    let actorMap = new Map<string, string>();
    if (bearerToken) {
      const ids = Array.from(
        new Set(txRows.map((tx) => tx.created_by).filter((v): v is string => Boolean(v))),
      );
      if (ids.length > 0) {
        const inList = ids.join(",");
        const profileRes = await supabaseRestAsUser(
          `/profiles?select=id,display_name,email&id=in.(${inList})`,
          bearerToken,
        );
        const profileText = await profileRes.text();
        if (profileRes.ok) {
          const profiles = JSON.parse(profileText) as Array<{
            id: string;
            display_name?: string | null;
            email?: string | null;
          }>;
          actorMap = new Map(
            profiles.map((p) => [
              p.id,
              p.display_name || (p.email ? p.email.split("@")[0] : "Unknown"),
            ]),
          );
        }
      }
    }

    const data = txRows.map((tx) => ({
      ...tx,
      actor_name: tx.created_by ? actorMap.get(tx.created_by) || null : null,
    }));

    let total = data.length;
    const countPath = `/stock_transactions?select=id,parts!inner(id)${filterQuery}`;
    const countRes = bearerToken
      ? await supabaseRestAsUser(countPath, bearerToken)
      : await supabaseRest(countPath);
    const countText = await countRes.text();
    if (countRes.ok) {
      try {
        const countRows = JSON.parse(countText) as Array<{ id: string }>;
        total = countRows.length;
      } catch {
        total = data.length;
      }
    }

    return NextResponse.json({ data, page, limit, total, hasMore: offset + data.length < total });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
      },
      { status: 500 },
    );
  }
}
