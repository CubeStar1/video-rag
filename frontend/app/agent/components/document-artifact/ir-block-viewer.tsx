"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  ChevronRightIcon, 
  Type, 
  AlignLeft, 
  List, 
  TableProperties, 
  Image as ImageIcon, 
  Box,
  Hash, 
  Layers, 
  FileText, 
  Link,
  Sigma,
  Info
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

interface IRBlock {
  block_id: string;
  type: string;
  content?: string;
  content_preview?: string;
  order: number;
  page_number?: number;
  metadata?: Record<string, any>;
  label?: string;
  level?: number | null;
  parent_id?: string | null;
  [key: string]: any;
}

interface IRBlockViewerProps {
  blocks: IRBlock[];
}

const TYPE_CONFIG: Record<string, { 
  icon: any; 
  badge: string; 
  border: string; 
  bg: string;
  iconColor: string;
}> = {
  heading: { 
    icon: Type,
    badge: "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-800/50", 
    border: "border-l-blue-500", 
    bg: "hover:bg-blue-50/50 dark:hover:bg-blue-900/10",
    iconColor: "text-blue-500"
  },
  paragraph: { 
    icon: AlignLeft,
    badge: "bg-zinc-500/10 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800/50", 
    border: "border-l-zinc-400 dark:border-l-zinc-600", 
    bg: "hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10",
    iconColor: "text-zinc-500"
  },
  list: { 
    icon: List,
    badge: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50", 
    border: "border-l-emerald-500", 
    bg: "hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10",
    iconColor: "text-emerald-500"
  },
  table: { 
    icon: TableProperties,
    badge: "bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400 border-violet-200 dark:border-violet-800/50", 
    border: "border-l-violet-500", 
    bg: "hover:bg-violet-50/50 dark:hover:bg-violet-900/10",
    iconColor: "text-violet-500"
  },
  image: { 
    icon: ImageIcon,
    badge: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border-amber-200 dark:border-amber-800/50", 
    border: "border-l-amber-500", 
    bg: "hover:bg-amber-50/50 dark:hover:bg-amber-900/10",
    iconColor: "text-amber-500"
  },
  equation: {
    icon: Sigma,
    badge: "bg-pink-500/10 text-pink-700 dark:bg-pink-500/20 dark:text-pink-400 border-pink-200 dark:border-pink-800/50",
    border: "border-l-pink-500",
    bg: "hover:bg-pink-50/50 dark:hover:bg-pink-900/10",
    iconColor: "text-pink-500"
  },
  default: { 
    icon: Box,
    badge: "bg-slate-500/10 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400 border-slate-200 dark:border-slate-800/50", 
    border: "border-l-slate-300 dark:border-l-slate-700", 
    bg: "hover:bg-slate-50/50 dark:hover:bg-slate-900/10",
    iconColor: "text-slate-500"
  }
};

function getConfig(type: string) {
  if (!type) {
    return TYPE_CONFIG.default;
  }
  const normalizedType = type.toLowerCase();
  if (normalizedType.includes("head") || normalizedType === "section_header") return TYPE_CONFIG.heading;
  if (normalizedType.includes("table")) return TYPE_CONFIG.table;
  if (normalizedType.includes("list")) return TYPE_CONFIG.list;
  if (normalizedType.includes("image") || normalizedType.includes("figure")) return TYPE_CONFIG.image;
  if (normalizedType.includes("equation") || normalizedType.includes("math")) return TYPE_CONFIG.equation;
  if (normalizedType.includes("text") || normalizedType.includes("paragraph")) return TYPE_CONFIG.paragraph;
  return TYPE_CONFIG[normalizedType] || TYPE_CONFIG.default;
}

function MetadataItem({ icon: Icon, label, value }: { icon: any, label: string, value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-start gap-2 text-xs py-1">
      <Icon className="w-3.5 h-3.5 mt-0.5 text-muted-foreground/70 shrink-0" />
      <div className="flex-1 space-y-0.5 min-w-0">
        <span className="text-muted-foreground font-medium block">{label}</span>
        <span className="text-foreground font-mono break-all">{value}</span>
      </div>
    </div>
  );
}

function BlockCard({ block }: { block: IRBlock }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const label = block.metadata?.label || block.label || block.type || "block";
  const config = getConfig(block.type);
  const Icon = config.icon;
  
  const isHeading = block.type === "heading" || label === "section_header";
  const text = block.content || block.content_preview || "";
  const preview = text.slice(0, 150);
  const hasMore = text.length > 150;

  // Extract all extra properties for the expanded view
  const {
    content,
    content_preview,
    type,
    block_id,
    order,
    page_number,
    label: blockLabel,
    level,
    parent_id,
    metadata,
    ...extraProps
  } = block;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "group relative flex flex-col rounded-xl border border-border/50 bg-card text-card-foreground shadow-sm transition-all duration-200 overflow-hidden",
          "hover:border-border hover:shadow-md",
          "border-l-4",
          config.border,
          isOpen ? "shadow-md border-border ring-1 ring-border/50" : ""
        )}
      >
        <CollapsibleTrigger 
          className={cn(
            "flex w-full items-start gap-3 p-4 text-left outline-none transition-colors",
            config.bg
          )}
        >
          <div className="flex mt-0.5 items-center justify-center shrink-0 w-7 h-7 rounded-md bg-background/80 border border-border/50 shadow-sm">
            <Icon className={cn("size-4", config.iconColor)} />
          </div>
          
          <div className="flex-1 min-w-0 flex flex-col gap-1.5 align-middle">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-[10px] px-2 py-0.5 uppercase tracking-wider font-semibold border", config.badge)}
              >
                {label}
              </Badge>
              
              <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground">
                <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5 rounded-sm" title="Order">
                  <Hash className="size-3" />
                  {block.order}
                </span>
                
                {block.page_number !== undefined && block.page_number !== null && (
                  <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5 rounded-sm" title="Page Number">
                    <FileText className="size-3" />
                    Pg {block.page_number}
                  </span>
                )}
                
                {block.level !== undefined && block.level !== null && (
                  <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5 rounded-sm" title="Level">
                    <Layers className="size-3" />
                    Lvl {block.level}
                  </span>
                )}
              </div>
            </div>
            
            {(preview || !isOpen) && text && (
              <p
                className={cn(
                  "text-sm leading-relaxed text-foreground/80 mt-1",
                  isHeading && "font-semibold text-foreground text-base",
                  isOpen && hasMore && "hidden" // hide preview when open if there's more text
                )}
              >
                {preview}
                {hasMore && !isOpen && (
                  <span className="text-muted-foreground ml-1 font-medium">...</span>
                )}
              </p>
            )}
          </div>

          <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-muted/50 group-hover:bg-muted transition-colors">
            <ChevronRightIcon
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-90"
              )}
            />
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="bg-muted/10">
          <Separator className="bg-border/50" />
          
          <div className="p-4 flex flex-col gap-5">
            {/* Full text section */}
            {(text && (isOpen && hasMore || !preview)) && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <AlignLeft className="size-3" /> Content
                </h4>
                <div className="bg-background border border-border/50 rounded-lg p-3 shadow-inner">
                  <p className={cn(
                    "text-sm leading-relaxed text-foreground whitespace-pre-wrap select-text",
                    isHeading && "font-semibold text-base"
                  )}>
                    {text}
                  </p>
                </div>
              </div>
            )}

            {/* Metadata Grid */}
            <div className="space-y-3 pt-1">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Info className="size-3" /> Properties
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3 bg-background/50 border border-border/50 p-3 rounded-lg">
                <MetadataItem icon={Hash} label="Block ID" value={block.block_id} />
                <MetadataItem icon={Box} label="Type" value={block.type} />
                <MetadataItem icon={FileText} label="Page Number" value={block.page_number} />
                <MetadataItem icon={Layers} label="Level" value={block.level} />
                <MetadataItem icon={Link} label="Parent ID" value={block.parent_id} />
                
                {/* Render any additional nested metadata */}
                {metadata && Object.entries(metadata).map(([k, v]) => (
                  <MetadataItem 
                    key={`meta_${k}`} 
                    icon={Info} 
                    label={`Meta: ${k}`} 
                    value={typeof v === 'object' ? JSON.stringify(v) : String(v)} 
                  />
                ))}

                {/* Render any unrecognized extra root-level props */}
                {Object.keys(extraProps).length > 0 && Object.entries(extraProps).map(([k, v]) => (
                  <MetadataItem 
                    key={`extra_${k}`} 
                    icon={Info} 
                    label={k} 
                    value={typeof v === 'object' ? JSON.stringify(v) : String(v)} 
                  />
                ))}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function IRBlockViewer({ blocks }: IRBlockViewerProps) {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-3 p-1">
      {sorted.map((block) => (
        <BlockCard key={block.block_id} block={block} />
      ))}
      {sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed rounded-xl bg-muted/20">
          <Box className="size-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No blocks to display</p>
        </div>
      )}
    </div>
  );
}
