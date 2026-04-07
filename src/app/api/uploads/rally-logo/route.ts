import fs from "fs/promises";
import path from "path";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
]);

function normalizeExt(file: File): string {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(fromName)) return fromName;
  switch (file.type) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const raw = formData.get("file");
    if (!(raw instanceof File)) {
      return Response.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (!raw.type.startsWith("image/")) {
      return Response.json({ error: "File must be an image." }, { status: 400 });
    }
    if (raw.size <= 0) {
      return Response.json({ error: "Image is empty." }, { status: 400 });
    }
    if (raw.size > MAX_FILE_BYTES) {
      return Response.json(
        { error: "Image is too large (max 5MB)." },
        { status: 400 },
      );
    }

    const ext = normalizeExt(raw);
    if (!ext) {
      return Response.json(
        { error: "Unsupported image type. Use PNG/JPG/WEBP/GIF/SVG." },
        { status: 400 },
      );
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "rally-logos");
    await fs.mkdir(uploadDir, { recursive: true });

    const fileName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const absPath = path.join(uploadDir, fileName);
    const buf = Buffer.from(await raw.arrayBuffer());
    await fs.writeFile(absPath, buf);

    const publicUrl = `/uploads/rally-logos/${fileName}`;
    return Response.json({ url: publicUrl });
  } catch {
    return Response.json({ error: "Upload failed." }, { status: 500 });
  }
}

