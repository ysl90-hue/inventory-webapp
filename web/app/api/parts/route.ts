import { NextResponse } from "next/server";
import { supabaseRest, supabaseRestAsUser } from "@/lib/supabase/rest";
import { requireAdmin } from "@/lib/server-auth";
import { normalizeCategory, normalizeText, normalizeUnit, parseBooleanFlag } from "@/lib/inventory";

export const runtime = "nodejs";

type PartPayload = {
  position?: string | null;
  item_number?: string;
  designation?: string;
  quantity?: number;
  unit_of_quantity?: string | null;
  spare_parts_identifier?: string | null;
  current_stock?: number;
  minimum_stock?: number;
  location?: string | null;
  is_b_grade?: boolean;
};

function normalizePayload(input: PartPayload) {
  const itemNumber = (input.item_number || "").trim().toUpperCase();
  const designation = (input.designation || "").trim();

  if (!itemNumber || !designation) {
    throw new Error("item_number and designation are required");
  }

  return {
    position: normalizeCategory(input.position),
    item_number: itemNumber,
    designation,
    quantity: Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : 0,
    unit_of_quantity: normalizeUnit(input.unit_of_quantity),
    spare_parts_identifier: normalizeText(input.spare_parts_identifier),
    current_stock: Number.isFinite(Number(input.current_stock)) ? Number(input.current_stock) : 0,
    minimum_stock: Number.isFinite(Number(input.minimum_stock)) ? Number(input.minimum_stock) : 0,
    location: normalizeCategory(input.location),
    is_b_grade: parseBooleanFlag(input.is_b_grade),
  };
}

export async function GET() {
  try {
    const [partsRes, txRes] = await Promise.all([
      supabaseRest("/parts?select=*&order=item_number.asc"),
      supabaseRest("/stock_transactions?select=part_id,tx_type,qty,is_b_grade"),
    ]);
    const [partsText, txText] = await Promise.all([partsRes.text(), txRes.text()]);
    if (!partsRes.ok || !txRes.ok) {
      return NextResponse.json({ error: partsText || txText }, { status: partsRes.ok ? txRes.status : partsRes.status });
    }

    const parts = JSON.parse(partsText) as Array<{
      id: string;
      current_stock: number;
      [key: string]: unknown;
    }>;
    const txRows = JSON.parse(txText) as Array<{
      part_id: string;
      tx_type: "IN" | "OUT" | "ADJUST";
      qty: number;
      is_b_grade?: boolean;
    }>;

    const stockMap = new Map<string, { normal: number; bGrade: number; hasTx: boolean }>();
    for (const tx of txRows) {
      const current = stockMap.get(tx.part_id) || { normal: 0, bGrade: 0, hasTx: false };
      current.hasTx = true;
      if (tx.tx_type === "IN") {
        if (tx.is_b_grade) current.bGrade += Number(tx.qty || 0);
        else current.normal += Number(tx.qty || 0);
      } else if (tx.tx_type === "OUT") {
        if (tx.is_b_grade) current.bGrade -= Number(tx.qty || 0);
        else current.normal -= Number(tx.qty || 0);
      }
      stockMap.set(tx.part_id, current);
    }

    const data = parts.map((part) => {
      const breakdown = stockMap.get(part.id);
      const total = Number(part.current_stock || 0);
      if (!breakdown || !breakdown.hasTx) {
        return { ...part, normal_stock: total, b_grade_stock: 0 };
      }

      let normalStock = Number(breakdown.normal || 0);
      let bGradeStock = Number(breakdown.bGrade || 0);
      const diff = total - (normalStock + bGradeStock);
      if (diff !== 0) {
        normalStock += diff;
      }

      return {
        ...part,
        normal_stock: normalStock,
        b_grade_stock: bGradeStock,
      };
    });

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

export async function POST(req: Request) {
  try {
    const me = await requireAdmin(req);
    const body = (await req.json()) as PartPayload;
    const payload = normalizePayload(body);

    const res = await supabaseRestAsUser("/parts", me.token, {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
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
