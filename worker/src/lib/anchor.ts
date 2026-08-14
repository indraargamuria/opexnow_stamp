import type { ExtractedDocument } from "./pdf";
import type { TemplateConfig } from "./db";

export const CM_TO_PT = 28.3465;
export const MM_TO_PT = 2.83465;

// Maximum allowed offset values to prevent stamps outside page boundaries
const MAX_OFFSET_PT = 1000; // ~35cm
const STAMP_SIZE_PT = 150; // Approximate stamp size in points

export interface AnchorResolution {
  matched: boolean;
  keyword: string | null;
  used_default: boolean;
  page: number;
  x: number;
  y: number;
  confidence: "high" | "low";
}

function normalize(s: string): string {
  // Fix: Better normalization for Indonesian text and invoice patterns
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace special chars with spaces
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .replace(/\b\d+\b/g, '#')  // Normalize numbers for pattern matching
    .trim();
}

/**
 * Calculate confidence score based on match quality
 */
function calculateMatchQuality(keyword: string, text: string): number {
  const normalizedKw = normalize(keyword);
  const normalizedText = normalize(text);

  if (normalizedText === normalizedKw) return 1.0; // Exact match
  if (normalizedText.includes(' ' + normalizedKw + ' ')) return 0.9; // Word boundary match
  if (normalizedText.startsWith(normalizedKw)) return 0.8; // Starts with
  if (normalizedText.endsWith(normalizedKw)) return 0.8; // Ends with
  if (normalizedText.includes(normalizedKw)) return 0.6; // Contains (lower confidence)

  return 0;
}

/**
 * Validate position is within page boundaries
 */
function validatePosition(x: number, y: number, pageWidth: number, pageHeight: number): { valid: boolean; adjustedX: number; adjustedY: number } {
  // Ensure stamp doesn't go outside page boundaries
  let adjustedX = Math.max(0, Math.min(x, pageWidth - STAMP_SIZE_PT));
  let adjustedY = Math.max(STAMP_SIZE_PT, Math.min(y, pageHeight));

  const valid = x >= 0 && x <= pageWidth && y >= 0 && y <= pageHeight;

  return { valid, adjustedX, adjustedY };
}

/**
 * Walk the template's ordered anchor list against the document's extracted
 * text lines; first keyword match wins. The resolved point is the top-left
 * of the stamp box in PDF user-space (y-up, points).
 *
 * "dx_pt" moves the box right (+x), "dy_pt" moves it down (-y in PDF space),
 * measured from the end of the matching line.
 */
export function resolveAnchor(config: TemplateConfig, doc: ExtractedDocument): AnchorResolution {
  // Find the best matching anchor across all anchors and lines
  let bestMatch: {
    keyword: string;
    page: number;
    x: number;
    y: number;
    quality: number;
    line: any;
  } | null = null;

  for (const anchor of config.anchors) {
    const kw = normalize(anchor.keyword);
    if (!kw || kw.length < 2) continue; // Skip very short keywords

    // Validate offset values
    const dx = Math.abs(anchor.dx_pt) < MAX_OFFSET_PT ? anchor.dx_pt : 0;
    const dy = Math.abs(anchor.dy_pt) < MAX_OFFSET_PT ? anchor.dy_pt : 0;

    for (const line of doc.lines) {
      const matchQuality = calculateMatchQuality(anchor.keyword, line.text);

      if (matchQuality > 0.5) { // Only consider matches with reasonable quality
        const rawX = line.x + line.width + dx;
        const rawY = line.y - dy;

        // Get page dimensions for boundary validation
        const pageInfo = doc.pages.find(p => p.index === line.page);
        const pageWidth = pageInfo?.width ?? 612; // Default to Letter width
        const pageHeight = pageInfo?.height ?? 792; // Default to Letter height

        const position = validatePosition(rawX, rawY, pageWidth, pageHeight);

        // Track best match
        if (!bestMatch || matchQuality > bestMatch.quality) {
          bestMatch = {
            keyword: anchor.keyword,
            page: line.page,
            x: position.adjustedX,
            y: position.adjustedY,
            quality: matchQuality,
            line,
          };
        }
      }
    }

    // If we found a good match, use it (first anchor with good match wins)
    if (bestMatch && bestMatch.quality >= 0.8) {
      return {
        matched: true,
        keyword: bestMatch.keyword,
        used_default: false,
        page: bestMatch.page,
        x: bestMatch.x,
        y: bestMatch.y,
        confidence: bestMatch.quality >= 0.9 ? "high" : "low",
      };
    }
  }

  // Fallback to default position
  const d = config.default_position;
  const pageInfo = doc.pages.find(p => p.index === d.page);
  const pageWidth = pageInfo?.width ?? 612;
  const pageHeight = pageInfo?.height ?? 792;

  const defaultPosition = validatePosition(d.x, d.y, pageWidth, pageHeight);

  return {
    matched: false,
    keyword: null,
    used_default: true,
    page: d.page,
    x: defaultPosition.adjustedX,
    y: defaultPosition.adjustedY,
    confidence: "low",
  };
}
