import https from "node:https";

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase env vars");
  }

  return { url, key };
}

type SupabaseRestResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type RequestInitLite = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function supabaseRequest(
  path: string,
  init: RequestInitLite | undefined,
  opts: { base: "rest" | "auth"; authToken?: string },
): Promise<SupabaseRestResponse> {
  const { url, key } = getEnv();
  const basePath = opts.base === "auth" ? "/auth/v1" : "/rest/v1";
  const target = new URL(`${url}${basePath}${path}`);
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${opts.authToken || key}`,
    ...(opts.base === "rest" ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers ?? {}),
  };

  const body = init?.body;

  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: init?.method ?? "GET",
        headers: body
          ? {
              ...headers,
              "Content-Length": Buffer.byteLength(body).toString(),
            }
          : headers,
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          chunks += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 500, body: chunks });
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error("Request timeout"));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });

  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    text: async () => result.body,
  };
}

export async function supabaseRest(
  path: string,
  init?: RequestInitLite,
): Promise<SupabaseRestResponse> {
  return supabaseRequest(path, init, { base: "rest" });
}

export async function supabaseRestAsUser(
  path: string,
  authToken: string,
  init?: RequestInitLite,
): Promise<SupabaseRestResponse> {
  return supabaseRequest(path, init, { base: "rest", authToken });
}

export async function supabaseAuthUser(authToken: string): Promise<SupabaseRestResponse> {
  return supabaseRequest("/user", undefined, { base: "auth", authToken });
}

export async function supabaseAuth(
  path: string,
  init?: RequestInitLite,
): Promise<SupabaseRestResponse> {
  return supabaseRequest(path, init, { base: "auth" });
}
