# VPA HexCrawl

An endless hex map for your fantasy world, living inside Obsidian.

Paint continents one hex at a time. Watch forests, roads, and rivers join themselves as the map grows. Name hexes and features, track your party on the map, and reskin the whole world with custom tilesets.

## Features

- **Zero setup.** Open the map and click. Very easy to use, and fully supports touchscreens.
- **Prepare the map or uncover it one hex at a time.** Add terrain, then add features to it, roads, rivers, give it a name if it's memorable.
- **Make it yours.** Default tileset not covering your story's needs? Add your own tilesets with terrain or features as a folder with PNGs, and use it on your map immediately. Also, use your own player or party token if you want to.
- **Easy controls.** Double click, right click - it's all there.
- **Configurable.** Many things can be changed through built-in plugin settings menu.

## Install
1. Copy `main.js`, `styles.css`, and `manifest.json` into `<vault>/.obsidian/plugins/vpahexcrawl/`.
2. Enable `VPA HexCrawl` under Settings → Community plugins.
3. Hit the hexagon ribbon button and start anywhere.

Requires Obsidian 1.13.0 or newer.

## Custom tilesets

Settings → `VPA HexCrawl` → `Custom tilesets` → `Open tiles folder`. Add a folder with `terrain` and `features` subfolders of PNG files (100 to 300 pixels per side, 10 kilobytes to 3 megabytes each). Your set shows up in the pickers automatically, using your PNG filenames as names.

## License

VPA HexCrawl by DarkDvr is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). You may use, share, and fork it with attribution, but not for commercial purposes.

## Build

```sh
npm install
npm run build
npm run lint
```
