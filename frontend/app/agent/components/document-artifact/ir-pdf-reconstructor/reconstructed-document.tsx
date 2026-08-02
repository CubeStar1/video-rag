import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { IRBlock } from "./types";
import { styles } from "./pdf-styles";
import { RenderBlock } from "./block-renderers";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive page dimensions from block bounding boxes when the metadata doesn't
 * include explicit page_width / page_height.
 *
 * PDF coordinate space has its origin at the bottom-left, so:
 *   - max(y0) across all blocks gives us the approximate page height
 *   - max(x1) gives us the approximate page width
 * We add a small margin so nothing is clipped at the edges.
 */
function derivePageDimensions(blocks: IRBlock[]) {
  let maxX = 0;
  let maxY = 0;

  for (const b of blocks) {
    if (!b.bbox) continue;
    if (Number.isFinite(b.bbox.x1)) maxX = Math.max(maxX, b.bbox.x1);
    if (Number.isFinite(b.bbox.y0)) maxY = Math.max(maxY, b.bbox.y0);
    if (Number.isFinite(b.bbox.y1)) maxY = Math.max(maxY, b.bbox.y1);
  }

  // Add a margin (≈ 30pt) to avoid clipping edge content
  return {
    width: Math.max(200, maxX + 30),
    height: Math.max(200, maxY + 30),
  };
}

// ── PDF Document ────────────────────────────────────────────────────────────

export function ReconstructedDocument({ blocks }: { blocks: IRBlock[] }) {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);

  // Group by page_number (default to page 1)
  const pages = new Map<number, IRBlock[]>();
  for (const block of sorted) {
    const pg = block.page_number || 1;
    if (!pages.has(pg)) pages.set(pg, []);
    pages.get(pg)!.push(block);
  }

  const pageNumbers = Array.from(pages.keys()).sort((a, b) => a - b);

  return (
    <Document title="Reconstructed Document" author="LayoutIR Agent">
      {pageNumbers.map((pg) => {
        const pageBlocks = pages.get(pg)!;

        // ── Determine page dimensions ──────────────────────────────────
        let pageWidth = 595.28; // A4 fallback
        let pageHeight = 841.89;

        // 1. Try explicit dimensions from block metadata
        const blockWithDims = pageBlocks.find(
          (b) =>
            b.bbox &&
            b.bbox.page_width &&
            b.bbox.page_height &&
            Number.isFinite(b.bbox.page_width) &&
            Number.isFinite(b.bbox.page_height)
        );

        if (blockWithDims?.bbox) {
          pageWidth = blockWithDims.bbox.page_width!;
          pageHeight = blockWithDims.bbox.page_height!;
        } else {
          // 2. Derive from bounding boxes when metadata is missing
          const derived = derivePageDimensions(pageBlocks);
          pageWidth = derived.width;
          pageHeight = derived.height;
        }

        return (
          <Page
            key={pg}
            size={[Math.max(100, pageWidth), Math.max(100, pageHeight)]}
            style={styles.page}
          >
            {pageBlocks.map((block) => {
              const bbox = block.bbox;

              const hasValidBbox =
                bbox &&
                Number.isFinite(bbox.x0) &&
                Number.isFinite(bbox.y0) &&
                Number.isFinite(bbox.x1) &&
                Number.isFinite(bbox.y1);

              if (!hasValidBbox) {
                // Fallback: flow layout when no bbox
                return (
                  <View
                    key={block.block_id}
                    style={{ marginBottom: 10, paddingHorizontal: 64 }}
                  >
                    <RenderBlock block={block} />
                  </View>
                );
              }

              // Enforce minimum dimensions to prevent react-pdf infinite loops
              const blockWidth = Math.max(50, bbox.x1 - bbox.x0);
              const blockHeight = Math.max(10, bbox.y1 - bbox.y0);

              // PDF origin = bottom-left → react-pdf origin = top-left
              const left = Math.max(0, bbox.x0);
              const top = Math.max(0, pageHeight - bbox.y1);

              const positionStyle = {
                position: "absolute" as const,
                left,
                top,
                width: blockWidth,
                ...(block.type === "image" || block.type === "table"
                  ? { height: blockHeight }
                  : {}),
              };

              return (
                <View key={block.block_id} style={positionStyle}>
                  <RenderBlock block={block} />
                </View>
              );
            })}
            <Text
              style={styles.pageNumber}
              render={({ pageNumber, totalPages }) =>
                `${pageNumber} / ${totalPages}`
              }
              fixed
            />
          </Page>
        );
      })}
    </Document>
  );
}
