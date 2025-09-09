# Extension Icons

This directory contains the extension icons in different sizes.

## Required Icons

- `icon16.png` - 16x16 pixels (toolbar icon)
- `icon48.png` - 48x48 pixels (extension management page)
- `icon128.png` - 128x128 pixels (Chrome Web Store)

## Icon Design

The icon features:
- Gradient background (purple to blue)
- Robot head with eyes and antenna
- "QA" text at the bottom
- Clean, modern design that represents AI-powered QA

## Generation

You can generate PNG files from the SVG using:
- Online SVG to PNG converters
- Image editing software
- Command line tools like ImageMagick

Example with ImageMagick:
```bash
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```
