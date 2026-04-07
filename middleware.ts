import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminCookieName, verifyAdminToken } from "@/lib/admin-auth";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (pathname === "/admin/login") return NextResponse.next();

  const token = request.cookies.get(adminCookieName())?.value;
  if (verifyAdminToken(token)) return NextResponse.next();

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
