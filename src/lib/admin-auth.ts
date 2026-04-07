import crypto from "crypto";

const COOKIE_NAME = "admin_auth";

function getSecret(): string {
  return process.env.ADMIN_SESSION_SECRET?.trim() || "dev-admin-secret-change-me";
}

export function adminCookieName(): string {
  return COOKIE_NAME;
}

export function credentialsValid(username: string, password: string): boolean {
  const expectedUsers =
    process.env.ADMIN_USERNAMES?.split(",")
      .map((x) => x.trim())
      .filter(Boolean) ?? [];
  const expectedUser = process.env.ADMIN_USERNAME?.trim() || "";
  const expectedPass = process.env.ADMIN_PASSWORD || "";
  const user = username.trim();
  const userOk =
    expectedUsers.length > 0 ? expectedUsers.includes(user) : user === expectedUser;
  return (
    user.length > 0 &&
    password.length > 0 &&
    userOk &&
    password === expectedPass
  );
}

export function issueAdminToken(username: string): string {
  const payload = `${username.trim()}:${Math.floor(Date.now() / 1000)}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  const data = Buffer.from(payload, "utf8").toString("base64url");
  return `${data}.${sig}`;
}

export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const [data, sig] = token.split(".");
  if (!data || !sig) return false;
  const payload = Buffer.from(data, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  if (expected !== sig) return false;
  const [, issuedAtRaw] = payload.split(":");
  const issuedAt = Number.parseInt(issuedAtRaw ?? "", 10);
  if (Number.isNaN(issuedAt)) return false;
  const maxAgeSec = 60 * 60 * 24 * 7;
  return Math.floor(Date.now() / 1000) - issuedAt <= maxAgeSec;
}
