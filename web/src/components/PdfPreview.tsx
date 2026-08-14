import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface OverlayBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  matched?: boolean;
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  pageNo: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
}

export function PdfPreview({
  bytes,
  boxes = [],
  height = 640,
}: {
  bytes: Uint8Array;
  boxes?: OverlayBox[];
  height?: number;
}) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef, bytes);

  useEffect(() => {
    let cancelled = false;
    if (!bytes || bytes.length === 0 || width <= 0) return;
    setPages([]);
    setError(null);
    (async () => {
      try {
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        const rendered: RenderedPage[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          const scale = width / viewport.width;
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(width * window.devicePixelRatio);
          canvas.height = Math.round(viewport.height * scale * window.devicePixelRatio);
          canvas.style.width = `${Math.round(width)}px`;
          canvas.style.height = `${Math.round(viewport.height * scale)}px`;
          canvas.style.display = "block";
          canvas.style.background = "#fff";
          const ctx = canvas.getContext("2d")!;
          ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
          await page.render({
            canvasContext: ctx,
            viewport: page.getViewport({ scale }),
          }).promise;
          rendered.push({ canvas, pageNo: n, pageWidth: viewport.width, pageHeight: viewport.height, scale });
        }
        if (!cancelled) setPages(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not render PDF");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, width]);

  const pageBoxes = useMemo(() => {
    const map = new Map<number, OverlayBox[]>();
    for (const b of boxes) {
      const arr = map.get(b.page) ?? [];
      arr.push(b);
      map.set(b.page, arr);
    }
    return map;
  }, [boxes]);

  if (error) return <div className="alert alert-rust">{error}</div>;
  if (pages.length === 0)
    return (
      <div style={{ height: 200, display: "grid", placeItems: "center", background: "var(--paper-dim)", borderRadius: "var(--radius)" }}>
        <span className="loader" />
      </div>
    );

  return (
    <div
      ref={containerRef}
      style={{
        background: "#3a3f4b",
        padding: 18,
        borderRadius: "var(--radius)",
        overflow: "auto",
        maxHeight: height,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
        {pages.map((p) => (
          <div
            key={p.pageNo}
            ref={(el) => {
              if (el && !el.contains(p.canvas)) el.appendChild(p.canvas);
            }}
            style={{ position: "relative", boxShadow: "0 2px 10px rgba(0,0,0,0.35)" }}
          >
            <svg
              width={Math.round(width)}
              height={Math.round(p.pageHeight * p.scale)}
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            >
              {(pageBoxes.get(p.pageNo) ?? []).map((b, i) => {
                const x = b.x * p.scale;
                const y = (p.pageHeight - b.y - b.h) * p.scale;
                const w = b.w * p.scale;
                const h = b.h * p.scale;
                const color = b.matched ? "#2f6f4e" : "#a87c3d";
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 3" rx={2} />
                    {b.label && (
                      <g>
                        <rect x={x} y={Math.max(0, y - 17)} width={w} height={17} fill={color} rx={2} />
                        <text x={x + 5} y={Math.max(12.5, y - 4.5)} fontSize={11} fontFamily="IBM Plex Mono, monospace" fill="#fff">
                          {b.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>, key: unknown): number {
  const [w, setW] = useState(620);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, key]);
  return w;
}
