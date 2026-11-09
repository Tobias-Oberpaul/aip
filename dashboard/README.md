# Dashboard

The dashboard is local and read-only. It shows project-level effort per story point, the context heatmap and a filterable ticket list. Ticket rows and heatmap cells open ticket details. Pagination measures row heights at the current viewport width and divides remaining space among the visible rows. Data refresh keeps the current page when it still exists and falls back to the last page if the list shrinks. Filter and sort changes return to page one.

Keep the data contract in the telemetry layer. Use the existing shadcn components for tooltips and MDK controllers for motion. Check UI changes against both desktop and compact viewports.

Global notifications span the viewport at its top edge, immediately above the shared header in the dashboard and the project documentation reader. On desktop the column divider connects the full-width header border to the bottom of the viewport. Ticket rows and their filters share the same horizontal edges. The KPI cards, plot and ticket rows use highlighted surfaces. Section headings, filters, legends and band summaries sit on the page background.

Dashboard and documentation use the shared website header with a centered
navigation group. The dashboard panes share the header's outer inset.
Use the MDK page gutter of 32 px on desktop and 16 px on narrow screens
for the spacing below the header and beside the column divider.
The dashboard refreshes data every 15 seconds while visible
and when its tab becomes visible again. It requests the compact dashboard
response and revalidates it with HTTP caching. Use 12 px gaps between content groups
and tighter gaps within control groups and rows.

Focus rings stay inside dashboard controls and scroll regions so the viewport layout can clip overflow without hiding the indicator. Both story-point filters offer the full estimation scale and any legacy sizes present in the relevant data.

The heatmap card follows the square grid's aspect ratio and keeps a uniform inset on all sides. The density legend uses the top inset and axis labels use the left and bottom insets. Populated cells and legend swatches share one vivid green with increasing fill opacity at 1, 2, 3 and 4+ tickets. Empty cells and their swatch use the muted surface color. The caption above the chart shows compact context-band medians. Their tooltips show exact values, units and ticket counts.

Keep the main view concise. Show partial coverage where it affects interpretation and put methodology in shared shadcn tooltips. On wide ticket lists metric headings appear once, while compact rows keep their individual labels. The drawer keeps numeric scores and full details.

The KPI totals and heatmap use project history. Below 25% context, the KPI badges compare completed, estimated tickets in the last measured chat with the rest of the project. At 25% context and above, they compare the five latest completed, estimated tickets starting at or above 25% to the tickets in that chat starting below 25%. Each metric needs five measured tickets in each group and a positive reference rate. Rates are total effort divided by total story points. A 30% increase in the within-chat comparison triggers the effort warning. A separate warning starts at 95% context and asks the user to start a new chat and ticket.

## Files

- `dashboard/app.jsx` owns dashboard layout, chart interactions and the ticket drawer.
- `dashboard/dashboard-header.jsx` configures the shared header for dashboard and documentation navigation.
- `dashboard/project-documentation.jsx` opens the project index from the dashboard header. On deeper notes, the breadcrumb stays above the scrolling reader and links to earlier notes in the path. The TOC back action returns to the previous note.
- `dashboard/project-doc.jsx` renders Markdown and supplies the headings and links to deeper notes to the shared table of contents.
- `dashboard/styles.css` contains responsive sizing and theme rules.
- `dashboard/tailwind.config.cjs` defines the dashboard build and theme tokens.
Use the [design system](../design-system/README.md) for shared components and
the [local server](../tool/integration-and-release/README.md) for dashboard
assets and data.
