const sanitizeHtml = require('sanitize-html');

const mediaPathPattern = /^\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp|gif|mp4|webm)$/i;

const richContentOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'div',
    'span', 'a', 'figure', 'figcaption', 'img', 'video', 'source', 'iframe'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['style'],
    p: ['style'],
    div: ['style'],
    h2: ['style'],
    h3: ['style'],
    h4: ['style'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    video: ['controls', 'preload', 'width', 'height'],
    source: ['src', 'type'],
    iframe: ['src', 'title', 'width', 'height', 'loading', 'referrerpolicy', 'sandbox', 'allowfullscreen']
  },
  allowedStyles: {
    span: {
      color: [/^#[a-f\d]{6}$/i],
      'font-size': [/^(?:12|14|16|18|24|32)px$/]
    },
    p: { 'text-align': [/^(?:left|center|right|justify)$/] },
    div: { 'text-align': [/^(?:left|center|right|justify)$/] },
    h2: { 'text-align': [/^(?:left|center|right|justify)$/] },
    h3: { 'text-align': [/^(?:left|center|right|justify)$/] },
    h4: { 'text-align': [/^(?:left|center|right|justify)$/] }
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedIframeHostnames: ['www.youtube-nocookie.com', 'player.vimeo.com'],
  transformTags: {
    a: (tagName, attributes) => ({
      tagName,
      attribs: {
        ...attributes,
        target: '_blank',
        rel: 'noopener noreferrer'
      }
    }),
    img: (tagName, attributes) => ({
      tagName,
      attribs: mediaPathPattern.test(attributes.src || '') ? attributes : {}
    }),
    video: (tagName, attributes) => ({
      tagName,
      attribs: { controls: '', preload: 'metadata' }
    }),
    source: (tagName, attributes) => ({
      tagName,
      attribs: mediaPathPattern.test(attributes.src || '') ? attributes : {}
    }),
    iframe: (tagName, attributes) => {
      const source = attributes.src || '';
      const isAllowedVideo = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[a-zA-Z0-9_-]{11}(?:\?[a-zA-Z0-9_=&%-]*)?$/.test(source)
        || /^https:\/\/player\.vimeo\.com\/video\/\d+(?:\?[a-zA-Z0-9_=&%-]*)?$/.test(source);
      return {
        tagName,
        attribs: isAllowedVideo
          ? {
            ...attributes,
            sandbox: 'allow-scripts allow-same-origin allow-presentation',
            loading: 'lazy',
            referrerpolicy: 'strict-origin-when-cross-origin'
          }
          : {}
      };
    }
  }
};

function sanitizeRichContent(content) {
  return sanitizeHtml(typeof content === 'string' ? content : '', richContentOptions);
}

function richContentToText(content) {
  return sanitizeHtml(typeof content === 'string' ? content : '', {
    allowedTags: [],
    allowedAttributes: {}
  }).replace(/&nbsp;/g, ' ').trim();
}

function isValidRichContent(content, maxLength, minTextLength = 1) {
  if (typeof content !== 'string' || content.length > maxLength) return false;
  const sanitized = sanitizeRichContent(content);
  const hasText = richContentToText(sanitized).length > 0;
  const hasUploadedMedia = /<(?:img|source)\b[^>]*\bsrc="\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp|gif|mp4|webm)"/i.test(sanitized);
  const hasVideoEmbed = /<iframe\b[^>]*\bsrc="https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[a-zA-Z0-9_-]{11}|player\.vimeo\.com\/video\/\d+)/i.test(sanitized);
  return richContentToText(sanitized).length >= minTextLength || hasUploadedMedia || hasVideoEmbed;
}

module.exports = { isValidRichContent, richContentToText, sanitizeRichContent };
