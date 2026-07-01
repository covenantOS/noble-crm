// Branded PDF generation for estimates and invoices (pdf-lib, pure-JS, runs
// on the Workers runtime -- no external font/binary needed, embeds the
// standard Helvetica font that pdf-lib ships).
//
// This is LIVE now -- it needs no external API keys. Both the authed
// GET /api/estimates/{id}/pdf & /api/invoices/{id}/pdf routes and the public
// GET /api/public/estimates/{token}/pdf route call buildDocumentPdf() below.
//
// The document is a clean single-page (auto-paginating) letter-size layout:
//   - a letterhead band with the business/brand name + "Tampa, FL"
//   - the doc title ("Estimate"/"Invoice"), number, and date, top-right
//   - a "Bill To" customer block
//   - a line-items table (Description / Qty / Unit Price / Total)
//   - subtotal / tax / total totals block, right-aligned
//   - for a signed estimate, an "Accepted by {name} on {date}" line
//
// Colors default to the Noble navy/gold but accept per-brand overrides so a
// Westchase-Painting-branded doc reads on-brand.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// A single line item on the document.
export interface PdfLine {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// Everything buildDocumentPdf needs to render a document. Kept framework-free
// (plain data) so the route handlers can assemble it from Drizzle rows without
// this module importing the DB layer.
export interface PdfDocInput {
  // "Estimate" | "Invoice"
  docType: "Estimate" | "Invoice";
  // The brand/business name shown in the letterhead (e.g. "Westchase Painting").
  businessName: string;
  // Optional second letterhead line (city/state). Defaults to "Tampa, FL".
  businessLocation?: string;
  // The document identifier (e.g. "EST-12" / "INV-8"). May be null for a
  // never-sent draft estimate -- falls back to "Draft".
  identifier: string | null;
  // ISO/DB date the doc was created (used for the doc date line).
  createdAt: string | null;
  // Bill-to customer block.
  customerName: string;
  customerAddress?: string;
  // Money breakdown.
  lines: PdfLine[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  // Free-text notes printed under the totals, if present.
  notes?: string | null;
  // Signed-estimate acceptance line ("Accepted by {name} on {date}").
  signedName?: string | null;
  signedAt?: string | null;
  // Brand color overrides (hex like "#1a2b4a"). Fall back to Noble navy/gold.
  colorPrimary?: string | null;
  colorSecondary?: string | null;
}

// Noble brand defaults (navy primary / gold accent), matching styles.css.
const DEFAULT_PRIMARY = "#1a2b4a";
const DEFAULT_SECONDARY = "#c9a227";

// Parse a "#rrggbb" (or "#rgb") hex string into a pdf-lib rgb() color. Falls
// back to the supplied default on anything unparseable so a bad brand color in
// the DB never crashes PDF generation.
function hexToRgb(hex: string | null | undefined, fallback: string) {
  const h = (hex || fallback).replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) {
    // Recurse once against the fallback (which is a known-good 6-digit hex).
    return hexToRgb(fallback, DEFAULT_PRIMARY);
  }
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Format cents-free decimal dollars as "$1,234.50" for the PDF (self-contained
// -- the client's format.ts isn't importable into the Worker bundle cleanly,
// and this keeps the PDF module dependency-free).
function money(n: number): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "2026-07-01" / "2026-07-01 14:30:00" -> "Jul 1, 2026". Plain calendar parse,
// no timezone shift, mirroring the client's formatDate.
function prettyDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Draw a string clipped to maxWidth, appending an ellipsis if it overflows --
// keeps a long description from bleeding out of its table column.
function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

// pdf-lib's WinAnsi (Helvetica) encoding can't encode some Unicode the DB may
// hold (smart quotes, em dashes, etc.). Sanitize to a safe subset so encoding
// never throws mid-render; the ellipsis we add ourselves is the one exception
// we translate to "...".
function safe(text: string): string {
  return (text || "")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    // Drop anything outside basic Latin-1 that WinAnsi can't represent.
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 54;

// Builds the PDF and returns the raw bytes (Uint8Array) for the route to
// return with content-type application/pdf.
export async function buildDocumentPdf(input: PdfDocInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const primary = hexToRgb(input.colorPrimary, DEFAULT_PRIMARY);
  const secondary = hexToRgb(input.colorSecondary, DEFAULT_SECONDARY);
  const ink = rgb(0.12, 0.14, 0.18);
  const muted = rgb(0.42, 0.45, 0.5);
  const hairline = rgb(0.85, 0.87, 0.9);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H;

  // ── Letterhead band ──
  const bandH = 92;
  page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: primary });
  // Gold accent hairline under the band.
  page.drawRectangle({ x: 0, y: PAGE_H - bandH - 3, width: PAGE_W, height: 3, color: secondary });

  page.drawText(safe(input.businessName), { x: MARGIN, y: PAGE_H - 44, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safe(input.businessLocation || "Tampa, FL"), { x: MARGIN, y: PAGE_H - 64, size: 10, font, color: rgb(0.85, 0.87, 0.92) });

  // Doc title + number + date, right-aligned inside the band.
  const title = input.docType.toUpperCase();
  const titleSize = 22;
  const titleW = bold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, { x: PAGE_W - MARGIN - titleW, y: PAGE_H - 44, size: titleSize, font: bold, color: secondary });
  const idText = input.identifier || "Draft";
  const idW = font.widthOfTextAtSize(idText, 10);
  page.drawText(idText, { x: PAGE_W - MARGIN - idW, y: PAGE_H - 62, size: 10, font, color: rgb(0.9, 0.92, 0.96) });
  const dateText = prettyDate(input.createdAt);
  if (dateText) {
    const dW = font.widthOfTextAtSize(dateText, 10);
    page.drawText(dateText, { x: PAGE_W - MARGIN - dW, y: PAGE_H - 76, size: 10, font, color: rgb(0.9, 0.92, 0.96) });
  }

  y = PAGE_H - bandH - 34;

  // ── Bill To block ──
  page.drawText("BILL TO", { x: MARGIN, y, size: 9, font: bold, color: muted });
  y -= 16;
  page.drawText(safe(input.customerName || "—"), { x: MARGIN, y, size: 12, font: bold, color: ink });
  if (input.customerAddress) {
    y -= 15;
    page.drawText(clip(safe(input.customerAddress), font, 10, PAGE_W - MARGIN * 2), { x: MARGIN, y, size: 10, font, color: muted });
  }
  y -= 30;

  // ── Line-items table ──
  // Column x-anchors. Description left-aligned; qty/unit/total right-aligned
  // at their right edges.
  const colDescX = MARGIN;
  const colTotalR = PAGE_W - MARGIN;
  const colUnitR = colTotalR - 90;
  const colQtyR = colUnitR - 70;
  const descMaxW = colQtyR - 60 - colDescX;

  const drawTableHeader = (yy: number) => {
    page.drawRectangle({ x: MARGIN - 6, y: yy - 6, width: PAGE_W - MARGIN * 2 + 12, height: 22, color: rgb(0.96, 0.965, 0.975) });
    page.drawText("DESCRIPTION", { x: colDescX, y: yy, size: 8.5, font: bold, color: muted });
    const q = "QTY"; page.drawText(q, { x: colQtyR - bold.widthOfTextAtSize(q, 8.5), y: yy, size: 8.5, font: bold, color: muted });
    const u = "UNIT PRICE"; page.drawText(u, { x: colUnitR - bold.widthOfTextAtSize(u, 8.5), y: yy, size: 8.5, font: bold, color: muted });
    const t = "TOTAL"; page.drawText(t, { x: colTotalR - bold.widthOfTextAtSize(t, 8.5), y: yy, size: 8.5, font: bold, color: muted });
    return yy - 24;
  };

  // Start a fresh page when we run out of vertical room mid-table.
  const ensureRoom = (needed: number): void => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      y = drawTableHeader(y);
    }
  };

  y = drawTableHeader(y);

  for (const line of input.lines) {
    ensureRoom(20);
    const desc = clip(safe(line.description || ""), font, 10, descMaxW);
    page.drawText(desc, { x: colDescX, y, size: 10, font, color: ink });
    const qty = String(line.quantity ?? 0);
    page.drawText(qty, { x: colQtyR - font.widthOfTextAtSize(qty, 10), y, size: 10, font, color: ink });
    const unit = money(line.unitPrice ?? 0);
    page.drawText(unit, { x: colUnitR - font.widthOfTextAtSize(unit, 10), y, size: 10, font, color: ink });
    const tot = money(line.total ?? 0);
    page.drawText(tot, { x: colTotalR - font.widthOfTextAtSize(tot, 10), y, size: 10, font, color: ink });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: hairline });
    y -= 12;
  }

  // ── Totals block (right-aligned) ──
  y -= 8;
  const labelR = colUnitR; // right edge for the totals labels
  const valueR = colTotalR;
  const drawTotalRow = (label: string, value: string, boldRow = false) => {
    const f = boldRow ? bold : font;
    const sz = boldRow ? 12 : 10;
    const col = boldRow ? ink : muted;
    page.drawText(label, { x: labelR - f.widthOfTextAtSize(label, sz), y, size: sz, font: f, color: col });
    page.drawText(value, { x: valueR - f.widthOfTextAtSize(value, sz), y, size: sz, font: f, color: boldRow ? primary : ink });
    y -= boldRow ? 20 : 16;
  };
  ensureRoom(70);
  drawTotalRow("Subtotal", money(input.subtotal));
  if (input.taxRate > 0) {
    drawTotalRow(`Tax (${input.taxRate}%)`, money(input.taxAmount));
  }
  // Rule above the grand total.
  page.drawLine({ start: { x: labelR - 120, y: y + 6 }, end: { x: valueR, y: y + 6 }, thickness: 1, color: primary });
  y -= 4;
  drawTotalRow("Total", money(input.total), true);

  // ── Accepted-by line for a signed estimate ──
  if (input.signedName && input.signedAt) {
    y -= 14;
    ensureRoom(30);
    const accepted = `Accepted by ${safe(input.signedName)} on ${prettyDate(input.signedAt)}`;
    page.drawText(safe(accepted), { x: MARGIN, y, size: 10, font: bold, color: rgb(0.18, 0.49, 0.31) });
    y -= 18;
  }

  // ── Notes ──
  if (input.notes && input.notes.trim()) {
    y -= 12;
    ensureRoom(40);
    page.drawText("NOTES", { x: MARGIN, y, size: 9, font: bold, color: muted });
    y -= 15;
    // Simple word-wrap of the notes across the content width.
    const words = safe(input.notes).split(/\s+/);
    const maxW = PAGE_W - MARGIN * 2;
    let cur = "";
    for (const w of words) {
      const trial = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(trial, 9.5) > maxW && cur) {
        ensureRoom(16);
        page.drawText(cur, { x: MARGIN, y, size: 9.5, font, color: ink });
        y -= 14;
        cur = w;
      } else {
        cur = trial;
      }
    }
    if (cur) {
      ensureRoom(16);
      page.drawText(cur, { x: MARGIN, y, size: 9.5, font, color: ink });
      y -= 14;
    }
  }

  // ── Footer ──
  drawFooter(page, font, muted, input.businessName);

  return await doc.save();
}

function drawFooter(page: PDFPage, font: PDFFont, muted: ReturnType<typeof rgb>, businessName: string) {
  const text = `${safe(businessName)} · Tampa, FL · Thank you for your business`;
  page.drawText(safe(text), { x: MARGIN, y: 34, size: 8, font, color: muted });
}
