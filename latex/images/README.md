# Figures for report.tex

`preamble.tex` sets `\graphicspath{{images/}}`, so figures are referenced by filename alone.

| Filename | Figure | Where it appears | Width | Label |
|---|---|---|---|---|
| `falcon-vqa-arch.png` | Fig. 1 | Solution Overview | full text width | `fig:arch` |
| `video-mind-tech.png` | Fig. 2 | Architecture $\rightarrow$ Technology Stack, after the table | full text width | `fig:tech` |
| `falcon-vqa-ui-design.png` | Fig. 3 | User Interface and Acceptance Planning | full text width | `fig:ui` |

`video-mind-arch.png` and `video-mind-ui.jpeg` are the superseded architecture and UI
figures. They are no longer referenced and are kept only for reference.

`\optfigure{filename}{caption}{width}{label}` includes a figure if the file is present
and a labelled placeholder box if it is not, so the report always compiles. To swap a
figure, replace the filename in the matching `\optfigure{...}` call.
