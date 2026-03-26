import { NextRequest, NextResponse } from "next/server";
import { supabaseRest, supabaseRestAsUser } from "@/lib/supabase/rest";
import { parseBooleanFlag, stockTransactionErrorMessage } from "@/lib/inventory";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const body = (await req.json()) as {
      itemNumber?: string;
      txType?: "IN" | "OUT";
      qty?: number;
      memo?: string | null;
      createdAt?: string | null;
      isBGrade?: boolean;
    };

    const itemNumber = body.itemNumber?.trim();
    const txType = body.txType;
    const qty = Number(body.qty);
    const memo = body.memo?.trim() || null;
    const createdAt = body.createdAt?.trim() || null;
    const isBGrade = parseBooleanFlag(body.isBGrade);

    if (!itemNumber || (txType !== "IN" && txType !== "OUT") || !Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const rpcInit = {
      method: "POST",
      body: JSON.stringify({
        p_item_number: itemNumber,
        p_tx_type: txType,
        p_qty: qty,
        p_memo: memo,
        p_created_at: createdAt,
        p_is_b_grade: isBGrade,
      }),
    };
    const res = bearerToken
      ? await supabaseRestAsUser("/rpc/apply_stock_transaction", bearerToken, rpcInit)
      : await supabaseRest("/rpc/apply_stock_transaction", rpcInit);
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: stockTransactionErrorMessage(text) }, { status: res.status });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
      },
      { status: 500 },
    );
  }
}
