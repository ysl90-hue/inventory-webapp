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
      partId?: string;
      itemNumber?: string;
      txType?: "IN" | "OUT";
      qty?: number;
      memo?: string | null;
      createdAt?: string | null;
      isBGrade?: boolean;
      reclassifyToBGrade?: boolean;
    };

    const partId = body.partId?.trim();
    const txType = body.txType;
    const qty = Number(body.qty);
    const memo = body.memo?.trim() || null;
    const createdAt = body.createdAt?.trim() || null;
    const isBGrade = parseBooleanFlag(body.isBGrade);
    const reclassifyToBGrade = parseBooleanFlag(body.reclassifyToBGrade);

    if (!partId || (txType !== "IN" && txType !== "OUT") || !Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const callRpc = async (txTypeValue: "IN" | "OUT", bGrade: boolean, memoValue: string | null) => {
      const init = {
        method: "POST",
        body: JSON.stringify({
          p_part_id: partId,
          p_tx_type: txTypeValue,
          p_qty: qty,
          p_memo: memoValue,
          p_created_at: createdAt,
          p_is_b_grade: bGrade,
        }),
      };

      const res = bearerToken
        ? await supabaseRestAsUser("/rpc/apply_stock_transaction_by_part", bearerToken, init)
        : await supabaseRest("/rpc/apply_stock_transaction_by_part", init);
      const text = await res.text();
      return { res, text };
    };

    if (txType === "OUT" && !isBGrade && reclassifyToBGrade) {
      const usageResult = await callRpc("OUT", false, memo);
      if (!usageResult.res.ok) {
        return NextResponse.json(
          { error: stockTransactionErrorMessage(usageResult.text) },
          { status: usageResult.res.status },
        );
      }

      const inboundMemo = memo ? `${memo} / B급 분류 자동 입고` : "B급 분류 자동 입고";
      const bGradeInboundResult = await callRpc("IN", true, inboundMemo);
      if (!bGradeInboundResult.res.ok) {
        await callRpc("IN", false, "B급 분류 실패로 인한 자동 복구");
        return NextResponse.json(
          { error: "B급 자동 입고 처리에 실패했습니다. 일반 사용 처리도 자동 복구했습니다." },
          { status: bGradeInboundResult.res.status },
        );
      }

      return NextResponse.json({ ok: true, reclassifiedToBGrade: true });
    }

    const result = await callRpc(txType, isBGrade, memo);
    if (!result.res.ok) {
      return NextResponse.json({ error: stockTransactionErrorMessage(result.text) }, { status: result.res.status });
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
