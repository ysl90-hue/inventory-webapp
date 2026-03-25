import { NextResponse } from "next/server";
import { supabaseRestAsUser } from "@/lib/supabase/rest";
import { requireAdmin } from "@/lib/server-auth";
import { normalizeCategory, normalizeText, normalizeUnit, parseBooleanFlag } from "@/lib/inventory";

export const runtime = "nodejs";

type PartPatchPayload = {
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

function normalizePatchPayload(input: PartPatchPayload) {
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin(req);
    const { id } = await params;
    const body = (await req.json()) as PartPatchPayload;
    const payload = normalizePatchPayload(body);

    const res = await supabaseRestAsUser(`/parts?id=eq.${encodeURIComponent(id)}`, me.token, {
      method: "PATCH",
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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin(_req);
    const { id } = await params;
    const res = await supabaseRestAsUser(`/parts?id=eq.${encodeURIComponent(id)}`, me.token, {
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
