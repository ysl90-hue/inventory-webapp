import { NextResponse } from "next/server";
import { supabaseRest, supabaseRestAsUser } from "@/lib/supabase/rest";
import { requireAdmin } from "@/lib/server-auth";

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
};

function normalizePayload(input: PartPayload) {
  const itemNumber = (input.item_number || "").trim().toUpperCase();
  const designation = (input.designation || "").trim();

  if (!itemNumber || !designation) {
    throw new Error("item_number and designation are required");
  }

  return {
    position: input.position?.trim() || null,
    item_number: itemNumber,
    designation,
    quantity: Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : 0,
    unit_of_quantity: input.unit_of_quantity?.trim() || null,
    spare_parts_identifier: input.spare_parts_identifier?.trim() || null,
    current_stock: Number.isFinite(Number(input.current_stock)) ? Number(input.current_stock) : 0,
    minimum_stock: Number.isFinite(Number(input.minimum_stock)) ? Number(input.minimum_stock) : 0,
    location: input.location?.trim() || null,
  };
}

export async function GET() {
  try {
    const res = await supabaseRest("/parts?select=*&order=item_number.asc");
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text }, { status: res.status });
    }
    return NextResponse.json({ data: JSON.parse(text) });
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
