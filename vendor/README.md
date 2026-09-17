# Vendored character data — license notes

This directory contains character stroke data vendored for offline use
(no runtime network requests).

## `../src/zheng-strokes.ts` — canonical 5-stroke vectors for 正 (U+6B63)

- Source: Hanzi Writer Data (`chanind/hanzi-writer-data`, file `正.json`),
  which derives from the Make Me a Hanzi project (`skishore/make-me-a-hanzi`).
- The stroke path data was extracted from fonts by Arphic Technology Co., Ltd.
- Only ONE character (正, 5 strokes) is vendored; no bulk character package.
- No modifications were made to the path data itself (verbatim single-char
  subset). The surrounding TypeScript (types, viewBox constant, docs) is
  original plugin code under the repository's MIT license.

## License (data — NOT MIT)

The stroke vector data for 正 is governed by the **Arphic Public License**
(see `ARPHICPL.txt` in this directory), not MIT:

- Data: Make Me a Hanzi → Arphic Technology fonts → Arphic Public License.
- Plugin source code: MIT (see repository `LICENSE`/manifest).
- Do not claim the character data is MIT.

Upstream references:

- https://github.com/chanind/hanzi-writer-data (data, Arphic Public License)
- https://github.com/skishore/make-me-a-hanzi (extraction)
- https://github.com/chanind/hanzi-writer (renderer library, MIT — not bundled)
