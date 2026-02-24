import { NextResponse } from "next/server";
import { getAuthenticatedUserWithRole } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const me = await getAuthenticatedUserWithRole(req);
    return NextResponse.json({
      data: {
        userId: me.userId,
        email: me.email,
        displayName: me.displayName ?? null,
        role: me.role,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
