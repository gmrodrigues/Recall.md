import { MIN_STUDY_MINUTES, classifyMaterialLink, materialLinks, materialPages } from '../src/material.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const external = 'target="_blank" rel="noopener noreferrer"';
function anchor(link, label = link.label || link.url, markup = '') {
  return '<a href="' + escape(link.url) + '" data-reading-link ' + external + '>' + (markup || escape(label)) +
    '<span class="material-link-state" hidden>Visitado</span></a>';
}

function linkText(content, collect) {
  let end = 0;
  let output = '';
  for (const { index, match, url: raw, label, suffix } of materialLinks(content)) {
    output += escape(content.slice(end, index));
    const link = collect({ url: raw, label });
    output += link ? anchor(link, label || raw) + escape(suffix) : escape(match);
    end = index + match.length;
  }
  return output + escape(content.slice(end));
}

function mediaMarkup(link) {
  const label = link.label || (link.kind === 'image' ? 'Imagem do material' : 'Vídeo do material');
  let media;
  if (link.kind === 'image') {
    media = anchor(link, label, '<img src="' + escape(link.url) +
      '" alt="' + escape(label) + '" loading="lazy" referrerpolicy="no-referrer">');
  } else if (link.kind === 'embed') {
    media = '<div class="material-player"><button type="button" class="button primary" data-play-material="' +
      escape(link.embed) + '" data-video-title="' + escape(label) + '">Reproduzir vídeo</button></div>';
  } else {
    media = '<video controls playsinline preload="none" src="' + escape(link.url) + '" aria-label="' + escape(label) + '"></video>';
  }
  return '<figure class="material-media-item">' + media + '<figcaption>' + escape(link.label) +
    (link.label ? ' · ' : '') + anchor(link, 'Abrir original') + '</figcaption></figure>';
}

export function renderStudyTime(time) {
  const estimated = Math.max(MIN_STUDY_MINUTES, time?.estimatedMinutes || 0) + ' min previstos';
  const actual = time?.actualMinutes ? time.actualMinutes + ' min realizados' : 'Sem tempo realizado registrado';
  return '<p class="material-study-time">' + estimated + ' · ' + actual + '</p>';
}

export function renderMaterial(unit, pageId, progress, time) {
  const pages = materialPages(unit);
  const index = Math.max(0, pages.findIndex(page => page.id === pageId));
  const page = pages[index];
  const visited = new Set(progress?.visited || []);
  const read = pages.filter(item => visited.has(item.id)).length;
  const gallery = new Map();
  const overrides = new Map(page.sections.flatMap(section => section.links || [])
    .map(link => classifyMaterialLink(link)).filter(Boolean).map(link => [link.url, link]));
  function collect(raw) {
    const recognized = classifyMaterialLink(raw);
    if (!recognized) return null;
    const link = overrides.get(recognized.url) || recognized;
    if (link.kind !== 'link' && !gallery.has(link.url)) gallery.set(link.url, link);
    return link;
  }
  const sections = page.sections.map(section => {
    const title = section.title ? '<h5>' + escape(section.title) + '</h5>' : '';
    const content = section.text ? '<div class="prose">' + linkText(section.text, collect) + '</div>' : '';
    const links = (section.links || []).map(collect).filter(link => link?.kind === 'link');
    return '<section class="material-section">' + title + content +
      (links.length ? '<ul class="material-links">' + links.map(link => '<li>' + anchor(link) + '</li>').join('') + '</ul>' : '') + '</section>';
  }).join('');
  const controls = pages.length > 1 ? '<nav class="material-pagination" aria-label="Páginas do material">' +
    '<button type="button" class="button secondary" data-material-page="' + escape(pages[index - 1]?.id) + '" ' + (!index ? 'disabled' : '') + '>Anterior</button>' +
    '<label>Página<select id="material-page-select">' + pages.map((item, i) => '<option value="' + escape(item.id) + '" ' +
      (item.id === page.id ? 'selected' : '') + '>' + (i + 1) + '. ' + escape(item.title) + '</option>').join('') + '</select></label>' +
    '<button type="button" class="button secondary" data-material-page="' + escape(pages[index + 1]?.id) + '" ' +
      (index === pages.length - 1 ? 'disabled' : '') + '>Próxima</button></nav>' : '';
  return '<div class="panel-title"><h3>Material de estudo</h3><button class="button secondary" type="button" data-edit-reading>Editar material</button></div>' +
    '<div data-material-study-time>' + renderStudyTime(time) + '</div>' +
    '<div class="material-progress"><progress aria-label="Progresso de leitura" max="' + pages.length + '" value="' + read + '"></progress>' +
    '<span aria-live="polite">' + read + ' de ' + pages.length + ' ' + (pages.length === 1 ? 'página visitada' : 'páginas visitadas') + '</span></div>' +
    controls + '<article class="material-page" aria-label="' + escape(page.title) + '">' +
    (unit.material?.length ? '<h4 tabindex="-1">' + escape(page.title) + '</h4>' : '') +
    (sections && page.sections.some(section => section.title || section.text || section.links?.length)
      ? sections : '<p class="empty">Adicione o material desta página.</p>') +
    (index === 0 && unit.sources?.length ? '<h5>Referências</h5><ul class="material-links">' +
      unit.sources.map(source => '<li>' + linkText(source, collect) + '</li>').join('') + '</ul>' : '') +
    (gallery.size ? '<section class="material-media"><h5>Mídias da página</h5>' + [...gallery.values()].map(mediaMarkup).join('') + '</section>' : '') +
    '</article><div class="material-reading-actions"><button type="button" class="button secondary" data-finish-reading>Concluir esta página</button></div>';
}

export function playMaterial(button) {
  const source = new URL(button.dataset.playMaterial);
  source.searchParams.set('autoplay', '1');
  const frame = document.createElement('iframe');
  frame.src = source.href;
  frame.title = button.dataset.videoTitle;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  button.replaceWith(frame);
  frame.focus();
}

const linkTypes = [['auto', 'Automático'], ['link', 'Link'], ['image', 'Imagem'], ['video', 'Vídeo']];

function attachment(link = {}) {
  return '<div class="material-attachment" data-reading-attachment>' +
    '<label>URL<input name="url" type="url" required value="' + escape(link.url) + '"></label>' +
    '<label>Tipo<select name="type">' + linkTypes.map(([value, label]) => '<option value="' + value + '" ' +
      (value === link.type ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
    '<label>Rótulo<input name="label" maxlength="200" value="' + escape(link.label) + '"></label>' +
    '<button type="button" class="button secondary" data-reading-edit="delete-attachment">Remover anexo</button></div>';
}

function section(entry = {}) {
  return '<fieldset class="material-edit-section" data-reading-section><legend>Seção</legend>' +
    '<label>Título da seção<input name="sectionTitle" maxlength="200" value="' + escape(entry.title) + '"></label>' +
    '<label>Texto da seção<textarea name="sectionText" rows="4">' + escape(entry.text) + '</textarea></label>' +
    '<div data-reading-attachments>' + (entry.links || []).map(attachment).join('') + '</div>' +
    '<div class="material-edit-actions"><button type="button" class="button secondary" data-reading-edit="add-attachment">Adicionar link ou mídia</button>' +
    '<button type="button" class="button secondary" data-reading-edit="delete-section">Remover seção</button></div></fieldset>';
}

function pageEditor(page) {
  return '<fieldset class="material-edit-page" data-reading-page="' + escape(page.id) + '"><legend>Página</legend>' +
    '<label>Título da página<input name="pageTitle" required maxlength="200" value="' + escape(page.title) + '"></label>' +
    '<div data-reading-sections>' + page.sections.map(section).join('') + '</div>' +
    '<div class="material-edit-actions"><button type="button" class="button secondary" data-reading-edit="add-section">Adicionar seção</button>' +
    '<button type="button" class="button secondary" data-reading-edit="delete-page">Remover página</button></div></fieldset>';
}

export function editReading(dialog, unit, save) {
  dialog.innerHTML = '<form><header class="dialog-heading"><h2 id="reading-editor-title">Editar material</h2>' +
    '<button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button></header>' +
    '<p>Cole URLs no texto ou adicione links com rótulo. As imagens e os vídeos reconhecidos aparecem no fim da página.</p>' +
    '<div data-reading-pages>' + materialPages(unit).map(pageEditor).join('') + '</div>' +
    '<button type="button" class="button secondary" data-reading-edit="add-page">Adicionar página</button>' +
    '<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary close-dialog">Cancelar</button>' +
    '<button type="submit" class="button primary">Salvar material</button></div></form>';
  const form = dialog.querySelector('form');
  form.addEventListener('click', event => {
    const button = event.target.closest('[data-reading-edit]');
    if (!button) return;
    const page = button.closest('[data-reading-page]');
    const currentSection = button.closest('[data-reading-section]');
    switch (button.dataset.readingEdit) {
      case 'add-page': {
        const container = form.querySelector('[data-reading-pages]');
        const id = crypto.randomUUID();
        container.insertAdjacentHTML('beforeend', pageEditor({ id, title: '', sections: [{}] }));
        container.lastElementChild.querySelector('input').focus();
        break;
      }
      case 'add-section':
        page.querySelector('[data-reading-sections]').insertAdjacentHTML('beforeend', section());
        page.querySelector('[data-reading-sections]').lastElementChild.querySelector('input').focus();
        break;
      case 'add-attachment':
        currentSection.querySelector('[data-reading-attachments]').insertAdjacentHTML('beforeend', attachment());
        currentSection.querySelector('[data-reading-attachments]').lastElementChild.querySelector('input').focus();
        break;
      case 'delete-page':
        if (form.querySelectorAll('[data-reading-page]').length > 1) page.remove();
        else form.querySelector('.form-error').textContent = 'Mantenha ao menos uma página de material.';
        break;
      case 'delete-section': currentSection.remove(); break;
      case 'delete-attachment': button.closest('[data-reading-attachment]').remove(); break;
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    const val = (element, name) => element.querySelector('[name="' + name + '"]').value;
    const pages = [...form.querySelectorAll('[data-reading-page]')].map(page => ({
      id: page.dataset.readingPage,
      title: val(page, 'pageTitle'),
      sections: [...page.querySelectorAll('[data-reading-section]')].map(entry => ({
        title: val(entry, 'sectionTitle'), text: val(entry, 'sectionText'),
        links: [...entry.querySelectorAll('[data-reading-attachment]')].map(link => ({
          url: val(link, 'url'), type: val(link, 'type'), label: val(link, 'label'),
        })),
      })),
    }));
    try {
      await save(pages);
      dialog.close();
    } catch (error) {
      form.querySelector('.form-error').textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  dialog.showModal();
}
