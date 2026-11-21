export const FIRST_PAGE = 'material';
export const MIN_STUDY_MINUTES = 5;

export function materialPages(unit) {
  return unit.material?.length ? unit.material : [{
    id: FIRST_PAGE,
    title: 'Material de estudo',
    sections: [{ title: '', text: unit.description || '', links: [] }],
  }];
}

export function materialURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {}
  return null;
}

export function mergeReadingProgress(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  const last = next.changedAt >= previous.changedAt ? next : previous;
  return { ...last, visited: [...new Set([...previous.visited, ...next.visited])] };
}

const imageFormat = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const videoFormat = /\.(?:mp4|webm|ogv|ogg|mov|m4v|m3u8|mpd)$/i;

export function classifyMaterialLink(link) {
  const url = materialURL(link.url);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const [first, second] = url.pathname.split('/').filter(Boolean);
  let embed;
  if (['youtu.be', 'youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    const id = host === 'youtu.be' ? first : first === 'watch' ? url.searchParams.get('v')
      : ['embed', 'shorts', 'live'].includes(first) ? second : null;
    if (id && /^[\w-]{11}$/.test(id)) {
      embed = 'https://www.youtube-nocookie.com/embed/' + id;
      const start = url.searchParams.get('start') || url.searchParams.get('t');
      if (start && /^\d+s?$/.test(start)) embed += '?start=' + Number.parseInt(start, 10);
    }
  } else if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
    const id = [first, second, ...url.pathname.split('/').slice(3)].filter(Boolean).findLast(part => /^\d+$/.test(part));
    if (id) {
      embed = 'https://player.vimeo.com/video/' + id;
      const segments = url.pathname.split('/').filter(Boolean);
      const token = url.searchParams.get('h') || (first === id && second);
      if (segments.includes(id) && token && /^[a-f\d]+$/i.test(token)) embed += '?h=' + token;
    }
  } else if (['dailymotion.com', 'dai.ly'].includes(host)) {
    const id = host === 'dai.ly' ? first : first === 'video' ? second : null;
    if (id && /^[a-z\d]+$/i.test(id)) embed = 'https://www.dailymotion.com/embed/video/' + id;
  }
  const type = link.type || 'auto';
  const kind = type === 'link' || type === 'image' ? type : embed ? 'embed'
    : type === 'video' || videoFormat.test(url.pathname) ? 'video'
    : imageFormat.test(url.pathname) ? 'image' : 'link';
  return { kind, url: url.href, embed, label: link.label || '' };
}


export function materialLinks(content) {
  const pattern = /!?\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/gi;
  return [...content.matchAll(pattern)].map(match => {
    const url = match[2] || match[3].replace(/[.,;:!?)\]]+$/, '');
    return { url, label: match[1], suffix: match[3]?.slice(url.length) || '', index: match.index, match: match[0] };
  });
}

export const DEFAULT_LINK_MINUTES = 5;

export function materialLinkIdentity(link) {
  const url = new URL(link.embed || link.url);
  url.hash = '';
  if (link.embed) url.searchParams.delete('start');
  return url.href;
}

export function materialPageLinks(unit, pageId) {
  const pages = materialPages(unit);
  const index = pages.findIndex(page => page.id === pageId);
  if (index < 0) return [];
  const page = pages[index];
  const overrides = new Map(page.sections.flatMap(section => section.links || [])
    .map(classifyMaterialLink).filter(Boolean).map(link => [link.url, link]));
  const result = new Map();
  function add(raw) {
    const link = classifyMaterialLink(raw);
    if (link && !result.has(link.url)) result.set(link.url, overrides.get(link.url) || link);
  }
  for (const section of page.sections) {
    materialLinks(section.text || '').forEach(add);
    (section.links || []).forEach(add);
  }
  if (index === 0) (unit.sources || []).flatMap(materialLinks).forEach(add);
  return [...result.values()];
}

export function materialResources(unit) {
  const videos = new Map();
  const readingLinks = new Map();
  for (const page of materialPages(unit)) {
    for (const link of materialPageLinks(unit, page.id)) {
      if (link.kind === 'link') {
        const url = new URL(link.url);
        url.hash = '';
        readingLinks.set(url.href, url.hostname.replace(/^www\./, ''));
      } else if (link.kind === 'video' || link.kind === 'embed') {
        const id = link.embed ? link.embed.split('?')[0] : link.url;
        if (!videos.has(id)) videos.set(id, { id, url: link.url, kind: link.kind, ...(link.embed ? { embed: link.embed } : {}) });
      }
    }
  }
  const linkCounts = new Map();
  for (const domain of readingLinks.values()) linkCounts.set(domain, (linkCounts.get(domain) || 0) + 1);
  return {
    videos: [...videos.values()],
    links: [...linkCounts].map(([domain, count]) => ({ domain, count })),
  };
}
