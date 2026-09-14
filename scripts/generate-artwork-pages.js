#!/usr/bin/env node
'use strict';

/*
 * Artwork page generator for waltviviers.com
 *
 * Reads data/artworks.json and writes one static detail page per artwork to
 *   gallery/<slug>/index.html
 * (the pages users actually see; /works/<slug>/ 301-redirects here).
 *
 * The page's static shell — the full <style> block, the head skeleton, the
 * language script, the enquiry/gx/share scripts and the floating buttons —
 * lives verbatim in scripts/_artwork_tpl/ (extracted from a live page), so the
 * generator only fills in the per-artwork parts. This keeps regenerated pages
 * byte-identical to the hand-maintained ones. Dependency-free (Node built-ins).
 *
 *   node scripts/generate-artwork-pages.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TPL  = path.join(__dirname, '_artwork_tpl');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'artworks.json'), 'utf8'));

const T = {
  head:         fs.readFileSync(path.join(TPL, 'head_template.html'), 'utf8'),
  css:          fs.readFileSync(path.join(TPL, 'style.css'), 'utf8'),
  bridge:       fs.readFileSync(path.join(TPL, 'style_bridge.html'), 'utf8'),
  bodyOpen:     fs.readFileSync(path.join(TPL, 'body_open.html'), 'utf8'),
  postMainSold: fs.readFileSync(path.join(TPL, 'post_main_sold.html'), 'utf8'),
  postMainOpen: fs.readFileSync(path.join(TPL, 'post_main_notsold.html'), 'utf8'),
  tail:         fs.readFileSync(path.join(TPL, 'tail.html'), 'utf8'),
};

/* ── helpers ─────────────────────────────────────────────── */

function slugify(title, year) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + year;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* on_show is presented as "available" (see the live pages) */
function statusInfo(available) {
  if (available === 'sold')     return { cls: 'sold',      key: 'status-sold',      text: 'Sold' };
  if (available === 'enquire')  return { cls: 'enquire',   key: 'status-enquire',   text: 'Enquire' };
  return { cls: 'available', key: 'status-available', text: 'Available' };
}

function buildMeta(w) {
  const st = statusInfo(w.available);
  const rows = [];
  if (w.medium)     rows.push({ key: 'meta-medium',     label: 'Medium',     value: escapeHtml(w.medium) });
  if (w.dimensions) rows.push({ key: 'meta-dimensions', label: 'Dimensions', value: escapeHtml(w.dimensions) });
  if (w.price)      rows.push({ key: 'meta-price',      label: 'Price',      value: escapeHtml(w.price) });
  rows.push({ key: 'meta-status', label: 'Status', value: `<span data-i18n="${st.key}">${st.text}</span>` });
  return rows.map(r =>
    `<div class="meta-row"><span class="meta-label" data-i18n="${r.key}">${r.label}</span><span class="meta-value">${r.value}</span></div>`
  ).join('\n      ');
}

function metaDescription(w) {
  if (w.description) {
    return escapeHtml(w.description.length > 160 ? w.description.slice(0, 157) + '…' : w.description);
  }
  return escapeHtml([
    `${w.title} by Walt Viviers.`,
    `${w.year}.`,
    w.medium ? `${w.medium}.` : '',
    w.dimensions ? `${w.dimensions}.` : '',
    w.available === 'available' ? 'Original available for acquisition.' : '',
    'Fine art by South African artist Walt Viviers, based in Pretoria.',
  ].filter(Boolean).join(' ').slice(0, 160));
}

function schemaJSON(w, slug, canonical, ogImage) {
  const st = statusInfo(w.available);
  const availability = w.available === 'sold'
    ? 'https://schema.org/SoldOut'
    : 'https://schema.org/InStock';
  const graph = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',     item: 'https://waltviviers.com/' },
        { '@type': 'ListItem', position: 2, name: 'Artworks', item: 'https://waltviviers.com/gallery/' },
        { '@type': 'ListItem', position: 3, name: w.title,    item: canonical },
      ],
    },
    Object.assign(
      {
        '@type': 'VisualArtwork',
        name:        w.title,
        dateCreated: String(w.year),
        image:       ogImage,
        url:         canonical,
        description: w.description || metaDescription(w).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        creator: {
          '@type': 'Person',
          name:    'Walt Viviers',
          url:     'https://waltviviers.com',
          address: { '@type': 'PostalAddress', addressLocality: 'Pretoria', addressRegion: 'Gauteng', addressCountry: 'ZA' },
        },
      },
      w.medium     ? { artMedium: w.medium } : {},
      w.dimensions ? { size: w.dimensions }  : {},
      (w.available === 'available' || w.available === 'on_show' || w.available === 'sold')
        ? { offers: { '@type': 'Offer', availability, url: canonical } }
        : {},
    ),
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

/* ── page ─────────────────────────────────────────────────── */

function mainHTML(w) {
  const slug     = slugify(w.title, w.year);
  const image800 = w.image.startsWith('images/') ? w.image.replace('images/', 'images/800/') : w.image;
  const altText  = `Walt Viviers, ${w.title}, ${w.year}${w.medium ? ', ' + w.medium : ''}`;
  const st       = statusInfo(w.available);

  const enquireBtn = (w.available !== 'sold')
    ? `<button class="btn btn-primary" onclick="toggleForm()" data-i18n="btn-enquire">Enquire about this work</button>`
    : `<span class="btn btn-secondary" style="pointer-events:none;opacity:0.5" data-i18n="status-sold">Sold</span>`;

  const descBlock = w.description ? `
    <div class="artwork-desc">
      <p id="artwork-description" data-en="${escapeHtml(w.description)}" data-af="${escapeHtml(w.description_af || w.description)}">${escapeHtml(w.description)}</p>
    </div>` : '';

  const enquiryForm = (w.available !== 'sold') ? `
  <div class="enquiry-section" id="enquiry-section" hidden>
    <form id="enquiry-form" style="margin-top:24px">
      <input type="hidden" name="_subject" value="Enquiry: ${escapeHtml(w.title)}" />
      <input type="hidden" name="artwork"  value="${escapeHtml(w.title + ', ' + w.year)}" />
      <div class="form-group">
        <label for="f-name">Name</label>
        <input type="text" id="f-name" name="name" required autocomplete="name" />
      </div>
      <div class="form-group">
        <label for="f-email">Email</label>
        <input type="email" id="f-email" name="email" required autocomplete="email" />
      </div>
      <div class="form-group">
        <label for="f-msg">Message</label>
        <textarea id="f-msg" name="message" rows="4" placeholder="I'm interested in this work…"></textarea>
      </div>
      <p class="form-error" id="form-error" hidden></p>
      <button type="submit" class="btn btn-primary" id="submit-btn" style="margin-top:4px">Send enquiry</button>
    </form>
    <div class="form-success" id="form-success" hidden>
      <p>Thank you — your message has been sent. Walt will be in touch shortly.</p>
      <a href="/" class="btn btn-secondary">Back to gallery</a>
    </div>
  </div>` : '';

  const instagramLink = w.instagram
    ? `\n  <div style="margin-top:24px;text-align:center"><a href="${escapeHtml(w.instagram)}" target="_blank" rel="noopener" style="font-size:0.8rem;letter-spacing:0.06em;text-transform:uppercase;opacity:0.5" data-i18n="btn-instagram">View on Instagram ↗</a></div>`
    : '';

  return `  <main class="artwork-wrap">
    <img class="artwork-img"
         src="/${w.image}"
         srcset="/${image800} 800w, /${w.image} 1600w"
         sizes="(max-width: 900px) 100vw, 900px"
         alt="${escapeHtml(altText)}"
         fetchpriority="high" />

    <div class="artwork-header">
      <div>
        <h1>${escapeHtml(w.title)}</h1>
        <div class="artwork-year">${escapeHtml(String(w.year))}</div>
      </div>
      <span class="status-badge ${st.cls}" data-i18n="${st.key}">${st.text}</span>
    </div>

    <div class="artwork-meta">
      ${buildMeta(w)}
    </div>

    <div class="artwork-actions">
      ${enquireBtn}
      <a href="/gallery/" class="btn btn-secondary" data-i18n="btn-all-works">View all works</a>
      <button type="button" class="btn btn-secondary" onclick="shareArtwork(this)">Share</button>
    </div>
    ${descBlock}
    ${enquiryForm}${instagramLink}
  </main>`;
}

function generatePage(w) {
  const slug      = slugify(w.title, w.year);
  const canonical = `https://waltviviers.com/gallery/${slug}/`;
  const ogImage   = `https://waltviviers.com/${w.image}`;
  const image800  = w.image.startsWith('images/') ? w.image.replace('images/', 'images/800/') : w.image;
  const altText   = `Walt Viviers, ${w.title}, ${w.year}${w.medium ? ', ' + w.medium : ''}`;
  const pageTitle = `${escapeHtml(w.title)}, ${w.year} — Walt Viviers`;
  const metaDesc  = metaDescription(w);

  const head = T.head
    .split('%%SCHEMA%%').join(schemaJSON(w, slug, canonical, ogImage))
    .split('%%PAGETITLE%%').join(pageTitle)
    .split('%%METADESC%%').join(metaDesc)
    .split('%%CANONICAL%%').join(canonical)
    .split('%%OGIMAGE%%').join(ogImage)
    .split('%%ALT%%').join(escapeHtml(altText))
    .split('%%PRELOAD%%').join('/' + image800);

  const postMain = (w.available === 'sold') ? T.postMainSold : T.postMainOpen;

  return head + '  <style>' + T.css + T.bridge + T.bodyOpen +
         mainHTML(w) + postMain + T.tail + '</body>\n</html>';
}

/* ── write ────────────────────────────────────────────────── */

const galleryDir = path.join(ROOT, 'gallery');
let generated = 0;
for (const w of data.artworks) {
  const slug    = slugify(w.title, w.year);
  const pageDir = path.join(galleryDir, slug);
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'index.html'), generatePage(w), 'utf8');
  generated++;
}

console.log(`Generated ${generated} artwork pages in gallery/.`);
