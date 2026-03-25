import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server-auth";
import { supabaseRestAsUser } from "@/lib/supabase/rest";
import { parseBooleanFlag, stockTransactionErrorMessage, txTypeToStockDelta } from "@/lib/inventory";

export const runtime = "nodejs";

type TransactionPayload = {
  txType?: "IN" | "OUT";
  qty?: number;
  memo?: string | null;
  isBGrade?: boolean;
};

type TransactionRow = {
  id: string;
  part_id: string;
  tx_type: "IN" | "OUT" | "ADJUST";
  qty: number;
  memo: string | null;
  is_b_grade: boolean;
  parts?: {
    id: string;
    current_stock: number;
    item_number: string;
    designation: string;
  } | null;
};

async function fetchTransaction(token: string, id: string) {
  const res = await supabaseRestAsUser(
    `/stock_transactions?id=eq.${encodeURIComponent(id)}&select=id,part_id,tx_type,qty,memo,is_b_grade,parts!inner(id,current_stock,item_number,designation)&limit=1`,
    token,
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text);
  }
  const rows = JSON.parse(text) as TransactionRow[];
  return rows[0] || null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin(req);
    const { id } = await params;
    const body = (await req.json()) as TransactionPayload;
    const txType = body.txType;
    const qty = Number(body.qty);
    const memo = body.memo?.trim() || null;
    const isBGrade = parseBooleanFlag(body.isBGrade);

    if ((txType !== "IN" && txType !== "OUT") || !Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: "수정할 구분과 수량을 정확히 입력하세요." }, { status: 400 });
    }

    const currentTx = await fetchTransaction(me.token, id);
    if (!currentTx || !currentTx.parts) {
      return NextResponse.json({ error: "최근 이력을 찾을 수 없습니다." }, { status: 404 });
    }
    if (currentTx.tx_type === "ADJUST") {
      return NextResponse.json({ error: "보정(ADJUST) 이력은 수정할 수 없습니다." }, { status: 400 });
    }

    const currentStock = Number(currentTx.parts.current_stock || 0);
    const revertedStock = currentStock - txTypeToStockDelta(currentTx.tx_type, Number(currentTx.qty));
    const nextStock = revertedStock + txTypeToStockDelta(txType, qty);

    if (nextStock < 0) {
      return NextResponse.json({ error: "현재 재고보다 많이 출고할 수 없습니다." }, { status: 400 });
    }

    const partRes = await supabaseRestAsUser(`/parts?id=eq.${encodeURIComponent(currentTx.part_id)}`, me.token, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        current_stock: nextStock,
      }),
    });
    const partText = await partRes.text();
    if (!partRes.ok) {
      return NextResponse.json({ error: stockTransactionErrorMessage(partText) }, { status: partRes.status });
    }

    const txRes = await supabaseRestAsUser(`/stock_transactions?id=eq.${encodeURIComponent(id)}`, me.token, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        tx_type: txType,
        qty,
        memo,
        is_b_grade: isBGrade,
      }),
    });
    const txText = await txRes.text();
    if (!txRes.ok) {
      return NextResponse.json({ error: txText }, { status: txRes.status });
    }

    return NextResponse.json({ data: JSON.parse(txText) });
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
    const currentTx = await fetchTransaction(me.token, id);

    if (!currentTx || !currentTx.parts) {
      return NextResponse.json({ error: "최근 이력을 찾을 수 없습니다." }, { status: 404 });
    }
    if (currentTx.tx_type === "ADJUST") {
      return NextResponse.json({ error: "보정(ADJUST) 이력은 삭제할 수 없습니다." }, { status: 400 });
    }

    const currentStock = Number(currentTx.parts.current_stock || 0);
    const nextStock = currentStock - txTypeToStockDelta(currentTx.tx_type, Number(currentTx.qty));
    if (nextStock < 0) {
      return NextResponse.json({ error: "이력 삭제 후 재고가 음수가 되어 삭제할 수 없습니다." }, { status: 400 });
    }

    const partRes = await supabaseRestAsUser(`/parts?id=eq.${encodeURIComponent(currentTx.part_id)}`, me.token, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        current_stock: nextStock,
      }),
    });
    const partText = await partRes.text();
    if (!partRes.ok) {
      return NextResponse.json({ error: stockTransactionErrorMessage(partText) }, { status: partRes.status });
    }

    const txRes = await supabaseRestAsUser(`/stock_transactions?id=eq.${encodeURIComponent(id)}`, me.token, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
    const txText = await txRes.text();
    if (!txRes.ok) {
      return NextResponse.json({ error: txText }, { status: txRes.status });
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
