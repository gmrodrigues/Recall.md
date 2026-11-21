const TIMEOUT = 8000;

function duration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 86400 ? value : null;
}

function nativeDuration(url) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    const done = value => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(duration(value));
    };
    const timer = setTimeout(() => done(null), TIMEOUT);
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(video.duration);
    video.onerror = () => done(null);
    video.src = url;
  });
}

function playerDuration(source, host) {
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.className = 'video-metadata-frame';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const id = 'recall-duration-' + Math.random().toString(36).slice(2);
    const youtube = source.hostname === 'www.youtube-nocookie.com';
    if (youtube) {
      source.searchParams.set('enablejsapi', '1');
      source.searchParams.set('origin', location.origin);
    }
    function send(message) {
      frame.contentWindow?.postMessage(youtube ? JSON.stringify(message) : message, source.origin);
    }
    function query() {
      if (youtube) {
        send({ event: 'listening', id });
        send({ event: 'command', func: 'getDuration', args: [], id });
      } else send({ method: 'getDuration' });
    }
    function onMessage(event) {
      if (event.source !== frame.contentWindow || event.origin !== source.origin) return;
      let payload = event.data;
      try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { return; }
      const seconds = duration(youtube ? payload?.info?.duration
        : payload?.method === 'getDuration' ? payload.value : null);
      if (seconds) done(seconds);
    }
    function done(value) {
      clearInterval(repeat);
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(value);
    }
    const timer = setTimeout(() => done(null), TIMEOUT);
    const repeat = setInterval(query, 450);
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', query, { once: true });
    frame.src = source.href;
    host.append(frame);
  });
}

export async function probeVideo(video, host) {
  if (video.kind !== 'embed') return nativeDuration(video.url);
  const source = new URL(video.embed);
  if (source.hostname === 'www.dailymotion.com') {
    try {
      const id = encodeURIComponent(source.pathname.split('/').at(-1));
      const response = await fetch('https://api.dailymotion.com/video/' + id + '?fields=duration', {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (response.ok) return duration((await response.json()).duration);
    } catch {}
    return null;
  }
  return playerDuration(source, host);
}

export async function sampleVideoDurations(videos, progress, probe, random = Math.random) {
  const pool = [...new Map(videos.map(video => [video.id, video])).values()];
  const count = Math.min(5, pool.length);
  for (let index = 0; index < count; index++) {
    const chosen = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[chosen]] = [pool[chosen], pool[index]];
  }
  let checked = 0;
  progress(0, count);
  const results = await Promise.all(pool.slice(0, count).map(async video => {
    let seconds;
    try { seconds = duration(await probe(video)); } catch {}
    progress(++checked, count);
    return seconds ? { id: video.id, seconds } : null;
  }));
  return results.filter(Boolean);
}
