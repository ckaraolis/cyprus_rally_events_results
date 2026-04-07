export function assertProxyPathAllowed(segments: string[]): void {
  const prefix = process.env.ALGE_ALLOWED_PROXY_PREFIX?.trim();
  if (!prefix) return;
  const path = segments.join("/");
  if (path !== prefix && !path.startsWith(`${prefix}/`)) {
    throw new ProxyPathError(
      `Path must start with ALGE_ALLOWED_PROXY_PREFIX (${prefix})`,
    );
  }
}

export class ProxyPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyPathError";
  }
}

export function joinApiUrl(
  base: string,
  segments: string[],
  searchParams: URLSearchParams,
): string {
  const trimmed = base.replace(/\/+$/, "");
  const path = segments.map(encodeURIComponent).join("/");
  const qs = searchParams.toString();
  return qs ? `${trimmed}/${path}?${qs}` : `${trimmed}/${path}`;
}
