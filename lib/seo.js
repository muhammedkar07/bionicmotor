'use strict';
// SEO yardımcıları: Türkçe uyumlu slug, başlık/açıklama üretimi ve schema.org (JSON-LD) yapıları.
// Amaç: her sayfada TEK ve BENZERSİZ başlık/açıklama + doğru canonical + yapısal veri.

const TR_MAP = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
  â: 'a',
  Â: 'a',
  î: 'i',
  û: 'u'
};

function slugify(v) {
  let out = '';
  for (const ch of String(v == null ? '' : v)) out += TR_MAP[ch] !== undefined ? TR_MAP[ch] : ch;
  return (
    out
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'x'
  );
}

// Kategori etiketleri (slug → okunabilir ad). Yeni kategori eklenirse adı olduğu gibi kullanılır.
const CAT_LABEL = {
  'e-scoter': 'Elektrikli Scooter',
  'e-scooter': 'Elektrikli Scooter',
  'e-tricycle': 'Elektrikli Tricycle',
  elektrikli: 'Elektrikli Motosiklet',
  touring: 'Touring Motosiklet',
  scooter: 'Scooter',
  motosiklet: 'Motosiklet'
};

function categoryLabel(cat) {
  const raw = String(cat == null ? '' : cat).trim();
  if (!raw) return 'Motosiklet';
  return CAT_LABEL[slugify(raw)] || raw;
}

function siteName(s) {
  const parts = [s && s.brand_1, s && s.brand_2].map(v => String(v == null ? '' : v).trim()).filter(Boolean);
  return parts.join(' ') || 'Bionic Motor';
}

const stripHtml = v =>
  String(v == null ? '' : v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Metni ~n karakterde, kelime ortasından kesmeden kısaltır.
function clipText(v, n) {
  const limit = n || 155;
  const t = stripHtml(v);
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const sp = cut.lastIndexOf(' ');
  return (sp > limit * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:!?\-–]+$/, '') + '…';
}

const modelPath = m => '/model/' + m.id + '/' + slugify(m.name);
const categoryPath = cat => '/modeller/' + slugify(cat);

function abs(origin, p) {
  const base = String(origin || '').replace(/\/+$/, '');
  const path = String(p || '/');
  return base + (path.startsWith('/') ? path : '/' + path);
}

// ---- Sayfa başlıkları / açıklamaları ----

function homeSeo(s) {
  const brand = siteName(s);
  return {
    title: brand + ' | Elektrikli Motosiklet, 50 cc Scooter ve Tricycle Modelleri',
    description:
      brand +
      ' — Mersin merkezli elektrikli motosiklet, scooter ve tricycle markası. 50 cc sınıfı modeller, yetkili satış noktaları, servis ve yedek parça desteği.'
  };
}

function modelsSeo(s) {
  const brand = siteName(s);
  return {
    title: 'Motosiklet ve Elektrikli Scooter Modelleri | ' + brand,
    description:
      brand +
      ' modelleri: elektrikli scooter, tricycle, 50 cc ve touring motosikletler. Teknik özellikler, fiyat bilgisi, yetkili satış ve servis noktaları.'
  };
}

function categorySeo(cat, models, s) {
  const brand = siteName(s);
  const label = categoryLabel(cat);
  const names = models.slice(0, 3).map(m => m.name);
  return {
    title: label + ' Modelleri ve Fiyatları | ' + brand,
    description: clipText(
      label +
        ' modelleri' +
        (names.length ? ': ' + names.join(', ') : '') +
        '. Teknik özellikler, fiyat bilgisi, garanti ve yetkili satış noktaları. ' +
        brand +
        ' kalitesiyle.',
      158
    )
  };
}

function modelSeo(m, s) {
  const brand = siteName(s);
  const label = categoryLabel(m.category);
  const specs = [m.cc && 'hız ' + m.cc, m.power && 'güç ' + m.power].filter(Boolean).join(', ');
  const desc = clipText(
    (m.description ? stripHtml(m.description) + ' ' : '') +
      (specs ? 'Teknik özellikler: ' + specs + '. ' : '') +
      'Fiyat bilgisi, garanti ve yetkili satış noktaları için ' +
      brand +
      '.',
    158
  );
  return {
    title: m.name + ' – ' + label + ' Fiyatı ve Özellikleri | ' + brand,
    description: desc
  };
}

function cityOf(s) {
  const a = String((s && s.address) || '').trim();
  const m = a.match(/\/\s*([^/,]+)\s*$/);
  if (m) {
    const c = m[1].trim();
    if (c) return c.charAt(0).toLocaleUpperCase('tr') + c.slice(1).toLocaleLowerCase('tr');
  }
  return String((s && s.branch) || '').trim();
}

function staticSeo(key, s) {
  const brand = siteName(s);
  const city = cityOf(s);
  const map = {
    points: {
      title: 'Yetkili Satış ve Servis Noktaları | ' + brand,
      description:
        brand +
        ' yetkili satış noktaları ve servisleri: il il adres, telefon ve harita bilgileri. Size en yakın satış ve servis noktasını bulun.'
    },
    support: {
      title: 'Destek, Garanti ve Sıkça Sorulan Sorular | ' + brand,
      description: brand + ' destek merkezi: garanti işlemleri, bakım ve onarım, yedek parça ve sıkça sorulan soruların yanıtları.'
    },
    contact: {
      title: 'İletişim – ' + (city || 'Türkiye') + ' | ' + brand,
      description: brand + ' iletişim: telefon, e-posta, adres ve harita. ' + (city || '') + ' merkezli ekibimizle iletişime geçin.'
    },
    apply: {
      title: 'Bayilik Başvurusu | ' + brand,
      description: brand + ' bayilik başvurusu: bulunduğunuz ilde yetkili satış ve servis noktası olmak için formu doldurun.'
    },
    media: {
      title: 'Medya ve Basın | ' + brand,
      description: brand + ' medya merkezi: basın bültenleri, marka görselleri ve haberler.'
    },
    catalog: {
      title: 'Dijital Katalog | ' + brand,
      description: brand + ' dijital katalog: tüm modeller, teknik özellikler ve fiyat bilgileri.'
    },
    notfound: {
      title: 'Sayfa Bulunamadı | ' + brand,
      description: 'Aradığınız sayfa taşınmış veya kaldırılmış olabilir. Ana sayfaya dönerek modelleri inceleyebilirsiniz.'
    }
  };
  return map[key] || { title: brand, description: clipText((s && s.meta_description) || brand, 158) };
}

function pageSeo(page, s) {
  const brand = siteName(s);
  const title = (page && page.meta_title && String(page.meta_title).trim()) || page.title + ' | ' + brand;
  const desc =
    (page && page.meta_description && String(page.meta_description).trim()) ||
    clipText((page && page.body) || page.title + ' — ' + brand, 158);
  return { title, description: desc };
}

// İçerik/statik sayfalar için yapısal veri (WebPage + güncelleme tarihi)
function pageJson(page, s, origin) {
  const j = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    url: origin + '/sayfa/' + page.slug,
    inLanguage: 'tr-TR',
    publisher: { '@type': 'Organization', name: siteName(s), url: origin + '/' }
  };
  const d = clipText(page.body, 200);
  if (d) j.description = d;
  if (page.updated_at) j.dateModified = String(page.updated_at).replace(' ', 'T') + 'Z';
  return j;
}

// ---- JSON-LD (schema.org) ----

function addrJson(s) {
  const a = String((s && s.address) || '').trim();
  // "Merkez Mah. ... Akdeniz / MERSİN" → şehir son "/" sonrası
  const m = a.match(/([^/,]+)\s*\/\s*([^/,]+)\s*$/);
  const city = m ? m[2].trim() : (s && s.branch) || '';
  const out = { '@type': 'PostalAddress', addressCountry: 'TR' };
  if (a) out.streetAddress = a;
  if (city) {
    out.addressLocality = city;
    out.addressRegion = city;
  }
  return out;
}

function socials(s) {
  return [s && s.facebook, s && s.instagram, s && s.youtube].filter(u => u && u !== '#');
}

function orgJson(s, origin, logo) {
  const j = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteName(s),
    url: origin + '/',
    logo
  };
  if (s.company) j.legalName = s.company;
  if (s.phone) j.telephone = String(s.phone).replace(/\s+/g, ' ');
  if (s.email) j.email = s.email;
  if (s.address) j.address = addrJson(s);
  const same = socials(s);
  if (same.length) j.sameAs = same;
  return j;
}

function dealerJson(s, origin, logo) {
  const j = {
    '@context': 'https://schema.org',
    '@type': 'MotorcycleDealer',
    name: siteName(s),
    url: origin + '/',
    image: logo,
    priceRange: '₺₺'
  };
  if (s.phone) j.telephone = String(s.phone).replace(/\s+/g, ' ');
  if (s.email) j.email = s.email;
  if (s.address) j.address = addrJson(s);
  const lat = Number(s.map_lat);
  const lng = Number(s.map_lng);
  if (lat && lng) j.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
  const same = socials(s);
  if (same.length) j.sameAs = same;
  return j;
}

function websiteJson(s, origin) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName(s),
    url: origin + '/',
    inLanguage: 'tr-TR',
    publisher: { '@type': 'Organization', name: siteName(s), url: origin + '/' }
  };
}

function breadcrumbJson(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url
    }))
  };
}

function productJson(m, s, origin, logo) {
  const brand = siteName(s);
  const j = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: m.name,
    description: clipText(m.description, 500) || m.name + ' — ' + brand,
    image: [m.image ? abs(origin, m.image) : logo],
    sku: 'BN-' + m.id,
    mpn: 'BN-' + m.id,
    category: categoryLabel(m.category),
    brand: { '@type': 'Brand', name: brand },
    url: abs(origin, modelPath(m))
  };
  const props = [];
  if (m.cc) props.push({ '@type': 'PropertyValue', name: 'Hız', value: String(m.cc) });
  if (m.power) props.push({ '@type': 'PropertyValue', name: 'Güç', value: String(m.power) });
  if (m.gearbox) props.push({ '@type': 'PropertyValue', name: 'Şanzıman', value: String(m.gearbox) });
  if (props.length) j.additionalProperty = props;
  if (m.price > 0) {
    j.offers = {
      '@type': 'Offer',
      url: abs(origin, modelPath(m)),
      price: (m.price / 100).toFixed(2),
      priceCurrency: 'TRY',
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: brand }
    };
  }
  return j;
}

function faqJson(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: stripHtml(f.answer) }
    }))
  };
}

function itemListJson(models, origin, name) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: models.length,
    itemListElement: models.map((m, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: m.name,
      url: abs(origin, modelPath(m))
    }))
  };
}

module.exports = {
  slugify,
  categoryLabel,
  cityOf,
  siteName,
  stripHtml,
  clipText,
  modelPath,
  categoryPath,
  abs,
  homeSeo,
  modelsSeo,
  categorySeo,
  modelSeo,
  staticSeo,
  pageSeo,
  pageJson,
  orgJson,
  dealerJson,
  websiteJson,
  breadcrumbJson,
  productJson,
  faqJson,
  itemListJson
};
