import { expect, test } from 'vitest';
import { youtubeReferer } from './youtube-player';
test('desktop player identity is added only to our YouTube embed frame requests', () => {
  const url = 'https://www.youtube-nocookie.com/embed/rPQoq7ThGAU?rel=0';
  expect(youtubeReferer(url, 'subFrame', 1, 1)).toBe('https://comnori.metis/');
  expect(youtubeReferer(url, 'mainFrame', 1, 1)).toBeUndefined();
  expect(youtubeReferer(url, 'subFrame', 2, 1)).toBeUndefined();
  expect(youtubeReferer('https://evil.test/embed/rPQoq7ThGAU', 'subFrame', 1, 1)).toBeUndefined();
});
