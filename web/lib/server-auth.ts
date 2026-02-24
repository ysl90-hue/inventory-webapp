import { supabaseAuthUser, supabaseRestAsUser } from "@/lib/supabase/rest";

export type AuthMe = {
  userId: string;
  email: string | null;
  displayName?: string | null;
  role: "user" | "admin";
  token: string;
};

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7).trim();
}

export async function getAuthenticatedUserWithRole(req: Request): Promise<AuthMe> {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error("Unauthorized");
  }

  const userRes = await supabaseAuthUser(token);
  const userText = await userRes.text();
  if (!userRes.ok) {
    throw new Error(`Unauthorized: ${userText}`);
  }
  const user = JSON.parse(userText) as { id: string; email?: string | null };

  const profileRes = await supabaseRestAsUser(
    `/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,email,display_name`,
    token,
  );
  const profileText = await profileRes.text();
  if (!profileRes.ok) {
    throw new Error(`Profile lookup failed: ${profileText}`);
  }
  const rows = JSON.parse(profileText) as Array<{
    role?: "user" | "admin";
    email?: string | null;
    display_name?: string | null;
  }>;

  return {
    userId: user.id,
    email: rows[0]?.email ?? user.email ?? null,
    role: rows[0]?.role ?? "user",
    displayName: rows[0]?.display_name ?? null,
    token,
  };
}

export async function requireAdmin(req: Request): Promise<AuthMe> {
  const me = await getAuthenticatedUserWithRole(req);
  if (me.role !== "admin") {
    throw new Error("Forbidden: admin only");
  }
  return me;
}
