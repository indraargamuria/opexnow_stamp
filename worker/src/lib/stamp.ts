import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { qrModules, qrPng } from "./qr";
import { AppError } from "./errors";

export interface StampPlacement {
  x: number;
  y: number;
  page: number;
  width_pt: number;
  height_pt: number;
}

export interface SignInput {
  originalPdf: Uint8Array;
  serialNumber: string;
  placement: StampPlacement;
  qr?: { bytes: Uint8Array; mime: string };
}

/**
 * Local signing implementation — the stand-in for Peruri's `docSigningZ`
 * adapter inside the compute tier. It embeds the QR matrix as a vector stamp
 * at the resolved anchor position. In a real deployment this module is
 * replaced by the signadapter integration (Docker, shared filesystem I/O);
 * the interface stays identical so the pipeline does not change.
 */
export async function signPdfLocal(input: SignInput): Promise<Uint8Array> {
  const { originalPdf, serialNumber, placement, qr } = input;
  try {
    const doc = await PDFDocument.load(originalPdf);
    const page = doc.getPages()[placement.page - 1];
    if (!page) throw new AppError(400, "page_out_of_range", `Document has no page ${placement.page}`, "signing");

    let image: import("pdf-lib").PDFImage;
    if (qr && qr.bytes.length > 0) {
      image = qr.mime === "image/jpeg" ? await doc.embedJpg(qr.bytes) : await doc.embedPng(qr.bytes);
    } else {
      const png = qrPng(qrModules(serialNumber), 8);
      image = await doc.embedPng(png);
    }

    const { x, y, width_pt: w, height_pt: h } = placement;
    page.drawImage(image, { x, y: y - h, width: w, height: h });

    const brass = rgb(0.66, 0.49, 0.24);
    page.drawRectangle({ x: x - 3, y: y - h - 3, width: w + 6, height: h + 6, borderColor: brass, borderWidth: 1 });

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const navy = rgb(0.11, 0.145, 0.255);
    page.drawText("e-METERAI", { x: x - 3, y: y + 5, size: 6, font, color: navy });
    page.drawText(serialNumber, { x: x - 3, y: y - h - 10, size: 6, font, color: navy });

    return new Uint8Array(await doc.save());
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, "sign_failed", `Signing failed: ${err instanceof Error ? err.message : "unknown"}`, "signing");
  }
}

/** Alias used by the pipeline; swap the implementation to switch adapters. */
export const signWithAdapter = signPdfLocal;
