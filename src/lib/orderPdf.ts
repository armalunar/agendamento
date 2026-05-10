import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BUSINESS_LOGO_PATH, BUSINESS_NAME, PIX_COPY_PASTE } from "./business";
import { formatBRL } from "./catalog";
import { formatDateBR, formatDateTimeBR } from "./date";
import { buildSystemProfileList, getEquipmentLabel } from "./deviceProfile";
import {
  buildCompletionLabel,
  buildDeliveryStatusLabel,
  buildPaymentMethodLabel,
  buildPaymentStatusLabel,
  buildServicePriceLabel,
  type OrderRecord
} from "./orderShared";

export type OrderPdfVersion = "initial" | "completion";

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_SIZE: [number, number] = [PAGE_WIDTH, PAGE_HEIGHT];
const PAGE_MARGIN = 26;
const HEADER_HEIGHT = 68;
const FOOTER_HEIGHT = 18;
const PANEL_GAP = 12;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const BODY_TOP = PAGE_HEIGHT - PAGE_MARGIN - HEADER_HEIGHT - 12;
const BODY_BOTTOM = PAGE_MARGIN + FOOTER_HEIGHT + 8;
const BODY_HEIGHT = BODY_TOP - BODY_BOTTOM;
const LEFT_WIDTH = 474;
const RIGHT_WIDTH = CONTENT_WIDTH - LEFT_WIDTH - PANEL_GAP;
const RIGHT_X = PAGE_MARGIN + LEFT_WIDTH + PANEL_GAP;
const SUMMARY_HEIGHT = 122;
const SERVICES_HEIGHT = 112;
const SYSTEM_HEIGHT = BODY_HEIGHT - SUMMARY_HEIGHT - SERVICES_HEIGHT - PANEL_GAP * 2;
const ISSUE_HEIGHT = 118;
const SIDE_BOTTOM_HEIGHT = BODY_HEIGHT - ISSUE_HEIGHT - PANEL_GAP;
const QR_SIZE = 126;
const HEADER_LOGO_SIZE = 48;

type PdfColor = [number, number, number];
type EmbeddedPng = Awaited<ReturnType<PDFDocument["embedPng"]>>;

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
};

type PanelBody = {
  x: number;
  yTop: number;
  width: number;
  height: number;
};

const COLORS = {
  white: [1, 1, 1] as PdfColor,
  black: [0.05, 0.05, 0.05] as PdfColor,
  gray: [0.35, 0.35, 0.35] as PdfColor,
  line: [0, 0, 0] as PdfColor,
  lightLine: [0.72, 0.72, 0.72] as PdfColor,
  fill: [0.97, 0.97, 0.97] as PdfColor,
  fillSoft: [0.985, 0.985, 0.985] as PdfColor
};

function toColor(color: PdfColor) {
  return rgb(color[0], color[1], color[2]);
}

function splitLongToken(token: string, font: PDFFont, size: number, maxWidth: number) {
  const parts: string[] = [];
  let current = "";

  for (const char of token) {
    const candidate = current + char;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      parts.push(current);
    }

    current = char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/);
    let current = "";

    for (const rawWord of words) {
      const tokens = font.widthOfTextAtSize(rawWord, size) > maxWidth ? splitLongToken(rawWord, font, size, maxWidth) : [rawWord];

      for (const token of tokens) {
        const candidate = current ? `${current} ${token}` : token;

        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
          continue;
        }

        if (current) {
          lines.push(current);
        }

        current = token;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function fitLine(line: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(line, size) <= maxWidth) {
    return line;
  }

  let trimmed = line;

  while (trimmed.length > 1 && font.widthOfTextAtSize(`${trimmed}...`, size) > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }

  return `${trimmed}...`;
}

function drawTextBlock(
  page: PDFPage,
  text: string,
  {
    x,
    y,
    width,
    font,
    size,
    color,
    lineGap = 2,
    maxLines
  }: {
    x: number;
    y: number;
    width: number;
    font: PDFFont;
    size: number;
    color: PdfColor;
    lineGap?: number;
    maxLines?: number;
  }
) {
  const allLines = wrapText(text, font, size, width);
  const lines =
    typeof maxLines === "number" && allLines.length > maxLines
      ? [...allLines.slice(0, maxLines - 1), fitLine(allLines[maxLines - 1], font, size, width)]
      : allLines;
  let cursor = y;

  for (const line of lines) {
    page.drawText(line, {
      x,
      y: cursor,
      size,
      font,
      color: toColor(color)
    });
    cursor -= size + lineGap;
  }

  return cursor;
}

function statusLabel(status: OrderRecord["status"]) {
  if (status === "completed") return "CONCLUÍDA";
  if (status === "cancelled") return "CANCELADA";
  return "ABERTA";
}

function drawBase(page: PDFPage) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: toColor(COLORS.white)
  });

  page.drawRectangle({
    x: PAGE_MARGIN,
    y: PAGE_MARGIN,
    width: CONTENT_WIDTH,
    height: PAGE_HEIGHT - PAGE_MARGIN * 2,
    borderColor: toColor(COLORS.line),
    borderWidth: 1
  });
}

function drawHeader(page: PDFPage, fonts: Fonts, order: OrderRecord, version: OrderPdfVersion, brandLogo: EmbeddedPng) {
  const headerBottom = PAGE_HEIGHT - PAGE_MARGIN - HEADER_HEIGHT;
  const paymentMethodLabel = buildPaymentMethodLabel(order.payment.method);
  const title = version === "completion" ? "Relatório técnico de conclusão" : "Ordem técnica de serviço";
  const subtitle =
    version === "completion"
      ? "Documento final do atendimento."
      : order.payment.method === "pix"
        ? "Documento inicial do atendimento com cobrança via Pix."
        : `Documento inicial do atendimento com pagamento em ${paymentMethodLabel.toLowerCase()}.`;

  page.drawRectangle({
    x: PAGE_MARGIN,
    y: headerBottom,
    width: CONTENT_WIDTH,
    height: HEADER_HEIGHT,
    color: toColor(COLORS.black)
  });

  page.drawText(BUSINESS_NAME, {
    x: PAGE_MARGIN + 18,
    y: PAGE_HEIGHT - PAGE_MARGIN - 28,
    size: 24,
    font: fonts.bold,
    color: toColor(COLORS.white)
  });

  page.drawText(title, {
    x: PAGE_MARGIN + 18,
    y: PAGE_HEIGHT - PAGE_MARGIN - 45,
    size: 10.5,
    font: fonts.regular,
    color: toColor(COLORS.white)
  });

  page.drawText(subtitle, {
    x: PAGE_MARGIN + 18,
    y: PAGE_HEIGHT - PAGE_MARGIN - 62,
    size: 8.5,
    font: fonts.regular,
    color: toColor(COLORS.white)
  });

  const logoX = PAGE_WIDTH - PAGE_MARGIN - 18 - HEADER_LOGO_SIZE;
  const logoY = PAGE_HEIGHT - PAGE_MARGIN - 10 - HEADER_LOGO_SIZE;
  const rightInfoMaxX = logoX - 14;

  page.drawImage(brandLogo, {
    x: logoX,
    y: logoY,
    width: HEADER_LOGO_SIZE,
    height: HEADER_LOGO_SIZE
  });

  const folio = "FOLHA 01/01";
  const folioWidth = fonts.mono.widthOfTextAtSize(folio, 8.5);
  page.drawText(folio, {
    x: rightInfoMaxX - folioWidth,
    y: PAGE_HEIGHT - PAGE_MARGIN - 16,
    size: 8.5,
    font: fonts.mono,
    color: toColor(COLORS.white)
  });

  const orderWidth = fonts.monoBold.widthOfTextAtSize(order.orderCode, 16);
  page.drawText(order.orderCode, {
    x: rightInfoMaxX - orderWidth,
    y: PAGE_HEIGHT - PAGE_MARGIN - 38,
    size: 16,
    font: fonts.monoBold,
    color: toColor(COLORS.white)
  });

  const status = statusLabel(order.status);
  const statusWidth = fonts.monoBold.widthOfTextAtSize(status, 8.5);
  const badgeWidth = statusWidth + 20;
  const badgeX = rightInfoMaxX - badgeWidth;
  const badgeY = PAGE_HEIGHT - PAGE_MARGIN - 57;

  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeWidth,
    height: 22,
    borderColor: toColor(COLORS.white),
    borderWidth: 1
  });

  page.drawText(status, {
    x: badgeX + 10,
    y: badgeY + 7,
    size: 8.5,
    font: fonts.monoBold,
    color: toColor(COLORS.white)
  });
}

function drawPanel(
  page: PDFPage,
  fonts: Fonts,
  {
    x,
    top,
    width,
    height,
    title,
    fill = COLORS.white
  }: {
    x: number;
    top: number;
    width: number;
    height: number;
    title: string;
    fill?: PdfColor;
  }
) {
  const y = top - height;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: toColor(fill),
    borderColor: toColor(COLORS.line),
    borderWidth: 1
  });

  page.drawRectangle({
    x,
    y: top - 22,
    width,
    height: 22,
    color: toColor(COLORS.fill)
  });

  page.drawLine({
    start: { x, y: top - 22 },
    end: { x: x + width, y: top - 22 },
    thickness: 1,
    color: toColor(COLORS.line)
  });

  page.drawText(title.toUpperCase(), {
    x: x + 12,
    y: top - 15,
    size: 8,
    font: fonts.monoBold,
    color: toColor(COLORS.black)
  });

  return {
    x: x + 12,
    yTop: top - 34,
    width: width - 24,
    height: height - 46
  } satisfies PanelBody;
}

function drawField(
  page: PDFPage,
  fonts: Fonts,
  {
    label,
    value,
    x,
    y,
    width,
    valueSize = 11,
    font = fonts.bold,
    maxLines = 2,
    gapAfter = 10
  }: {
    label: string;
    value: string;
    x: number;
    y: number;
    width: number;
    valueSize?: number;
    font?: PDFFont;
    maxLines?: number;
    gapAfter?: number;
  }
) {
  page.drawText(label.toUpperCase(), {
    x,
    y,
    size: 7.6,
    font: fonts.monoBold,
    color: toColor(COLORS.gray)
  });

  const endY = drawTextBlock(page, value, {
    x,
    y: y - 13,
    width,
    font,
    size: valueSize,
    color: COLORS.black,
    lineGap: 2,
    maxLines
  });

  return endY - gapAfter;
}

function drawSummaryPanel(page: PDFPage, fonts: Fonts, order: OrderRecord) {
  const panel = drawPanel(page, fonts, {
    x: PAGE_MARGIN,
    top: BODY_TOP,
    width: LEFT_WIDTH,
    height: SUMMARY_HEIGHT,
    title: "Identificação e cliente"
  });

  const leftWidth = 230;
  const rightX = panel.x + leftWidth + 20;
  const rightWidth = panel.width - leftWidth - 20;
  let leftY = panel.yTop;
  let rightY = panel.yTop;

  leftY = drawField(page, fonts, {
    label: "Cliente",
    value: order.customer.name,
    x: panel.x,
    y: leftY,
    width: leftWidth,
    valueSize: 13.5,
    maxLines: 2
  });
  leftY = drawField(page, fonts, {
    label: "Cidade / bairro",
    value: order.customer.city,
    x: panel.x,
    y: leftY,
    width: leftWidth
  });
  drawField(page, fonts, {
    label: "Ordem",
    value: order.orderCode,
    x: panel.x,
    y: leftY,
    width: leftWidth,
    font: fonts.monoBold,
    valueSize: 10.5
  });

  rightY = drawField(page, fonts, {
    label: "WhatsApp",
    value: order.customer.phone,
    x: rightX,
    y: rightY,
    width: rightWidth
  });
  rightY = drawField(page, fonts, {
    label: "Agendamento",
    value: `${formatDateBR(order.schedule.date)} as ${order.schedule.slot}`,
    x: rightX,
    y: rightY,
    width: rightWidth
  });
  rightY = drawField(page, fonts, {
    label: "Status",
    value: statusLabel(order.status),
    x: rightX,
    y: rightY,
    width: rightWidth
  });
  drawField(page, fonts, {
    label: "Pagamento",
    value: `${buildPaymentStatusLabel(order.payment.status)} | ${buildPaymentMethodLabel(order.payment.method)}`,
    x: rightX,
    y: rightY,
    width: rightWidth
  });
}

function drawServicesPanel(page: PDFPage, fonts: Fonts, order: OrderRecord) {
  const top = BODY_TOP - SUMMARY_HEIGHT - PANEL_GAP;
  const panel = drawPanel(page, fonts, {
    x: PAGE_MARGIN,
    top,
    width: LEFT_WIDTH,
    height: SERVICES_HEIGHT,
    title: "Serviços e equipamento",
    fill: COLORS.fillSoft
  });

  const leftWidth = 200;
  const rightX = panel.x + leftWidth + 18;
  const rightWidth = panel.width - leftWidth - 18;
  let leftY = panel.yTop;

  leftY = drawField(page, fonts, {
    label: "Equipamento",
    value: getEquipmentLabel(order.customer.equipment),
    x: panel.x,
    y: leftY,
    width: leftWidth
  });
  leftY = drawField(page, fonts, {
    label: "Total final",
    value: formatBRL(order.total),
    x: panel.x,
    y: leftY,
    width: leftWidth,
    valueSize: 14
  });
  drawField(page, fonts, {
    label: "Cupom",
    value: order.pricing.couponCode || "Nenhum",
    x: panel.x,
    y: leftY,
    width: leftWidth,
    valueSize: 10
  });

  page.drawText("SERVIÇOS SOLICITADOS", {
    x: rightX,
    y: panel.yTop,
    size: 7.6,
    font: fonts.monoBold,
    color: toColor(COLORS.gray)
  });

  drawTextBlock(
    page,
    order.services.map((service) => `- ${service.name} | ${buildServicePriceLabel(service)}`).join("\n"),
    {
      x: rightX,
      y: panel.yTop - 13,
      width: rightWidth,
      font: fonts.regular,
      size: 10.2,
      color: COLORS.black,
      lineGap: 2,
      maxLines: 5
    }
  );
}

function drawSystemPanel(page: PDFPage, fonts: Fonts, order: OrderRecord) {
  const top = BODY_TOP - SUMMARY_HEIGHT - PANEL_GAP - SERVICES_HEIGHT - PANEL_GAP;
  const panel = drawPanel(page, fonts, {
    x: PAGE_MARGIN,
    top,
    width: LEFT_WIDTH,
    height: SYSTEM_HEIGHT,
    title: "Ficha técnica informada"
  });

  const items = buildSystemProfileList(order.customer.systemProfile);
  const columns = 2;
  const rows = Math.ceil(items.length / columns);
  const columnGap = 12;
  const rowGap = 10;
  const cellWidth = (panel.width - columnGap) / columns;
  const cellHeight = (panel.height - rowGap * (rows - 1)) / rows;

  items.forEach((item, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = panel.x + column * (cellWidth + columnGap);
    const yTop = panel.yTop - row * (cellHeight + rowGap);

    page.drawRectangle({
      x,
      y: yTop - cellHeight,
      width: cellWidth,
      height: cellHeight,
      color: toColor(COLORS.fillSoft),
      borderColor: toColor(COLORS.lightLine),
      borderWidth: 1
    });

    page.drawText(item.label.toUpperCase(), {
      x: x + 10,
      y: yTop - 14,
      size: 7.2,
      font: fonts.monoBold,
      color: toColor(COLORS.gray)
    });

    drawTextBlock(page, item.value, {
      x: x + 10,
      y: yTop - 30,
      width: cellWidth - 20,
      font: fonts.bold,
      size: 9.8,
      color: COLORS.black,
      lineGap: 2,
      maxLines: 2
    });
  });
}

function drawIssuePanel(page: PDFPage, fonts: Fonts, order: OrderRecord) {
  const panel = drawPanel(page, fonts, {
    x: RIGHT_X,
    top: BODY_TOP,
    width: RIGHT_WIDTH,
    height: ISSUE_HEIGHT,
    title: "Relato do cliente"
  });

  drawTextBlock(page, order.customer.issue, {
    x: panel.x,
    y: panel.yTop,
    width: panel.width,
    font: fonts.regular,
    size: 10.6,
    color: COLORS.black,
    lineGap: 2,
    maxLines: 6
  });
}

async function loadQrImageBytes() {
  const qrPath = path.join(process.cwd(), "public", "qr-code-pix.png");
  return readFile(qrPath);
}

async function loadBrandLogoBytes() {
  const logoPath = path.join(process.cwd(), "public", BUSINESS_LOGO_PATH.replace(/^\//, ""));
  return readFile(logoPath);
}

function drawPixPanel(page: PDFPage, fonts: Fonts, order: OrderRecord, qrImage: EmbeddedPng) {
  const top = BODY_TOP - ISSUE_HEIGHT - PANEL_GAP;
  const panel = drawPanel(page, fonts, {
    x: RIGHT_X,
    top,
    width: RIGHT_WIDTH,
    height: SIDE_BOTTOM_HEIGHT,
    title: "Pagamento Pix",
    fill: COLORS.fillSoft
  });

  const valueY = drawField(page, fonts, {
    label: "Valor previsto",
    value: formatBRL(order.total),
    x: panel.x,
    y: panel.yTop,
    width: panel.width,
    valueSize: 14,
    gapAfter: 6
  });

  page.drawText("QR CODE", {
    x: panel.x,
    y: valueY,
    size: 7.4,
    font: fonts.monoBold,
    color: toColor(COLORS.gray)
  });

  const qrYTop = valueY - 10;
  page.drawRectangle({
    x: panel.x,
    y: qrYTop - QR_SIZE,
    width: QR_SIZE,
    height: QR_SIZE,
    color: toColor(COLORS.white),
    borderColor: toColor(COLORS.line),
    borderWidth: 1
  });

  page.drawImage(qrImage, {
    x: panel.x + 8,
    y: qrYTop - QR_SIZE + 8,
    width: QR_SIZE - 16,
    height: QR_SIZE - 16
  });

  const codeX = panel.x + QR_SIZE + 14;
  const codeWidth = panel.width - QR_SIZE - 14;

  page.drawText("CÓDIGO PIX COPIA E COLA", {
    x: codeX,
    y: valueY,
    size: 7.4,
    font: fonts.monoBold,
    color: toColor(COLORS.gray)
  });

  page.drawRectangle({
    x: codeX,
    y: qrYTop - QR_SIZE,
    width: codeWidth,
    height: QR_SIZE,
    color: toColor(COLORS.white),
    borderColor: toColor(COLORS.lightLine),
    borderWidth: 1
  });

  drawTextBlock(page, PIX_COPY_PASTE, {
    x: codeX + 10,
    y: qrYTop - 14,
    width: codeWidth - 20,
    font: fonts.mono,
    size: 6.7,
    color: COLORS.black,
    lineGap: 1.6,
    maxLines: 11
  });

  drawTextBlock(page, "Use este QR ou o código ao lado somente no envio da ordem para o cliente.", {
    x: panel.x,
    y: qrYTop - QR_SIZE - 18,
    width: panel.width,
    font: fonts.regular,
    size: 8.3,
    color: COLORS.gray,
    lineGap: 2,
    maxLines: 2
  });
}

function drawPaymentMethodPanel(page: PDFPage, fonts: Fonts, order: OrderRecord) {
  const top = BODY_TOP - ISSUE_HEIGHT - PANEL_GAP;
  const panel = drawPanel(page, fonts, {
    x: RIGHT_X,
    top,
    width: RIGHT_WIDTH,
    height: SIDE_BOTTOM_HEIGHT,
    title: "Pagamento",
    fill: COLORS.fillSoft
  });

  let cursor = drawField(page, fonts, {
    label: "Valor previsto",
    value: formatBRL(order.total),
    x: panel.x,
    y: panel.yTop,
    width: panel.width,
    valueSize: 14,
    gapAfter: 10
  });

  cursor = drawField(page, fonts, {
    label: "Método escolhido",
    value: buildPaymentMethodLabel(order.payment.method),
    x: panel.x,
    y: cursor,
    width: panel.width,
    valueSize: 11,
    gapAfter: 10
  });

  cursor = drawField(page, fonts, {
    label: "Situação atual",
    value: `${buildPaymentStatusLabel(order.payment.status)} | ${formatBRL(order.payment.amountPaid)} pago`,
    x: panel.x,
    y: cursor,
    width: panel.width,
    valueSize: 10.5,
    gapAfter: 12
  });

  page.drawRectangle({
    x: panel.x,
    y: BODY_BOTTOM + 10,
    width: panel.width,
    height: cursor - (BODY_BOTTOM + 10),
    color: toColor(COLORS.white),
    borderColor: toColor(COLORS.lightLine),
    borderWidth: 1
  });

  drawTextBlock(
    page,
    `Forma de pagamento registrada para esta ordem: ${buildPaymentMethodLabel(order.payment.method)}.\n\nO recebimento poderá ser confirmado no fechamento do atendimento, junto com as observações técnicas e a entrega.`,
    {
      x: panel.x + 10,
      y: cursor - 14,
      width: panel.width - 20,
      font: fonts.regular,
      size: 9.4,
      color: COLORS.black,
      lineGap: 2,
      maxLines: 7
    }
  );
}

function buildCompletionText(order: OrderRecord) {
  const sections = [
    order.completion.clientNotes ? `Observações ao cliente: ${order.completion.clientNotes}` : "",
    order.completion.diagnosis ? `Diagnóstico: ${order.completion.diagnosis}` : "",
    order.completion.solution ? `Solução aplicada: ${order.completion.solution}` : "",
    order.completion.checklist ? `Checklist final: ${order.completion.checklist}` : "",
    order.completion.warranty ? `Garantia / observação: ${order.completion.warranty}` : "",
    `Pagamento: ${buildPaymentStatusLabel(order.payment.status)} via ${buildPaymentMethodLabel(order.payment.method)} (${formatBRL(order.payment.amountPaid)} pago).`,
    `Entrega: ${buildDeliveryStatusLabel(order.delivery.status)}.`
  ].filter(Boolean);

  return sections.join("\n\n") || "Atendimento finalizado sem observações adicionais.";
}

function drawCompletionPanel(page: PDFPage, fonts: Fonts, order: OrderRecord) {
  const top = BODY_TOP - ISSUE_HEIGHT - PANEL_GAP;
  const panel = drawPanel(page, fonts, {
    x: RIGHT_X,
    top,
    width: RIGHT_WIDTH,
    height: SIDE_BOTTOM_HEIGHT,
    title: "Fechamento técnico",
    fill: COLORS.fillSoft
  });

  const notesY = drawField(page, fonts, {
    label: "Concluído em",
    value: buildCompletionLabel(order),
    x: panel.x,
    y: panel.yTop,
    width: panel.width,
    valueSize: 11,
    gapAfter: 10
  });

  const deliveryY = drawField(page, fonts, {
    label: "Entrega",
    value: buildDeliveryStatusLabel(order.delivery.status),
    x: panel.x,
    y: notesY,
    width: panel.width,
    valueSize: 10,
    gapAfter: 8
  });

  page.drawText("OBSERVAÇÕES TÉCNICAS", {
    x: panel.x,
    y: deliveryY,
    size: 7.6,
    font: fonts.monoBold,
    color: toColor(COLORS.gray)
  });

  const notesBoxTop = deliveryY - 10;
  const notesBoxHeight = notesBoxTop - (BODY_BOTTOM + 6);

  page.drawRectangle({
    x: panel.x,
    y: notesBoxTop - notesBoxHeight,
    width: panel.width,
    height: notesBoxHeight,
    color: toColor(COLORS.white),
    borderColor: toColor(COLORS.lightLine),
    borderWidth: 1
  });

  drawTextBlock(page, buildCompletionText(order), {
    x: panel.x + 10,
    y: notesBoxTop - 14,
    width: panel.width - 20,
    font: fonts.regular,
    size: 10.2,
    color: COLORS.black,
    lineGap: 2.3,
    maxLines: 12
  });
}

function drawFooter(page: PDFPage, fonts: Fonts) {
  page.drawLine({
    start: { x: PAGE_MARGIN, y: PAGE_MARGIN + FOOTER_HEIGHT },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y: PAGE_MARGIN + FOOTER_HEIGHT },
    thickness: 1,
    color: toColor(COLORS.line)
  });

  const generatedAt = `Gerado em ${formatDateTimeBR(new Date().toISOString())}`;
  const textWidth = fonts.mono.widthOfTextAtSize(generatedAt, 8);

  page.drawText(generatedAt, {
    x: PAGE_WIDTH - PAGE_MARGIN - textWidth,
    y: PAGE_MARGIN + 6,
    size: 8,
    font: fonts.mono,
    color: toColor(COLORS.gray)
  });
}

export async function generateOrderPdf(order: OrderRecord, version: OrderPdfVersion) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PAGE_SIZE);
  const fonts: Fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    mono: await pdfDoc.embedFont(StandardFonts.Courier),
    monoBold: await pdfDoc.embedFont(StandardFonts.CourierBold)
  };
  const brandLogo = await pdfDoc.embedPng(await loadBrandLogoBytes());

  drawBase(page);
  drawHeader(page, fonts, order, version, brandLogo);
  drawSummaryPanel(page, fonts, order);
  drawServicesPanel(page, fonts, order);
  drawSystemPanel(page, fonts, order);
  drawIssuePanel(page, fonts, order);

  if (version === "initial") {
    if (order.payment.method === "pix") {
      const qrImage = await pdfDoc.embedPng(await loadQrImageBytes());
      drawPixPanel(page, fonts, order, qrImage);
    } else {
      drawPaymentMethodPanel(page, fonts, order);
    }
  } else {
    drawCompletionPanel(page, fonts, order);
  }

  drawFooter(page, fonts);

  return pdfDoc.save();
}
