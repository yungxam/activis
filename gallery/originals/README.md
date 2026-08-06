# Drop your images here

Put your original image files in this folder (any format: JPG, PNG, WEBP, HEIC…).

On push, the **Build gallery** GitHub Action automatically generates optimized
thumbnails (`../thumbs/`) and full-size images (`../full/`) plus `../manifest.json`,
which the desktop IMAGES folder reads. You don't need to run anything.

To rebuild locally instead: `npm install && npm run build:gallery`
