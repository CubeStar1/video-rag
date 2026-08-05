# Figures for report.tex

`preamble.tex` sets `\graphicspath{{images/}}`, so figures are referenced by filename alone.

| Filename | Figure | Where it appears | Width | Label |
|---|---|---|---|---|
| `falcon-vqa-arch.png` | Fig. 1 | §2 Solution Overview | full text width | `fig:arch` |
| `video-mind-tech.png` | Fig. 2 | §6 Architecture $\rightarrow$ Technology Stack | full text width | `fig:tech` |
| `falcon-vqa-schema.png` | Fig. 4 | §7 Database Design $\rightarrow$ Application Database | 92% | `fig:schema` |
| `falcon-vqa-ui-design.png` | Fig. 6 | §8 User Interface | full text width | `fig:ui` |

Figures 3 (`fig:erd`) and 5 (`fig:keys`) are drawn inline with TikZ in
`sections/07-database.tex`; their styles live in `preamble.tex`.

`video-mind-arch.png` and `video-mind-ui.jpeg` are the superseded architecture and UI
figures. They are no longer referenced and are kept only for reference.

`\optfigure{filename}{caption}{width}{label}` includes a figure if the file is present
and a labelled placeholder box if it is not, so the report always compiles. To swap a
figure, replace the filename in the matching `\optfigure{...}` call.
