# drawio-svg-cache

Makes draw.io smooth with heavy SVG shape libraries.

draw.io keeps every SVG image as a live vector: the shape panel, the hover preview and the canvas re-render all
paths and gradients of every visible shape on each scroll or zoom frame. With detailed device images (hundreds of
elements each) this drops the frame rate. This script shows such images through a bitmap rendered once at the
size they are displayed at, and re-renders it only when the zoom settles at a new level.

The diagram is not touched: the file, copy/paste, export and print keep the original vector image. Only what is
drawn in the editor window changes. Small SVGs (< 4 KB) and shapes zoomed in beyond 4096 px stay vector.

**Status: early version (0.4).** Checked on draw.io Desktop for Windows (patched app archive) and on
app.diagrams.net 32.7.3: panel thumbnails and canvas images are swapped to bitmaps, the saved file keeps the
original SVG. Extreme zoom-in falls back to the real vector, so it is as slow there as without the script.

## Measurements

draw.io 32.6.10 in headless Chrome 153, library of 50 device images (25-115 KB of SVG each).
Time spent by Chrome's raster threads during a scripted scenario:

| Scenario | Without | With the script | |
|---|---|---|---|
| Scrolling the shape panel, 240 frames | 2870-3230 ms | 145-160 ms | -95 % |
| Zooming the canvas with 30 shapes, 60 steps | 2320-2610 ms | 1035-1210 ms | -55 % |
| Zoom: median frame | 29-34 ms | 18-19 ms | |
| Zoom: slowest 5 % of frames | 69-94 ms | 26-35 ms | |

Software rasterisation on a 2-core VM; numbers on a real GPU will differ, the ratio is what matters.
To measure on your own machine, paste `bench.js` into the DevTools console with and without the script.

## Install

**Browser (app.diagrams.net):** install Tampermonkey, then open `drawio-svg-cache.user.js` and confirm.

**draw.io Desktop (Windows):** current versions do not load external plugins, so the script goes into the app archive.
Close draw.io, then in PowerShell (as Administrator if draw.io is in Program Files), from this folder:

```
.\patch-desktop.ps1            # install (keeps a backup of the original archive)
.\patch-desktop.ps1 -Restore   # remove
```

Needs Node.js. A draw.io update replaces the archive: run the script again after updating.

## Settings

Optional, in the browser console (stored per site):

```js
localStorage.setItem('drawioSvgCache', JSON.stringify({ canvas: false }))   // panel only
localStorage.removeItem('drawioSvgCache')                                    // defaults
```

Keys: `panel`, `canvas`, `minBytes`, `panelOversample`, `canvasOversample`, `maxSide`, `maxPixels`, `settleMs`.
`drawioSvgCache.stats` in the console shows what the script did.

## License

BSD 3-Clause, see `LICENSE`.
