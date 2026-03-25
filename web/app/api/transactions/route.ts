import { NextResponse } from "next/server";
import { supabaseRest, supabaseRestAsUser } from "@/lib/supabase/rest";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const txPath =
      "/stock_transactions?select=id,part_id,created_by,tx_type,qty,memo,is_b_grade,created_at,parts!inner(id,item_number,designation,current_stock,location,is_b_grade)&order=created_at.desc&limit=20";
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

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
      },
      { status: 500 },
    );
  }
}
