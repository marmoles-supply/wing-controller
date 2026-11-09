// Refresh only the reviewed image aliases. HTML/CSS in docs remain editable.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PRODUCT_PAGE_MEDIA } from './lib/product-page-assets.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'docs/assets/product');
await fs.mkdir(destination, {recursive:true});
for (const name of PRODUCT_PAGE_MEDIA) {
  await fs.copyFile(path.join(root,'assets/product',name),path.join(destination,name));
}
console.log(`Refreshed ${PRODUCT_PAGE_MEDIA.length} reviewed product images for GitHub Pages.`);
