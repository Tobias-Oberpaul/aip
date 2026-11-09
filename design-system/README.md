# Design System

The public website and local dashboard share UI primitives, theme tokens and
documentation navigation here. Keep charts, ticket UI and local data access
in their product areas.

Check both surfaces after changing a shared component. The dashboard uses the
dark palette. The website can switch between light and dark.

## Files

- `design-system/tokens.css` defines the semantic light and dark palettes.
- `design-system/product-header.jsx` lays out the shared product title, navigation and actions.
- `design-system/product-header.css` styles the shared navigation group.
- `design-system/documentation-toc.jsx` implements section links, tooltips and MDK markers. Opening a linked note passes its path and label to the reader.
- `design-system/documentation-toc.css` defines the shared contents rail and its breakpoints.
- `design-system/utils.ts` combines component classes.
- `design-system/components/ui/badge.tsx` renders badges.
- `design-system/components/ui/button.tsx` provides buttons and styled links.
- `design-system/components/ui/card.tsx` provides card primitives.
- `design-system/components/ui/collapsible.tsx` provides disclosure primitives.
- `design-system/components/ui/select.tsx` provides dropdown controls.
- `design-system/components/ui/table.tsx` provides table primitives.
- `design-system/components/ui/tooltip.tsx` provides shadcn tooltips.
