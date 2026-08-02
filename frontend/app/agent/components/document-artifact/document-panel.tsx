"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { IRBlockViewer } from "./ir-block-viewer";
import {
  FileIcon,
  UploadCloudIcon,
  Loader2Icon,
  CheckCircle2Icon,
  FileTextIcon,
  HashIcon,
  LayersIcon,
  LayoutIcon,
  FileOutputIcon,
} from "lucide-react";

// Dynamic imports — these use browser APIs that crash during SSR
const PdfBboxViewer = dynamic(
  () => import("./pdf-bbox-viewer").then((mod) => mod.PdfBboxViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <span className="ml-2 text-sm text-muted-foreground">Loading viewer...</span>
      </div>
    ),
  }
);

const IrPdfReconstructor = dynamic(
  () => import("./ir-pdf-reconstructor/index").then((mod) => mod.IrPdfReconstructor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <span className="ml-2 text-sm text-muted-foreground">Generating PDF...</span>
      </div>
    ),
  }
);
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DocumentPanelProps {
  irData?: any;
  documentId?: string;
}

export function DocumentPanel({ irData, documentId }: DocumentPanelProps) {
  // Extract PDF URL from the raw IR payload if available 
  const pdfUrl = irData?.metadata?.source_url || null;

  // State 4: IR loaded — show tabbed view
  if (irData) {
    const blockCount = irData.blocks?.length || 0;
    const pageCount = irData.blocks
      ? new Set(
          irData.blocks
            .map((b: any) => b.page_number)
            .filter((p: any) => p != null)
        ).size
      : 0;

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <Tabs defaultValue="blocks" className="flex h-full flex-col">
          {/* Header with tabs */}
          <div className="flex items-center justify-between border-b px-4 py-0 shrink-0">
            <TabsList className="h-10 bg-transparent p-0 gap-0">
              <TabsTrigger
                value="blocks"
                className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none h-10 px-3 text-xs"
              >
                <LayersIcon className="size-3 mr-1.5" />
                Blocks
                <Badge
                  variant="secondary"
                  className="ml-1.5 text-[10px] px-1 py-0 h-4"
                >
                  {blockCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="document"
                className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none h-10 px-3 text-xs"
              >
                <LayoutIcon className="size-3 mr-1.5" />
                Document
                {pageCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 text-[10px] px-1 py-0 h-4"
                  >
                    {pageCount}p
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="reconstruct"
                className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none h-10 px-3 text-xs"
              >
                <FileOutputIcon className="size-3 mr-1.5" />
                Reconstruct
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Document Preview
              </span>
              {irData.document_id && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {irData.document_id.slice(0, 12)}…
                </span>
              )}
            </div>
          </div>

          {/* Tab: Blocks */}
          <TabsContent value="blocks" className="flex-1 overflow-y-auto p-4 mt-0">
            <IRBlockViewer blocks={irData.blocks || []} />
          </TabsContent>

          {/* Tab: Document with bounding boxes */}
          <TabsContent value="document" className="flex-1 overflow-hidden mt-0">
            {pdfUrl ? (
              <PdfBboxViewer
                pdfUrl={pdfUrl}
                blocks={irData.blocks || []}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  PDF file not available for preview.
                </p>
              </div>
            )}
          </TabsContent>

          {/* Tab: Reconstructed PDF from IR blocks */}
          <TabsContent value="reconstruct" className="flex-1 overflow-hidden mt-0">
            <IrPdfReconstructor blocks={irData.blocks || []} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return null;
}
