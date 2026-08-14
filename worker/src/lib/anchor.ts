import type { ExtractedDocument } from "./pdf";
import type { TemplateConfig } from "./db";

export const CM_TO_PT = 28.3465;
export const MM_TO_PT = 2.83465;

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
  return s.toLowerCase().replace(/\s+/g, " ").trim();
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
  for (const anchor of config.anchors) {
    const kw = normalize(anchor.keyword);
    if (!kw) continue;
    for (const line of doc.lines) {
      if (normalize(line.text).includes(kw)) {
        return {
          matched: true,
          keyword: anchor.keyword,
          used_default: false,
          page: line.page,
          x: line.x + line.width + anchor.dx_pt,
          y: line.y - anchor.dy_pt,
          confidence: "high",
        };
      }
    }
  }
  const d = config.default_position;
  return {
    matched: false,
    keyword: null,
    used_default: true,
    page: d.page,
    x: d.x,
    y: d.y,
    confidence: "low",
  };
}
