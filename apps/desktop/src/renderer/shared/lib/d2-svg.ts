import { validWebLink } from '@metis/contracts';

const tags = new Set(('svg g defs style text tspan textpath title desc path rect circle ellipse line polyline polygon marker pattern mask clippath symbol use lineargradient radialgradient stop filter feblend fecolormatrix fecomponenttransfer fecomposite feconvolvematrix fediffuselighting fedisplacementmap fedistantlight fedropshadow feflood fefunca fefuncb fefuncg fefuncr fegaussianblur femerge femergenode femorphology feoffset fepointlight fespecularlighting fespotlight fetile feturbulence image a foreignobject div span p br strong em b i u s del pre code blockquote ul ol li h1 h2 h3 h4 h5 h6 hr table thead tbody tr th td sub sup img math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd semantics annotation').split(' '));
const attributes = new Set(('xmlns xmlns:xlink id class style version viewbox preserveaspectratio x y x1 x2 y1 y2 dx dy width height rx ry cx cy r d points transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity vector-effect marker-start marker-mid marker-end markerwidth markerheight markerunits refx refy orient gradientunits gradienttransform offset stop-color stop-opacity patternunits patterncontentunits patterntransform clip-path clip-rule clippathunits mask maskunits maskcontentunits filter filterunits primitiveunits in in2 result type values stddeviation flood-color flood-opacity color-interpolation-filters mode operator k1 k2 k3 k4 scale xchannelselector ychannelselector basefrequency numoctaves seed stitchtiles surfaceScale diffuseconstant specularconstant specularexponent limitingconeangle azimuth elevation pointsatx pointsaty pointsatz z targetx targety order kernelmatrix divisor bias edgemode kernelunitlength preservealpha radius slope intercept amplitude exponent tablevalues href xlink:href src alt title role aria-label aria-hidden font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline text-decoration letter-spacing word-spacing lengthadjust textlength display visibility overflow color direction unicode-bidi writing-mode line-height colspan rowspan start mathvariant mathsize mathcolor mathbackground displaystyle scriptlevel stretch symmetry symmetric minsize maxsize lspace rspace linethickness rowalign columnalign rowspacing columnspacing encoding accent accentunder fence separator').toLowerCase().split(' '));
for (const name of ['xml:space', 'text-rendering', 'shape-rendering', 'font-variant', 'font-stretch', 'white-space']) attributes.add(name);

const imageUrl = (value: string) => /^https:\/\/[^\s<>"']+$/i.test(value) || /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z\d+/=\s]+$/i.test(value);
const webUrl = (value: string): boolean => validWebLink(value);
function cleanCss(css: string): string {
  return css.replaceAll(/@import\s+[^;]+;?/gi, '')
    .replaceAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, url: string) => /^(?:#[\w:.-]+|data:(?:font\/[\w.+-]+|application\/(?:font-woff|x-font-ttf));base64,[a-z\d+/=]+)$/i.test(url) ? `url("${url}")` : 'none')
    .replaceAll(/(?:expression|javascript|behavior|-moz-binding)\s*[:(][^;}]*[;}]?/gi, '');
}

/** D2 needs images, embedded fonts, Markdown/MathML and CSS animations. This
 * policy is distinct from Mermaid's intentionally smaller SVG vocabulary. */
export function safeD2Svg(svg: string): string {
  if (!svg) return '';
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return '';
  for (const element of [doc.documentElement, ...doc.querySelectorAll('*')]) {
    if (!tags.has(element.localName.toLowerCase()) || !['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1998/Math/MathML'].includes(element.namespaceURI ?? '')) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      if (!attributes.has(name)) { element.removeAttribute(attribute.name); continue; }
      if (name === 'style') { element.setAttribute(attribute.name, cleanCss(value)); continue; }
      if (name === 'href' || name === 'xlink:href' || name === 'src') {
        const tag = element.localName.toLowerCase();
        if (tag === 'a') {
          element.removeAttribute(attribute.name);
          if (webUrl(value)) { element.setAttribute('href', '#'); element.setAttribute('data-web-url', value); }
          else if (value.startsWith('#')) element.setAttribute('href', value);
          else if (/^[\w./-]+(?:\.svg)?$/.test(value)) { element.setAttribute('href', '#'); element.setAttribute('data-d2-board-link', value); }
        } else if (tag === 'image' || tag === 'img') {
          if (!imageUrl(value)) element.removeAttribute(attribute.name);
          else if (tag === 'img') element.setAttribute('referrerpolicy', 'no-referrer');
        } else if (!value.startsWith('#')) element.removeAttribute(attribute.name);
      } else if (/url\s*\(/i.test(value)) element.setAttribute(attribute.name, cleanCss(value));
    }
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = cleanCss(style.textContent ?? '');
  return new XMLSerializer().serializeToString(doc.documentElement);
}
