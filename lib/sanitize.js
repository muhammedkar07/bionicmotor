const sanitizeHtml = require('sanitize-html');

// Sayfa içerikleri (admin tarafından girilen HTML) ziyaretçiye ham gösterilmez;
// güvenli etiket/öznitelik listesine göre temizlenir (saklı XSS'i önler).
const OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'img',
    'blockquote',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'span',
    'div',
    'figure',
    'figcaption'
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    '*': ['class']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } })
  }
};

const clean = html => sanitizeHtml(String(html == null ? '' : html), OPTIONS);

module.exports = { clean };
