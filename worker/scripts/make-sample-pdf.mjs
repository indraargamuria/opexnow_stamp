import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", ".samples");
fs.mkdirSync(outDir, { recursive: true });

/**
 * Generates a realistic-looking single-page invoice PDF with a text layer
 * (used as the template sample and as the document to stamp in demos/tests).
 */
export async function makeSampleInvoice(options = {}) {
  const { invoiceNumber = "INV-2026-0001", value = 1250000, includeNotes = true } = options;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoiceNumber}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const navy = rgb(0.11, 0.145, 0.255);
  const grey = rgb(0.34, 0.36, 0.41);

  page.drawText("PT DEMO ELEKTRIK NUSANTARA", { x: 50, y: 780, size: 16, font: bold, color: navy });
  page.drawText("Jl. Raya Industri No. 17, Bekasi Barat", { x: 50, y: 762, size: 9, font, color: grey });
  page.drawText("info@demoelektrik.co.id  |  (021) 555-0199", { x: 50, y: 750, size: 9, font, color: grey });

  page.drawText("TAX INVOICE", { x: 430, y: 795, size: 13, font: bold, color: navy });
  page.drawText("Nomor: " + invoiceNumber, { x: 430, y: 780, size: 9, font });

  page.drawText("Ditujukan Kepada:", { x: 50, y: 705, size: 9, font: bold });
  page.drawText("PT Mitra Niaga Sejahtera", { x: 50, y: 690, size: 9, font });
  page.drawText("NPWP: 01.234.567.8-012.000", { x: 50, y: 677, size: 9, font });

  const tableTop = 630;
  page.drawRectangle({ x: 50, y: tableTop - 18, width: 495, height: 18, color: rgb(0.93, 0.93, 0.93) });
  const cols = [
    { x: 55, text: "Deskripsi" },
    { x: 380, text: "Qty" },
    { x: 440, text: "Harga" },
    { x: 500, text: "Jumlah" },
  ];
  for (const c of cols) page.drawText(c.text, { x: c.x, y: tableTop - 13, size: 8, font: bold });

  const rows = [
    ["Kabel Listrik NYM 3x2.5mm (rol)", "2", "650000", "1300000"],
    ["Stop Kontak 5 lubang", "10", "18500", "185000"],
    ["Pipa Conduit 3/4 inch (btg)", "12", "24000", "288000"],
    ["Instalasi & Jasa Pemasangan", "1", "775000", "775000"],
  ];
  let y = tableTop - 36;
  for (const r of rows) {
    page.drawText(r[0], { x: 55, y, size: 8, font });
    page.drawText(r[1], { x: 385, y, size: 8, font });
    page.drawText(r[2], { x: 445, y, size: 8, font });
    page.drawText(r[3], { x: 505, y, size: 8, font });
    y -= 16;
  }

  page.drawRectangle({ x: 50, y: y - 8, width: 495, height: 0.75, color: grey });
  y -= 26;
  page.drawText("Subtotal", { x: 430, y, size: 9, font });
  page.drawText("2.548.000", { x: 505, y, size: 9, font });
  y -= 16;
  page.drawText("PPN 11%", { x: 430, y, size: 9, font });
  page.drawText("280.280", { x: 505, y, size: 9, font });

  y -= 24;
  page.drawText("Total Amount", { x: 430, y: y + 4, size: 10, font: bold, color: navy });
  page.drawText("2.828.280", { x: 505, y: y + 4, size: 10, font: bold, color: navy });

  if (includeNotes) {
    page.drawText("Notes", { x: 50, y: y - 18, size: 9, font: bold });
    page.drawText("Pembayaran ditransfer ke rekening BCA 1234567890 a.n. PT Demo Elektrik.", {
      x: 50,
      y: y - 34,
      size: 8,
      font,
      color: grey,
    });
  }

  page.drawText(`Dibuat pada ${new Date().toISOString().slice(0, 10)} — dokumen contoh untuk OpexNow Stamp.`, {
    x: 50,
    y: 40,
    size: 7,
    font,
    color: grey,
  });

  return new Uint8Array(await doc.save());
}

async function main() {
  const pdf = await makeSampleInvoice();
  const file = path.join(outDir, "invoice-sample.pdf");
  fs.writeFileSync(file, pdf);
  console.log("Wrote", file, pdf.length, "bytes");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
