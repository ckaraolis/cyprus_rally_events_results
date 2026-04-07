import { NextResponse } from "next/server";
import {
  ProxyPathError,
  assertProxyPathAllowed,
  joinApiUrl,
} from "@/lib/alge/proxy-path";
import {
  algeAuthorizationHeader,
  clearAlgeTokenCache,
  getAlgeAccessToken,
} from "@/lib/alge/token";

export const runtime = "nodejs";

const ALLOWED_METHODS = new Set(["GET", "POST", "HEAD"]);

function forwardHeaders(from: Request): Headers {
  const out = new Headers();
  const accept = from.headers.get("accept");
  if (accept) out.set("Accept", accept);
  const lang = from.headers.get("accept-language");
  if (lang) out.set("Accept-Language", lang);
  const ct = from.headers.get("content-type");
  if (ct) out.set("Content-Type", ct);
  return out;
}

async function handle(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const base = process.env.ALGE_API_BASE?.trim();
  if (!base) {
    return NextResponse.json(
      { error: "ALGE_API_BASE is not configured" },
      { status: 500 },
    );
  }

  const { path: segments = [] } = await context.params;

  if (segments.length === 0) {
    return NextResponse.json(
      { error: "Missing path. Use /api/alge/<mt1-api-path>." },
      { status: 400 },
    );
  }

  try {
    assertProxyPathAllowed(segments);
  } catch (e) {
    if (e instanceof ProxyPathError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }

  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json({ error: "Method not allowed" }, {
      status: 405,
    });
  }

  let token: string;
  try {
    token = await getAlgeAccessToken();
  } catch (e) {
    const message = e instanceof Error ? e.message : "ALGE auth error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const url = new URL(request.url);
  const target = joinApiUrl(base, segments, url.searchParams);
  const headers = forwardHeaders(request);
  const [authName, authValue] = algeAuthorizationHeader(token);
  headers.set(authName, authValue);

  const init: RequestInit = { method, headers };
  if (method === "POST") {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upstream fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const resHeaders = new Headers(upstream.headers);
  if (upstream.status === 403) {
    clearAlgeTokenCache();
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return handle(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return handle(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return handle(request, context);
}
