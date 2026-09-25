/** Client-side Excel download for admin result sheet exports. */
export async function downloadExcelTable(input: {
  fileName: string;
  sheetName: string;
  columns: string[];
  rows: string[][];
}): Promise<void> {
  const XLSX = await import("xlsx");
  const aoa = [input.columns, ...input.rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  const safeSheet = input.sheetName.replace(/[\\/?*[\]]/g, " ").slice(0, 31) || "Results";
  XLSX.utils.book_append_sheet(book, sheet, safeSheet);
  const safeFile = input.fileName.replace(/[<>:"/\\|?*]/g, "_").trim() || "results";
  XLSX.writeFile(book, safeFile.endsWith(".xlsx") ? safeFile : `${safeFile}.xlsx`);
}
