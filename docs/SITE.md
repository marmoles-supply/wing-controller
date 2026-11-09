# Product website

The product page is **https://marmoles-supply.github.io/wing-controller/**.
Use `?lang=es` for Spanish. The repository remains the home for code, issues and
pull requests; visitors do not need to scroll through its file list to download
or learn about the application.

## Source and publishing

- `docs/index.html`: content, language switch and screenshot selector.
- `docs/site.css`: classic interface styling and responsive rules.
- `docs/.nojekyll`: serve static files directly.
- `docs/assets/product/`: reviewed image copies used by the site.
- `assets/product/`: original product media, fixtures and provenance.

GitHub Pages publishes **main → /docs**. No custom Actions workflow, framework,
site dependencies, analytics, telemetry or external form service is needed.
GitHub itself runs the Pages deployment. Markdown guides/legal documents remain
linked to their rendered GitHub pages; `.nojekyll` does not convert Markdown.

Do not move source code into another folder to shorten GitHub's file list: that
would change project paths without improving this product route.

## Editing and checks

Edit HTML/CSS directly. Keep the content factual and show the beta/testing
boundary. No testimonials, untested named-app claims or promotional slogans.
Screenshots must follow the existing offline-media privacy rules.

When the original product images change, run:

```sh
node scripts/sync-product-site.mjs
```

The reviewed image list has one home in `scripts/lib/product-page-assets.mjs`.
The synchroniser updates only the image copies; it does not overwrite HTML/CSS.
Review both languages, keyboard access, the screenshot selector and mobile widths.
Verify images and all download/install/feedback links. Update the version and
release URL deliberately when a new app release is issued; a website edit does
not build or alter the application.

After pushing to `main`, check GitHub's Pages deployment result and the actual
site. Do not call a pending or failed build a published site. Keep Pages public
and the source directory bounded; do not copy engineering backups or unrelated
private documentation into it.
