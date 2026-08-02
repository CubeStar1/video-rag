"use client";

import { useMemo, useState } from "react";
import { BlobProvider } from "@react-pdf/renderer";
import {
  Loader2Icon,
  ZoomInIcon,
  ZoomOutIcon,
  DownloadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import type { IrPdfReconstructorProps } from "./types";
import { ReconstructedDocument } from "./reconstructed-document";

// Side-effect: registers fonts + styles on first import
import "./pdf-styles";

export function IrPdfReconstructor({ blocks }: IrPdfReconstructorProps) {
  const [scale, setScale] = useState(1);

  // Memoize the document element so BlobProvider doesn't re-render needlessly
  const doc = useMemo(
    () => <ReconstructedDocument blocks={blocks} />,
    [blocks]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BlobProvider document={doc}>
        {({ url, loading, error }) => {
          if (loading) {
            return (
              <div className="flex h-full items-center justify-center">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Generating PDF…
                </span>
              </div>
            );
          }

          if (error) {
            return (
              <div className="flex h-full items-center justify-center">
                <span className="text-sm text-red-500">
                  Failed to generate PDF: {error.message}
                </span>
              </div>
            );
          }

          if (!url) return null;

          return (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-1 border-b px-3 py-1.5 shrink-0 bg-muted/30">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
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
                  onClick={() => setScale((s) => Math.min(2.0, s + 0.15))}
                  disabled={scale >= 2.0}
                >
                  <ZoomInIcon className="size-3.5" />
                </Button>

                <div className="flex-1" />

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  asChild
                >
                  <a href={url} download="reconstructed.pdf">
                    <DownloadIcon className="size-3.5" />
                    Download
                  </a>
                </Button>
              </div>

              {/* PDF preview */}
              <div className="flex-1 overflow-hidden bg-muted/20">
                <iframe
                  src={url}
                  title="Reconstructed PDF Preview"
                  className="border-0"
                  style={{
                    width: `${100 * scale}%`,
                    height: `${100 * scale}%`,
                    transform: `scale(${1 / scale})`,
                    transformOrigin: "top left",
                  }}
                />
              </div>
            </>
          );
        }}
      </BlobProvider>
    </div>
  );
}
