export interface IRBlock {
  block_id: string;
  type: string;
  content?: string;
  content_preview?: string;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    page_width: number | null;
    page_height: number | null;
  };
  page_number?: number;
  order: number;
  metadata?: { label?: string };
  label?: string;
  level?: number | null;
  list_level?: number | null;
}

export interface IrPdfReconstructorProps {
  blocks: IRBlock[];
}
