import { StyleSheet, Font } from "@react-pdf/renderer";

// ── Font registration ───────────────────────────────────────────────────────

Font.register({
  family: "Inter",
  fonts: [
    {
      src: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf",
      fontWeight: 400,
    },
    {
      src: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-600-normal.ttf",
      fontWeight: 600,
    },
    {
      src: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf",
      fontWeight: 700,
    },
  ],
});

// Disable hyphenation for cleaner output
Font.registerHyphenationCallback((word) => [word]);

// ── Styles ──────────────────────────────────────────────────────────────────

export const styles = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 10.5,
    lineHeight: 1.4,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
    position: "relative",
  },
  h1: {
    fontSize: 22,
    fontWeight: 700,
    color: "#111",
  },
  h2: {
    fontSize: 16,
    fontWeight: 700,
    color: "#222",
  },
  h3: {
    fontSize: 13,
    fontWeight: 600,
    color: "#333",
  },
  paragraph: {
    textAlign: "left" as const,
  },
  listItem: {
    flexDirection: "row" as const,
  },
  listBullet: {
    width: 14,
    fontSize: 10.5,
    color: "#555",
  },
  listContent: {
    flex: 1,
  },
  tableContainer: {
    borderWidth: 0.5,
    borderColor: "#ccc",
  },
  tableRow: {
    flexDirection: "row" as const,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  tableCell: {
    flex: 1,
    padding: 2,
    fontSize: 9,
    borderRightWidth: 0.5,
    borderRightColor: "#eee",
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#f5f5f5",
    borderWidth: 0.5,
    borderColor: "#ddd",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  imagePlaceholderText: {
    fontSize: 9,
    color: "#999",
  },
  pageNumber: {
    position: "absolute" as const,
    bottom: 20,
    left: 0,
    right: 0,
    textAlign: "center" as const,
    fontSize: 9,
    color: "#999",
  },
});
