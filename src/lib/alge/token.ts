type TokenCache = { token: string; expiresAt: number };

const REFRESH_BUFFER_MS = 60_000;

let cache: TokenCache | null = null;

function extractToken(data: unknown): string | null {
  if (typeof data === "string" && data.trim().length > 0) {
    return data.trim();
  }

  const fromObject = (obj: Record<string, unknown>): string | null => {
    for (const k of [
      "token",
      "authorizationToken",
      "accessToken",
      "authToken",
      "bearerToken",
      "jwt",
      "idToken",
    ]) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return null;
  };

  const key = process.env.ALGE_TOKEN_JSON_KEY?.trim();
  if (key && typeof data === "object" && data !== null && key in data) {
    const v = (data as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (typeof data === "object" && data !== null) {
    const o = data as Record<string, unknown>;
    const top = fromObject(o);
    if (top) return top;
    for (const containerKey of ["data", "result", "payload", "response"]) {
      const nested = o[containerKey];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const nestedToken = fromObject(nested as Record<string, unknown>);
        if (nestedToken) return nestedToken;
      } else if (Array.isArray(nested)) {
        for (const item of nested) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const nestedToken = fromObject(item as Record<string, unknown>);
            if (nestedToken) return nestedToken;
          } else if (typeof item === "string" && item.trim().length > 0) {
            return item.trim();
          }
        }
      } else if (typeof nested === "string" && nested.trim().length > 0) {
        return nested.trim();
      }
    }
  }
  return null;
}

function describeAuthPayloadShape(data: unknown): string {
  if (!data || typeof data !== "object") return typeof data;
  const o = data as Record<string, unknown>;
  const topKeys = Object.keys(o).slice(0, 20).join(", ");
  const nestedHints: string[] = [];
  for (const k of ["data", "result", "payload", "response"]) {
    const v = o[k];
    if (Array.isArray(v)) {
      const first = v[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        nestedHints.push(`${k}[0]:{${Object.keys(first as Record<string, unknown>).slice(0, 20).join(", ")}}`);
      } else {
        nestedHints.push(`${k}:[${typeof first}]`);
      }
    } else if (v && typeof v === "object") {
      nestedHints.push(`${k}:{${Object.keys(v as Record<string, unknown>).slice(0, 20).join(", ")}}`);
    } else if (v !== undefined) {
      nestedHints.push(`${k}:${typeof v}`);
    }
  }
  return `top={${topKeys}}${nestedHints.length ? ` nested=${nestedHints.join(" | ")}` : ""}`;
}

function tokenTtlMs(data: unknown): number | null {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  if ("expires_in" in o) {
    const n = Number(o.expires_in);
    if (!Number.isNaN(n) && n > 0) return n * 1000;
  }
  return null;
}

function authorizationValue(token: string): string {
  const mode = (process.env.ALGE_AUTHORIZATION_MODE || "bearer").toLowerCase();
  if (mode === "raw") return token;
  return `Bearer ${token}`;
}

export function algeAuthorizationHeader(token: string): [string, string] {
  const name = process.env.ALGE_AUTHORIZATION_HEADER_NAME || "Authorization";
  return [name, authorizationValue(token)];
}

export async function getAlgeAccessToken(): Promise<string> {
  const staticToken = process.env.ALGE_STATIC_TOKEN?.trim();
  if (staticToken) {
    return staticToken;
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now + REFRESH_BUFFER_MS) {
    return cache.token;
  }

  const authUrl = process.env.ALGE_AUTH_URL?.trim();
  if (!authUrl) {
    throw new Error("ALGE_AUTH_URL is not set");
  }
  const username = process.env.ALGE_USERNAME?.trim();
  const password = process.env.ALGE_PASSWORD;
  if (!username || password === undefined || password === "") {
    throw new Error("ALGE_USERNAME / ALGE_PASSWORD are not set");
  }

  const loginField = process.env.ALGE_LOGIN_FIELD?.trim() || "username";
  const res = await fetch(authUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ [loginField]: username, password }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(
      `ALGE auth failed (${res.status}): ${rawText.slice(0, 300)}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("ALGE auth response was not JSON");
  }

  const apiStatus =
    typeof data === "object" && data !== null && "status" in data
      ? Number((data as Record<string, unknown>).status)
      : null;
  if (apiStatus !== null && !Number.isNaN(apiStatus) && apiStatus !== 0) {
    const msg =
      typeof (data as Record<string, unknown>).message === "string"
        ? (data as Record<string, unknown>).message
        : "unknown ALGE auth error";
    throw new Error(`ALGE auth rejected credentials (status=${apiStatus}): ${msg}`);
  }

  const token = extractToken(data);
  if (!token) {
    throw new Error(
      `Could not read token from ALGE auth response. Payload shape: ${describeAuthPayloadShape(data)}. Set ALGE_TOKEN_JSON_KEY if needed.`,
    );
  }

  const explicitCache = process.env.ALGE_TOKEN_CACHE_MS?.trim();
  const fallbackMs =
    explicitCache && !Number.isNaN(Number(explicitCache))
      ? Number(explicitCache)
      : 3_600_000;

  const ttl = tokenTtlMs(data) ?? fallbackMs;
  cache = { token, expiresAt: now + ttl };
  return token;
}

export function clearAlgeTokenCache(): void {
  cache = null;
}
