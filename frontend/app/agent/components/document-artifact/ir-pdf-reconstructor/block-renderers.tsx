import { Text, View } from "@react-pdf/renderer";
import type { IRBlock } from "./types";
import { styles } from "./pdf-styles";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Estimate a font size that lets the text fit inside the bounding box. */
export function getDynamicStyle(
  block: IRBlock,
  defaultFontSize: number,
  isList: boolean = false
) {
  if (!block.bbox) return { fontSize: defaultFontSize };

  const height = Math.max(0, block.bbox.y1 - block.bbox.y0);
  const width = Math.max(0, block.bbox.x1 - block.bbox.x0);
  if (height === 0 || width === 0) return { fontSize: defaultFontSize };

  const text = block.content || block.content_preview || "";
  let lines = 1;

  if (isList) {
    const items = text.split(/\n/).filter((l) => l.trim());
    lines = items.length;
    items.forEach((item) => {
      const charCapacity = width / (defaultFontSize * 0.45);
      if (item.length > charCapacity) {
        lines += Math.floor(item.length / charCapacity);
      }
    });
  } else {
    const charCapacity = width / (defaultFontSize * 0.45);
    lines = Math.max(1, Math.ceil(text.length / charCapacity));
  }

  const maxFontSizeToFitHeight = height / (lines * 1.2);
  const finalSize = Math.min(
    defaultFontSize,
    Math.max(6, maxFontSizeToFitHeight)
  );

  return { fontSize: finalSize };
}

// ── Individual block components ─────────────────────────────────────────────

export function HeadingBlock({ block }: { block: IRBlock }) {
  const level = block.level || 1;
  const rawText = block.content || block.content_preview || "";
  const text = rawText.trim() === "" ? "\u200B" : rawText;

  const defaultSize = level === 1 ? 22 : level === 2 ? 16 : 13;
  const baseStyle =
    level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3;
  const dynamicStyle = getDynamicStyle(block, defaultSize);

  return (
    <View style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <Text
        style={[
          baseStyle,
          dynamicStyle,
          { marginTop: 0, marginBottom: 0, lineHeight: 1.2 },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export function ParagraphBlock({ block }: { block: IRBlock }) {
  const rawText = block.content || block.content_preview || "";
  const text = rawText.trim() === "" ? "\u200B" : rawText;
  const dynamicStyle = getDynamicStyle(block, 10.5);

  return (
    <View style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <Text
        style={[
          styles.paragraph,
          dynamicStyle,
          { marginBottom: 0, lineHeight: 1.3 },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export function ListBlock({ block }: { block: IRBlock }) {
  const rawText = block.content || block.content_preview || "";
  const text = rawText.trim() === "" ? "\u200B" : rawText;
  const dynamicStyle = getDynamicStyle(block, 10.5, true);

  const items = text.split(/\n/).filter((l) => l.trim());

  if (items.length === 0) {
    return (
      <View
        style={[
          styles.listItem,
          { width: "100%", height: "100%", overflow: "hidden" },
        ]}
      >
        <Text style={[styles.listBullet, dynamicStyle]}>•</Text>
        <Text style={[styles.listContent, dynamicStyle]}>{"\u200B"}</Text>
      </View>
    );
  }

  if (items.length === 1) {
    return (
      <View
        style={[
          styles.listItem,
          { width: "100%", height: "100%", overflow: "hidden" },
        ]}
      >
        <Text style={[styles.listBullet, dynamicStyle]}>•</Text>
        <Text style={[styles.listContent, dynamicStyle, { lineHeight: 1.3 }]}>
          {items[0].replace(/^[-•*]\s*/, "") || "\u200B"}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      {items.map((item, i) => (
        <View key={i} style={styles.listItem}>
          <Text style={[styles.listBullet, dynamicStyle]}>•</Text>
          <Text
            style={[styles.listContent, dynamicStyle, { lineHeight: 1.3 }]}
          >
            {item.replace(/^[-•*]\s*/, "") || "\u200B"}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function TableBlock({ block }: { block: IRBlock }) {
  const rawText = block.content || block.content_preview || "";
  const text = rawText.trim() === "" ? "\u200B" : rawText;
  const dynamicStyle = getDynamicStyle(block, 9);

  const lines = text
    .split(/\n/)
    .filter((l) => l.trim() && !l.match(/^[-|]+$/));

  if (lines.length === 0) {
    return (
      <View style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        <Text style={[styles.paragraph, dynamicStyle]}>{text}</Text>
      </View>
    );
  }

  const rows = lines.map((line) =>
    line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
  );

  return (
    <View
      style={[
        styles.tableContainer,
        { width: "100%", height: "100%", overflow: "hidden" },
      ]}
    >
      {rows.map((cells, ri) => (
        <View key={ri} style={styles.tableRow}>
          {cells.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                styles.tableCell,
                dynamicStyle,
                ri === 0
                  ? { fontWeight: 600, backgroundColor: "#f9f9f9" }
                  : {},
              ]}
            >
              {cell || "\u200B"}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function ImageBlock({ block }: { block: IRBlock }) {
  const label = block.metadata?.label || block.label || "Image";
  return (
    <View style={styles.imagePlaceholder}>
      <Text style={styles.imagePlaceholderText}>[{label}]</Text>
    </View>
  );
}

// ── Router ──────────────────────────────────────────────────────────────────

/** Picks the right renderer based on block type / label. */
export function RenderBlock({ block }: { block: IRBlock }) {
  const label = block.metadata?.label || block.label || "";
  const type = block.type;

  if (type === "heading" || label === "section_header") {
    return <HeadingBlock block={block} />;
  }
  if (type === "list" || label === "list_item") {
    return <ListBlock block={block} />;
  }
  if (type === "table") {
    return <TableBlock block={block} />;
  }
  if (type === "image") {
    return <ImageBlock block={block} />;
  }
  return <ParagraphBlock block={block} />;
}
