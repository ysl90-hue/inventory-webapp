import { NextResponse } from "next/server";
import { supabaseAuth } from "@/lib/supabase/rest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string; displayName?: string };
    const email = body.email?.trim();
    const password = body.password ?? "";
    const displayName = body.displayName?.trim();

    if (!email || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    const res = await supabaseAuth("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        data: displayName ? { display_name: displayName } : undefined,
      }),
    });

    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error" },
      { status: 500 },
    );
  }
}
