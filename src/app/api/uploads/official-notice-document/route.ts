import fs from "fs/promises";
import path from "path";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".odt",
  ".xls",
  ".xlsx",
]);

function normalizeExt(file: File): string {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(fromName)) return fromName;
  return "";
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-{2,}/g, "-");
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt":
      return "text/plain";
    case ".rtf":
      return "application/rtf";
    case ".odt":
      return "application/vnd.oasis.opendocument.text";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const raw = formData.get("file");
    if (!(raw instanceof File)) {
      return Response.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (raw.size <= 0) {
      return Response.json({ error: "Document is empty." }, { status: 400 });
    }
    if (raw.size > MAX_FILE_BYTES) {
      return Response.json(
        { error: "Document is too large (max 20MB)." },
        { status: 400 },
      );
    }
    const ext = normalizeExt(raw);
    if (!ext) {
      return Response.json(
        { error: "Unsupported file type. Use PDF, DOC/DOCX, TXT, RTF, ODT, XLS/XLSX." },
        { status: 400 },
      );
    }
    const buf = Buffer.from(await raw.arrayBuffer());
    const baseName = sanitizeFileName(path.parse(raw.name).name || "document");
    const fileName = `${Date.now()}-${crypto.randomUUID()}-${baseName}${ext}`;
    try {
      const uploadDir = path.join(process.cwd(), "public", "uploads", "official-notices");
      await fs.mkdir(uploadDir, { recursive: true });
      const absPath = path.join(uploadDir, fileName);
      await fs.writeFile(absPath, buf);
      return Response.json({
        url: `/uploads/official-notices/${fileName}`,
        fileName: raw.name,
      });
    } catch {
      // Fallback for runtimes where filesystem writes are not persistent.
      const mime = raw.type || mimeForExt(ext);
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      return Response.json({
        url: dataUrl,
        fileName: raw.name,
        fallback: "data-url",
      });
    }
  } catch {
    return Response.json({ error: "Upload failed." }, { status: 500 });
  }
}

