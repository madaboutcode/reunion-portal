/**
 * CONTRACT: Pass PDF generation service.
 *
 * GUARANTEE: PURE_FUNCTION — generatePassPdf() takes data and pre-loaded assets,
 *   returns PDF bytes. No I/O, no side effects. The caller (route handler) is
 *   responsible for loading assets and constructing PassData.
 *
 * GUARANTEE: CENTERED_TEXT — all text fields are horizontally centered on the page
 *   using actual font metrics, not estimated widths.
 *
 * EXPECTS: assets contain valid PDF, TTF, and field config data. Malformed inputs
 *   will throw from pdf-lib internals.
 *
 * EXPECTS: data.passUrl is a fully-formed URL (used as QR code content).
 *
 * FAILURE BEHAVIOR: Throws on any pdf-lib or qrcode failure — caller handles error.
 */

import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import qrcode from "qrcode";
import { ACCOMMODATION_LABELS, PARTICIPATION_LABELS } from "@smriti/shared";
import type { AccommodationType, ParticipationType } from "@smriti/shared";

export interface PassData {
  name: string;
  regCode: string;         // display format: "SMRT-79WW-4A25-NWG1"
  attendeeCount: number;   // total including alumni (1 + additional attendees)
  accommodation: AccommodationType;
  participationType: ParticipationType;
  passUrl: string;         // full URL for QR code
}

interface QrFieldConfig {
  centerX: number;
  y: number;
  size: number;
  padding: number;
}

interface TextField {
  centerX: number;
  y: number;
  fontSize: number;
  fontWeight: string;
  color: string;
  letterSpacing?: number;
  pill?: {
    color: string;
    paddingX: number;
    paddingY: number;
    radius: number;
  };
}

export interface FieldConfig {
  pageSize: { width: number; height: number };
  fields: {
    qr: QrFieldConfig;
    regCode: TextField;
    name: TextField;
    attendees: TextField;
    participationType: TextField;
    accommodation: TextField;
  };
}

export interface PassAssets {
  templatePdf: ArrayBuffer;
  fieldConfig: FieldConfig;
  fontBold: ArrayBuffer;
  fontSemiBold: ArrayBuffer;
  fontRegular: ArrayBuffer;
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

export async function generatePassPdf(
  data: PassData,
  assets: PassAssets,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(assets.templatePdf);
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(`Smriti 26 - Entry Pass - ${data.name}`);
  pdfDoc.setSubject("Alumni Reunion Entry Pass");
  pdfDoc.setCreator("Smriti 26");

  const dmBold = await pdfDoc.embedFont(assets.fontBold);
  const dmSemiBold = await pdfDoc.embedFont(assets.fontSemiBold);
  const dmRegular = await pdfDoc.embedFont(assets.fontRegular);

  const page = pdfDoc.getPages()[0];
  const { width: pageW, height: pageH } = page.getSize();
  const config = assets.fieldConfig;

  const sx = pageW / config.pageSize.width;
  const sy = pageH / config.pageSize.height;

  // SVG coordinate space has y=0 at top; PDF has y=0 at bottom
  function svgY(svgYCoord: number): number {
    return pageH - svgYCoord * sy;
  }

  // --- QR Code (drawn as vector rectangles — no canvas needed) ---
  const qrField = config.fields.qr;
  const qrData = qrcode.create(data.passUrl, { errorCorrectionLevel: "M" });
  const modules = qrData.modules;
  const moduleCount = modules.size;

  const innerSize = (qrField.size - qrField.padding * 2) * sx;
  const qrOriginX = (pageW - innerSize) / 2;
  const qrOriginY = pageH - (qrField.y + qrField.padding) * sy - innerSize;
  const cellSize = innerSize / moduleCount;
  const darkColor = hexToRgb("#1F2A33");

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules.get(row, col)) {
        page.drawRectangle({
          x: qrOriginX + col * cellSize,
          y: qrOriginY + (moduleCount - 1 - row) * cellSize,
          width: cellSize,
          height: cellSize,
          color: darkColor,
        });
      }
    }
  }

  // --- Centered text helper ---
  type EmbeddedFont = typeof dmBold;

  function drawCenteredText(
    text: string,
    field: TextField,
    font: EmbeddedFont,
  ) {
    const fontSizePt = field.fontSize * sy;
    const charSpacing = (field.letterSpacing ?? 0) * sx;
    let textWidth = font.widthOfTextAtSize(text, fontSizePt);
    if (charSpacing > 0) textWidth += charSpacing * (text.length - 1);

    page.drawText(text, {
      x: (pageW - textWidth) / 2,
      y: svgY(field.y),
      size: fontSizePt,
      font,
      color: hexToRgb(field.color),
      ...(charSpacing > 0 ? { characterSpacing: charSpacing } : {}),
    });
  }

  // --- Reg code with pill background ---
  const rcField = config.fields.regCode;
  if (rcField.pill) {
    const fontSizePt = rcField.fontSize * sy;
    const charSpacing = (rcField.letterSpacing ?? 0) * sx;
    const textWidth =
      dmBold.widthOfTextAtSize(data.regCode, fontSizePt) +
      charSpacing * (data.regCode.length - 1);
    const pillPaddingX = rcField.pill.paddingX * sx;
    const pillPaddingY = rcField.pill.paddingY * sy;
    const pillW = textWidth + pillPaddingX * 2;
    const pillH = fontSizePt + pillPaddingY * 2;
    page.drawRectangle({
      x: (pageW - pillW) / 2,
      y: svgY(rcField.y) - pillH * 0.3,
      width: pillW,
      height: pillH,
      color: rgb(185 / 255, 223 / 255, 226 / 255),
      opacity: 0.25,
    });
  }
  drawCenteredText(data.regCode, rcField, dmBold);

  // --- Name ---
  drawCenteredText(data.name, config.fields.name, dmBold);

  // --- Attendees ---
  const attendeeText =
    data.attendeeCount === 1
      ? "1 Attendee"
      : `${data.attendeeCount} Attendees`;
  drawCenteredText(attendeeText, config.fields.attendees, dmSemiBold);

  // --- Participation type ---
  const participationText = PARTICIPATION_LABELS[data.participationType] ?? data.participationType;
  drawCenteredText(participationText, config.fields.participationType, dmRegular);

  // --- Accommodation (omit for "none") ---
  if (data.accommodation !== "none") {
    const accomText = `Accommodation: ${ACCOMMODATION_LABELS[data.accommodation]}`;
    drawCenteredText(accomText, config.fields.accommodation, dmRegular);
  }

  return pdfDoc.save();
}
