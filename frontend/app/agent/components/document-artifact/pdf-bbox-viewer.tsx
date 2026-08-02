"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Loader2Icon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  page_width: number | null;
  page_height: number | null;
}

interface IRBlock {
  block_id: string;
  type: string;
  content?: string;
  content_preview?: string;
  bbox?: BBox;
  page_number?: number;
  order: number;
  metadata?: { label?: string };
  label?: string;
}

interface PdfBboxViewerProps {
  pdfUrl: string;
  blocks: IRBlock[];
}

const TYPE_COLORS: Record<string, { stroke: string; fill: string }> = {
  heading: { stroke: "rgba(59, 130, 246, 0.8)", fill: "rgba(59, 130, 246, 0.12)" },
  paragraph: { stroke: "rgba(161, 161, 170, 0.6)", fill: "rgba(161, 161, 170, 0.08)" },
  list: { stroke: "rgba(34, 197, 94, 0.8)", fill: "rgba(34, 197, 94, 0.12)" },
  table: { stroke: "rgba(168, 85, 247, 0.8)", fill: "rgba(168, 85, 247, 0.12)" },
  image: { stroke: "rgba(245, 158, 11, 0.8)", fill: "rgba(245, 158, 11, 0.12)" },
};

function getBlockColor(type: string) {
  return TYPE_COLORS[type] || TYPE_COLORS.paragraph;
}

export function PdfBboxViewer({ pdfUrl, blocks }: PdfBboxViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, { width: number; height: number }>
  >({});
  const [scale, setScale] = useState(1);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [tooltipInfo, setTooltipInfo] = useState<{
    block: IRBlock;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Group blocks by page
  const blocksByPage = useMemo(() => {
    const grouped: Record<number, IRBlock[]> = {};
    for (const block of blocks) {
      const page = block.page_number || 1;
      if (!grouped[page]) grouped[page] = [];
      grouped[page].push(block);
    }
    return grouped;
  }, [blocks]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
    },
    []
  );

  const onPageLoadSuccess = useCallback(
    (page: any) => {
      const viewport = page.getViewport({ scale: 1 });
      setPageDimensions((prev) => ({
        ...prev,
        [page.pageNumber]: {
          width: viewport.width,
          height: viewport.height,
        },
      }));
    },
    []
  );

  const handleBlockHover = useCallback(
    (block: IRBlock, e: React.MouseEvent) => {
      setHoveredBlock(block.block_id);
      const rect = (e.currentTarget as HTMLElement).closest('.pdf-page-wrapper')?.getBoundingClientRect();
      if (rect) {
        setTooltipInfo({
          block,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    },
    []
  );

  const handleBlockLeave = useCallback(() => {
    setHoveredBlock(null);
    setTooltipInfo(null);
  }, []);

  // Auto-fit width to container
  const [containerWidth, setContainerWidth] = useState(600);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width - 32); // padding
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const pageWidth = useMemo(() => {
    return Math.max(300, containerWidth) * scale;
  }, [containerWidth, scale]);

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      {/* Zoom controls */}
      <div className="flex items-center gap-1 border-b px-3 py-1.5 shrink-0 bg-muted/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
          disabled={scale <= 0.5}
        >
          <ZoomOutIcon className="size-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setScale((s) => Math.min(2.0, s + 0.1))}
          disabled={scale >= 2.0}
        >
          <ZoomInIcon className="size-3.5" />
        </Button>
      </div>

      {/* PDF pages */}
      <div className="flex-1 overflow-auto p-4 bg-muted/20">
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center p-12">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading PDF...
              </span>
            </div>
          }
          error={
            <div className="flex items-center justify-center p-12">
              <span className="text-sm text-red-500">
                Failed to load PDF. The file may not be available.
              </span>
            </div>
          }
        >
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: numPages }, (_, i) => i + 1).map(
              (pageNum) => {
                const dims = pageDimensions[pageNum];
                const pageBlocks = blocksByPage[pageNum] || [];

                return (
                  <div
                    key={pageNum}
                    className="pdf-page-wrapper relative shadow-lg rounded-sm bg-white"
                    style={{ width: "fit-content" }}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={pageWidth}
                      onLoadSuccess={onPageLoadSuccess}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />

                    {/* Bounding box overlay */}
                    {dims && (
                      <svg
                        className="absolute inset-0 pointer-events-none"
                        width="100%"
                        height="100%"
                        viewBox={`0 0 ${dims.width} ${dims.height}`}
                        preserveAspectRatio="none"
                        style={{ pointerEvents: "none" }}
                      >
                        {pageBlocks.map((block) => {
                          if (!block.bbox) return null;
                          const { x0, y0, x1, y1 } = block.bbox;

                          // PDF coords: origin bottom-left, y up
                          // In this data y0 > y1 (y0 = top, y1 = bottom in PDF space)
                          const svgX = x0;
                          const svgY = dims.height - y0;
                          const svgW = x1 - x0;
                          const svgH = y0 - y1;

                          if (svgW <= 0 || svgH <= 0) return null;

                          const colors = getBlockColor(block.type);
                          const isHovered =
                            hoveredBlock === block.block_id;

                          return (
                            <rect
                              key={block.block_id}
                              x={svgX}
                              y={svgY}
                              width={svgW}
                              height={svgH}
                              fill={
                                isHovered
                                  ? colors.fill.replace(
                                      /[\d.]+\)$/,
                                      "0.25)"
                                    )
                                  : colors.fill
                              }
                              stroke={colors.stroke}
                              strokeWidth={isHovered ? 1.5 : 0.75}
                              rx={1}
                              style={{
                                pointerEvents: "all",
                                cursor: "pointer",
                                transition:
                                  "fill 0.15s, stroke-width 0.15s",
                              }}
                              onMouseEnter={(e) =>
                                handleBlockHover(block, e)
                              }
                              onMouseLeave={handleBlockLeave}
                            />
                          );
                        })}
                      </svg>
                    )}

                    {/* Tooltip */}
                    {tooltipInfo &&
                      hoveredBlock === tooltipInfo.block.block_id && (
                        <div
                          className="absolute z-50 max-w-xs rounded-md border bg-popover px-3 py-2 shadow-md pointer-events-none"
                          style={{
                            left: Math.min(
                              tooltipInfo.x + 8,
                              (containerWidth || 400) - 200
                            ),
                            top: tooltipInfo.y + 8,
                          }}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span
                              className="inline-block size-2 rounded-full"
                              style={{
                                backgroundColor: getBlockColor(
                                  tooltipInfo.block.type
                                ).stroke,
                              }}
                            />
                            <span className="text-xs font-medium">
                              {tooltipInfo.block.metadata?.label ||
                                tooltipInfo.block.label ||
                                tooltipInfo.block.type}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              #{tooltipInfo.block.order}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-3">
                            {(
                              tooltipInfo.block.content ||
                              tooltipInfo.block.content_preview ||
                              ""
                            ).slice(0, 150)}
                            {((tooltipInfo.block.content ||
                              tooltipInfo.block.content_preview ||
                              "").length > 150) && "…"}
                          </p>
                        </div>
                      )}
                  </div>
                );
              }
            )}
          </div>
        </Document>
      </div>
    </div>
  );
}
