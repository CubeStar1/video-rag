# Figures for report.tex

`report.tex` sets `\graphicspath{{images/}}`, so figures are referenced by filename alone.

| Filename | Figure | Where it appears | Width |
|---|---|---|---|
| `video-mind-arch.png` | Fig. 1 | Solution Overview | full text width |
| `video-mind-tech.png` | Fig. 2 | Architecture $\rightarrow$ Technology Stack, after the table | full text width |
| `video-mind-ui.jpeg` | Fig. 3 | End of report | 95% text width |

To swap a figure, replace the filename in the matching `\optfigure{...}` call in
`report.tex`. Any figure that is missing compiles as a labelled placeholder box
rather than an error.
