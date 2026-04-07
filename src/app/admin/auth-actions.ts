"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminCookieName, credentialsValid, issueAdminToken } from "@/lib/admin-auth";

export async function loginAdmin(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextPath = String(formData.get("next") ?? "/admin");

  if (!credentialsValid(username, password)) {
    redirect(`/admin/login?error=1&next=${encodeURIComponent(nextPath)}`);
  }

  const token = issueAdminToken(username);
  const jar = await cookies();
  jar.set(adminCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect(nextPath.startsWith("/admin") ? nextPath : "/admin");
}

export async function logoutAdmin() {
  const jar = await cookies();
  jar.set(adminCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  redirect("/admin/login");
}
