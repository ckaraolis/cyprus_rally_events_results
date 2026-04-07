import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import type { RallySiteConfig } from "@/lib/rally/types";
import { saveConfigToDb } from "@/lib/rally/db-store";

async function main() {
  const source = path.join(process.cwd(), "data", "rally-site.json");
  const raw = await fs.readFile(source, "utf-8");
  const parsed = JSON.parse(raw) as RallySiteConfig;
  await saveConfigToDb(parsed);
  // eslint-disable-next-line no-console
  console.log(`Migrated JSON -> DB from ${source}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", e);
  process.exit(1);
});
