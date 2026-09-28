import asciidoctorTheme from '../../../../node_modules/@asciidoctor/core/data/asciidoctor-default.css?raw';
import highlightTheme from '../../../../node_modules/highlight.js/styles/github.css?raw';

const localCss = (css: string) => css
  .replaceAll(/@import\s+[^;]+;/gi, '')
  .replaceAll(/url\(\s*(['"]?)(?!#)[^)]+\1\s*\)/gi, 'none');

export const asciidoctorPreviewCss = localCss(asciidoctorTheme);
export const highlightPreviewCss = localCss(highlightTheme);
