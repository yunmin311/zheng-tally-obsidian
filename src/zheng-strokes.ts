/**
 * Canonical 5-stroke vector source for 正 (U+6B63).
 *
 * DATA LICENSE (the `STROKES`/`MEDIANS` arrays below): Arphic Public License,
 * see `vendor/ARPHICPL.txt` and `vendor/README.md`. This data is NOT MIT.
 * Source: Hanzi Writer Data (`正.json`, derived from Make Me a Hanzi, which
 * extracted it from Arphic Technology fonts). Single-character verbatim
 * subset; no modifications to the path data. No runtime network requests.
 *
 * The surrounding TypeScript in this file (types, constants, comments) is
 * original plugin code under the repository MIT license.
 *
 * Coordinate space: 900x900, y-axis pointing UP (Make Me a Hanzi convention).
 * Render with `<g transform="translate(0,900) scale(1,-1)">` inside
 * `viewBox="0 0 900 900"`, exactly as Hanzi Writer does.
 *
 * Canonical stroke order for 正 (verified against medians: top to bottom):
 * 1. top horizontal (横)
 * 2. central vertical (竖)
 * 3. middle horizontal (横)
 * 4. left vertical (竖)
 * 5. bottom horizontal (横)
 */

export const ZHENG_VIEWBOX = '0 0 900 900';

/** Y-up flip used by Hanzi Writer to render y-up data in y-down SVG. */
export const ZHENG_FLIP_TRANSFORM = 'translate(0,900) scale(1,-1)';

export const ZHENG_STROKE_COUNT = 5;

/** Filled-outline paths, canonical order 横/竖/横/竖/横. Verbatim upstream. */
export const ZHENG_STROKES: readonly string[] = [
  'M 505 667 Q 590 683 683 699 Q 744 712 754 720 Q 764 729 759 738 Q 752 751 719 761 Q 686 768 574 734 Q 421 701 321 693 Q 279 689 308 668 Q 354 641 431 655 Q 444 658 460 659 L 505 667 Z',
  'M 534 154 Q 537 298 539 420 L 540 457 Q 543 634 544 635 Q 543 638 542 638 Q 523 657 505 667 C 480 683 449 687 460 659 Q 484 596 485 591 Q 485 231 484 149 C 484 119 533 124 534 154 Z',
  'M 539 420 Q 578 411 616 422 Q 757 452 767 457 Q 777 466 772 475 Q 763 488 732 495 Q 699 501 667 487 Q 636 477 603 468 Q 573 462 540 457 C 510 452 510 426 539 420 Z',
  'M 346 135 Q 322 345 327 402 Q 328 427 312 441 Q 285 459 254 468 Q 238 472 228 465 Q 221 458 228 441 Q 253 399 266 354 Q 276 309 300 131 C 304 101 349 105 346 135 Z',
  'M 300 131 Q 203 124 100 114 Q 75 113 93 91 Q 109 73 131 66 Q 156 59 176 64 Q 467 131 884 110 Q 885 111 888 110 Q 912 109 918 119 Q 925 134 906 151 Q 839 203 784 190 Q 687 174 534 154 L 484 149 Q 417 143 346 135 L 300 131 Z',
];

/** Stroke median polylines (y-up), verbatim upstream; used for order checks. */
export const ZHENG_MEDIANS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [311, 682],
    [345, 674],
    [386, 674],
    [699, 733],
    [747, 732],
  ],
  [
    [469, 649],
    [499, 636],
    [510, 620],
    [514, 597],
    [510, 177],
    [490, 152],
  ],
  [
    [549, 451],
    [560, 438],
    [577, 439],
    [703, 469],
    [761, 468],
  ],
  [
    [238, 456],
    [287, 410],
    [321, 154],
    [337, 146],
  ],
  [
    [97, 102],
    [133, 91],
    [165, 91],
    [448, 126],
    [797, 153],
    [831, 151],
    [905, 127],
  ],
];
