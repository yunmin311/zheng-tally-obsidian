import { alignedReadingHits } from '../src/reading-source';

describe('reading entity decoding is text-only', () => {
  test('works when the host rejects HTML assignment', () => {
    const htmlSink = jest.spyOn(Element.prototype, 'innerHTML', 'set')
      .mockImplementation(() => { throw new Error('HTML assignment is forbidden'); });
    try {
      expect(alignedReadingHits('A &amp; B 正<!--zt:5-->', 'A & B 正', true))
        .toEqual([{ from: 3, to: 4, count: 5 }]);
    } finally {
      htmlSink.mockRestore();
    }
  });

  test.each([
    ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'],
    ['&quot;', '"'], ['&apos;', "'"], ['&AMP;', '&'],
    ['&#38;', '&'], ['&#x26;', '&'], ['&#X1F642;', '🙂'],
    ['&#0;', '\uFFFD'], ['&#xD800;', '\uFFFD'],
    ['&#x110000;', '\uFFFD'], ['&#128;', '€'],
    ['&APOS;', '&APOS;'], ['&unknown;', '&unknown;'],
  ])('retains HTML text semantics for %s', (entity, text) => {
    expect(alignedReadingHits(`${entity}正<!--zt:5-->`, `${text}正`, true))
      .toEqual([{ from: text.length, to: text.length + 1, count: 5 }]);
  });

  test('encoded markup stays text and does not create DOM elements', () => {
    const text = '<img src=x onerror=alert(1)>正';
    expect(alignedReadingHits('&lt;img src=x onerror=alert(1)&gt;正<!--zt:5-->', text, true))
      .toEqual([{ from: 26, to: 27, count: 5 }]);
    expect(document.querySelector('img')).toBeNull();
  });
});
