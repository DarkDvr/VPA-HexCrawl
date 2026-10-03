# VPA HexCrawl

An endless hex map for your fantasy world, living inside Obsidian.

Paint continents one hex at a time. Watch forests, roads, and rivers join themselves as you grow. Name every settlement, drop your hero anywhere, and reskin the whole world with AI generated tilesets when inspiration strikes.

## Why you will love it

- **Zero setup.** Open the map and click. Your first continent is seconds away.
- **It grows with you.** Every hex you add blends in: terrain art, auto joining roads and rivers, and features that sit pretty.
- **Make it yours.** Drop a folder of square PNGs in and paint with your own style. Add your hero portrait to the player token.
- **Fast hands.** Double click to name, double click outlines to create and paint, pinch to zoom on touch screens.
- **Safe to explore.** Missing art degrades gracefully, and the delete button makes you type `DELETE` first.

## Install

1. Copy `main.js`, `styles.css`, and `manifest.json` into `<vault>/.obsidian/plugins/vpahexcrawl/`.
2. Enable `VPA HexCrawl` under Settings → Community plugins.
3. Hit the hexagon ribbon button and start anywhere.

Requires Obsidian 1.13.0 or newer.

## Custom tilesets

Settings → `VPA HexCrawl` → `Custom tilesets` → `Open tiles folder`. Add a folder with `terrain` and `features` subfolders of PNG files (100 to 300 pixels per side, 10 kilobytes to 3 megabytes each). Your set shows up in the pickers automatically.

## License

VPA HexCrawl by DarkDvr is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). You may use, share, and fork it with attribution, but not for commercial purposes.

## Build

```sh
npm install
npm run build
npm run lint
```
