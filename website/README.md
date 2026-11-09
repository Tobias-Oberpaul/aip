# Website

The public AIP site is built with `npm run build:site`. GitHub Pages publishes
`website/public/`. The React entry points enhance the static HTML and use
components and tokens from the [design system](../design-system/README.md).
The public guide follows the GitHub source and covers installed and source commands, dashboard navigation, and local recovery.

## Files

- `website/build.mjs` bundles the website and copies the shared styles.
- `website/src/site.jsx` renders the homepage and header.
- `website/src/documentation.jsx` renders the public documentation with the shared TOC.
- `website/public/index.html` is the static homepage.
- `website/public/docs/index.html` is the static public documentation.
- `website/public/assets/styles.css` provides prebuilt website utilities.
- `website/public/assets/home.css` styles the homepage.
- `website/public/assets/motion.css` contains the website motion styles.
- `website/public/assets/page-spacing.css` defines the website spacing.
- `website/public/assets/playground.css` styles the site shell and documentation layout.
- `.github/workflows/pages.yml` builds and publishes the website.
