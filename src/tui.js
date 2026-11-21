import { STATUSES, ensure } from './core.js';
import { backlogContext, autoLink, synchronize } from './backlog.js';
import { clean, fit, wrap, color, runTerminal } from './terminal.js';

const clamp = (n, max) => Math.max(0, Math.min(n, Math.max(0, max)));
const down = key => ['down', 'j'].includes(key), up = key => ['up', 'k'].includes(key);
const left = key => ['left', 'h'].includes(key), right = key => ['right', 'l'].includes(key);
const field = (name, label, value = '', multiline = false) => ({ name, label, value, multiline });

export class TuiApp {
  constructor(store) {
    this.store = store; this.page = 'board'; this.column = 0; this.row = 0; this.index = 0;
    this.query = ''; this.filter = ''; this.scroll = 0; this.notice = ''; this.closed = false;
    this.reload();
  }
  reload() { this.units = this.store.list(); this.name = this.store.config().name; }
  visible() { return this.units.filter(u => (!this.filter || u.deck === this.filter) && `${u.id} ${u.title} ${u.description}`.toLowerCase().includes(this.query.toLowerCase())); }
  lane(column = this.column) { return this.visible().filter(u => u.status === STATUSES[column]); }
  current() { return this.page === 'list' ? this.visible()[clamp(this.index, this.visible().length - 1)] : this.lane()[clamp(this.row, this.lane().length - 1)]; }
  unit() { return this.store.get(this.selected); }
  align(id) {
    this.reload(); const u = this.units.find(u => u.id === id); if (!u) return;
    this.column = STATUSES.indexOf(u.status); this.row = Math.max(0, this.lane().findIndex(x => x.id === id));
    this.index = Math.max(0, this.visible().findIndex(x => x.id === id));
  }
  detail(id) {
    this.selected = id; this.page = 'detail'; this.scroll = 0;
    this.reload();
    try { this.context = backlogContext(this.store, id); } catch (e) { this.context = { state: 'error', error: e.message }; }
  }
  form(title, fields, save) {
    this.dialog = { title, fields, index: 0, save }; this.scroll = 0;
  }
  saveUnit(data, id) {
    const result = autoLink(this.store, this.store.save(data, id));
    this.notice = result.warning || 'Ficha de conteúdo salva.'; this.align(result.unit.id); this.detail(result.unit.id);
  }
  edit(create = false) {
    const u = create ? null : this.store.get(this.selected || this.current()?.id);
    const fields = [field('title', 'Nome da ficha de conteúdo', u?.title), field('deck', 'Plano de estudo', u?.deck || 'Geral'), field('description', 'Material / descrição', u?.description, true)];
    if (!u) fields.push(field('file', 'Arquivo simétrico ao Backlog.md (opcional)'));
    const agenda = this.store.schedule();
    if (agenda.schedules.length) {
      const phases = this.store.unitMilestoneOptions(u?.deck || 'Geral').options
        .map(item => `${item.name}: ${item.id}`).join(', ');
      fields.push(field('milestoneId', phases ? `ID do capítulo (${phases})` : 'ID do capítulo (para planos de estudo com cronograma)', u?.milestoneId || ''));
    }
    this.form(create ? 'Nova ficha de conteúdo' : `Editar ${u.id}`, fields, values => {
      const data = { ...values, status: u?.status || STATUSES[this.column] };
      if (!data.file) delete data.file;
      if (!data.milestoneId && u?.deck === data.deck) delete data.milestoneId;
      if (u) data.version = u.version;
      this.saveUnit(data, u?.id);
    });
  }
  menu(title, options, choose) { this.picker = { title, options, index: 0, choose }; }
  move() {
    const u = this.store.get(this.selected || this.current()?.id);
    this.menu('Mover ficha para', STATUSES, status => { this.saveUnit({ status, version: u.version }, u.id); });
    this.picker.index = STATUSES.indexOf(u.status);
  }
  addQuestion(type) {
    const u = this.unit();
    const fields = [field('prompt', 'Enunciado', '', true)];
    if (type === 'choice') fields.push(field('options', 'Alternativas, uma por linha (Ctrl+J insere linha)', '', true), field('answer', 'Número da alternativa correta (começa em 1)'));
    else fields.push(field('answer', 'Resposta de referência', '', true));
    fields.push(field('explanation', 'Explicação', '', true), field('source', 'Fonte (opcional)'));
    this.form(type === 'choice' ? 'Nova questão de múltipla escolha' : 'Nova questão de texto', fields, v => {
      const question = { type, prompt: v.prompt, answer: type === 'choice' ? Number(v.answer) - 1 : v.answer, explanation: v.explanation, ...(v.source ? { source: v.source } : {}) };
      if (type === 'choice') question.options = v.options.split('\n').map(s => s.trim()).filter(Boolean);
      this.saveUnit({ questions: [...u.questions, question], version: u.version }, u.id);
    });
  }
  addCard() {
    const u = this.unit();
    this.form('Novo cartão de memorização', [field('front', 'Frente', '', true), field('back', 'Verso', '', true), field('deck', 'Plano de estudo', u.deck), field('source', 'Fonte (opcional)')], v => {
      this.saveUnit({ cards: [...u.cards, v], version: u.version }, u.id);
    });
  }
  startQuiz() {
    const u = this.unit(); ensure(u.questions.length, 'Adicione questões antes de iniciar o quiz.');
    this.quiz = { unit: u, index: 0, answers: {}, option: 0, text: '' }; this.page = 'quiz'; this.scroll = 0;
  }
  answer() {
    const quiz = this.quiz, q = quiz.unit.questions[quiz.index];
    if (q.type === 'text') ensure(quiz.text.trim(), 'Escreva uma resposta antes de continuar.');
    quiz.answers[q.id] = q.type === 'choice' ? quiz.option : quiz.text;
    if (quiz.index + 1 < quiz.unit.questions.length) { quiz.index++; quiz.option = 0; quiz.text = ''; this.scroll = 0; return; }
    ensure(this.unit().version === quiz.unit.version, 'O material mudou durante o quiz. Volte com Esc e reinicie a tentativa.');
    this.attempt = this.store.attempt(this.selected, quiz.answers);
    this.resultIndex = 0; this.page = 'results'; this.scroll = 0; this.notice = 'Tentativa registrada.';
  }
  decks() {
    const cards = this.store.reviewQueue();
    return [...new Set([...this.units.map(u => u.deck), ...cards.map(c => c.deck)])].sort().map(name => ({ name, cards: cards.filter(c => c.deck === name) }));
  }
  startReview(deck) {
    this.review = { deck, cards: this.store.reviewQueue({ deck, due: true }), index: 0, revealed: false };
    this.page = 'review'; this.scroll = 0;
  }
  rate(rating) {
    const r = this.review, card = r.cards[r.index];
    ensure(r.revealed && card, 'Revele a resposta antes de avaliar.');
    const current = this.store.reviewQueue().find(c => c.unit === card.unit && c.id === card.id);
    ensure(current?.version === card.version, 'O cartão de memorização mudou. Volte aos planos de estudo e reinicie a revisão.');
    this.store.review(card.unit, card.id, rating); r.index++; r.revealed = false; this.scroll = 0;
    this.notice = 'Revisão registrada.';
  }
  inputTarget() {
    if (this.dialog) return this.dialog.fields[this.dialog.index];
    if (this.searching) return this.searching;
    if (this.page === 'quiz' && this.quiz.unit.questions[this.quiz.index].type === 'text') return { value: this.quiz.text, multiline: true, quiz: true };
  }
  type(str, key) {
    const target = this.inputTarget(); if (!target) return false;
    if (key.name === 'backspace') target.value = [...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(target.value)].slice(0, -1).map(s => s.segment).join('');
    else if (key.ctrl && key.name === 'u') target.value = '';
    else if (key.ctrl && key.name === 'j') { if (target.multiline) target.value += '\n'; }
    else if (str && !key.ctrl && !key.meta && !['return', 'enter', 'escape', 'tab', 'left', 'right', 'up', 'down', 'home', 'end', 'delete'].includes(key.name)) target.value += clean(str).replace(/[\r\n]/g, target.multiline ? '\n' : ' ');
    else return false;
    if (target.quiz) this.quiz.text = target.value;
    return true;
  }
  handle(str = '', key = {}) {
    const name = key.name || str;
    if (key.ctrl && name === 'c') { this.closed = true; return; }
    try {
      if (key.sequence === '\x1b[200~') { this.pasting = true; return; }
      if (key.sequence === '\x1b[201~') { this.pasting = false; return; }
      if (this.pasting) {
        const target = this.inputTarget();
        if (target) { target.value += clean(str.replace(/\r\n?/g, '\n')).replace(/\n/g, target.multiline ? '\n' : ' '); if (target.quiz) this.quiz.text = target.value; }
        return;
      }
      if (this.help) { if (['escape', 'q', '?'].includes(name)) { this.help = false; this.scroll = this.helpScroll || 0; } else this.scrollKey(name); return; }
      if (this.searching) {
        if (name === 'escape') this.searching = null;
        else if (['return', 'enter'].includes(name)) { this.query = this.searching.value; this.searching = null; this.row = this.index = 0; }
        else this.type(str, key);
        return;
      }
      if (this.dialog) {
        const d = this.dialog;
        if (name === 'escape') { this.dialog = null; return; }
        if ((key.ctrl && name === 's') || (['return', 'enter'].includes(name) && d.index === d.fields.length - 1)) {
          d.save(Object.fromEntries(d.fields.map(f => [f.name, f.value]))); this.dialog = null;
        } else if (name === 'tab' || ['return', 'enter'].includes(name)) d.index = (d.index + (key.shift ? d.fields.length - 1 : 1)) % d.fields.length;
        else this.type(str, key);
        return;
      }
      if (this.picker) {
        const p = this.picker;
        if (name === 'escape') this.picker = null;
        else if (down(name)) p.index = clamp(p.index + 1, p.options.length - 1);
        else if (up(name)) p.index = clamp(p.index - 1, p.options.length - 1);
        else if (['return', 'enter'].includes(name)) { p.choose(p.options[p.index]); this.picker = null; }
        return;
      }
      if (name === 'escape') {
        if (this.page === 'detail') { this.align(this.selected); this.page = this.home || 'board'; }
        else if (['quiz', 'results', 'history'].includes(this.page)) this.detail(this.selected);
        else if (this.page === 'review') this.page = 'decks';
        else if (this.page === 'decks') this.page = this.home || 'board';
        else { this.query = ''; this.filter = ''; }
        this.scroll = 0; return;
      }
      if (this.page === 'quiz') {
        const q = this.quiz.unit.questions[this.quiz.index];
        if (['return', 'enter'].includes(name) && !(key.ctrl && name === 'j')) this.answer();
        else if (q.type === 'choice') {
          if (down(name)) this.quiz.option = clamp(this.quiz.option + 1, q.options.length - 1);
          else if (up(name)) this.quiz.option = clamp(this.quiz.option - 1, q.options.length - 1);
          else if (/^[1-9]$/.test(str) && Number(str) <= q.options.length) this.quiz.option = Number(str) - 1;
          else this.scrollKey(name);
        } else this.type(str, key);
        return;
      }
      if (name === '?') { this.helpScroll = this.scroll; this.help = true; this.scroll = 0; return; }
      if (key.ctrl && name === 'r') { this.reload(); if (this.page === 'detail') this.detail(this.selected); this.notice = 'Dados relidos do disco.'; return; }
      if (this.page === 'board' || this.page === 'list') {
        const current = this.current(); this.home = this.page;
        if (name === 'q') this.closed = true;
        else if (name === 'tab') { this.page = this.page === 'board' ? 'list' : 'board'; if (current) this.align(current.id); }
        else if (this.page === 'board' && left(name)) { this.column = clamp(this.column - 1, STATUSES.length - 1); this.row = clamp(this.row, this.lane().length - 1); }
        else if (this.page === 'board' && right(name)) { this.column = clamp(this.column + 1, STATUSES.length - 1); this.row = clamp(this.row, this.lane().length - 1); }
        else if (down(name)) { if (this.page === 'board') this.row = clamp(this.row + 1, this.lane().length - 1); else this.index = clamp(this.index + 1, this.visible().length - 1); }
        else if (up(name)) { if (this.page === 'board') this.row = clamp(this.row - 1, this.lane().length - 1); else this.index = clamp(this.index - 1, this.visible().length - 1); }
        else if (name === '/') this.searching = { value: this.query };
        else if (name === 'd') this.menu('Filtrar plano de estudo', ['Todos os planos de estudo', ...this.decks().map(d => d.name)], d => { this.filter = d === 'Todos os planos de estudo' ? '' : d; this.row = this.index = 0; });
        else if (name === 'n') this.edit(true);
        else if (current && ['return', 'enter'].includes(name)) this.detail(current.id);
        else if (current && name === 'e') { this.selected = current.id; this.edit(); }
        else if (current && name === 'm') { this.selected = current.id; this.move(); }
        else if (name === 'r') { this.page = 'decks'; this.index = 0; this.reload(); }
        return;
      }
      if (this.page === 'detail') {
        if (name === 'q') this.startQuiz();
        else if (name === 'e') this.edit();
        else if (name === 'm') this.move();
        else if (name === 'a') this.menu('Formato da questão', ['Múltipla escolha', 'Texto livre'], type => this.addQuestion(type === 'Texto livre' ? 'text' : 'choice'));
        else if (name === 'f') this.addCard();
        else if (name === 'r') this.startReview(this.unit().deck);
        else if (name === 't') { this.attempts = this.store.events('attempts', this.selected).reverse(); this.index = 0; this.page = 'history'; }
        else if (name === 's') { this.context = synchronize(this.store, this.selected); this.notice = 'Vínculos atualizados.'; }
        else this.scrollKey(name);
        return;
      }
      if (this.page === 'decks') {
        if (name === 'q') { this.page = this.home || 'board'; return; }
        const decks = this.decks();
        if (down(name)) this.index = clamp(this.index + 1, decks.length - 1);
        else if (up(name)) this.index = clamp(this.index - 1, decks.length - 1);
        else if (decks.length && ['return', 'enter'].includes(name)) this.startReview(decks[this.index].name);
        return;
      }
      if (this.page === 'review') {
        const r = this.review;
        if (!r.cards[r.index] && ['return', 'enter'].includes(name)) { this.page = 'decks'; return; }
        if (r.cards[r.index] && ['space', 'return', 'enter'].includes(name)) r.revealed = true;
        else if (r.revealed && /^[1-4]$/.test(str)) this.rate(['again', 'hard', 'good', 'easy'][Number(str) - 1]);
        else this.scrollKey(name);
        return;
      }
      if (this.page === 'history') {
        if (down(name)) this.index = clamp(this.index + 1, this.attempts.length - 1);
        else if (up(name)) this.index = clamp(this.index - 1, this.attempts.length - 1);
        else if (this.attempts.length && ['return', 'enter'].includes(name)) { this.attempt = this.attempts[this.index]; this.resultIndex = 0; this.page = 'results'; this.scroll = 0; }
        return;
      }
      if (this.page === 'results') {
        const r = this.attempt.results[this.resultIndex];
        if (right(name)) { this.resultIndex = clamp(this.resultIndex + 1, this.attempt.results.length - 1); this.scroll = 0; }
        else if (left(name)) { this.resultIndex = clamp(this.resultIndex - 1, this.attempt.results.length - 1); this.scroll = 0; }
        else if (name === 'f') {
          this.store.cardFromQuestion(this.selected, r.question);
          this.notice = 'Cartão criado com o gabarito atual.';
          this.reload();
        }
        else if (r.type === 'text' && ['1', '2'].includes(str)) { this.store.assess(this.attempt.id, r.question, str === '1'); this.notice = 'Autoavaliação registrada.'; }
        else if (['return', 'enter'].includes(name)) { if (this.resultIndex + 1 === this.attempt.results.length) this.detail(this.selected); else { this.resultIndex++; this.scroll = 0; } }
        else this.scrollKey(name);
      }
    } catch (e) { this.notice = e.message; }
  }
  scrollKey(name) {
    if (down(name)) this.scroll++;
    if (up(name)) this.scroll = Math.max(0, this.scroll - 1);
    if (name === 'pagedown') this.scroll += 8;
    if (name === 'pageup') this.scroll = Math.max(0, this.scroll - 8);
    if (name === 'home') this.scroll = 0;
    if (name === 'end') this.scroll = 100000;
  }
  render(width = 100, height = 28) {
    width = Math.max(10, width); height = Math.max(5, height);
    if (width < 50 || height < 14) return [fit('Recall.md · terminal pequeno', width, false), fit('Aumente para pelo menos 50 colunas e 14 linhas.', width, false), fit('Ctrl+C encerra.', width, false)].join('\r\n');
    const lines = [], bodyHeight = height - 7;
    const inputMode = this.dialog || this.searching || this.page === 'quiz' && this.quiz.unit.questions[this.quiz.index].type === 'text';
    lines.push(color(fit(` Recall.md  [${inputMode ? 'Esc cancelar' : '? ajuda'}]  /  ${this.name}`, width), 'title'));
    lines.push(fit(` Quadro ${this.page === 'board' ? '●' : '○'}   Lista ${this.page === 'list' ? '●' : '○'}   Revisão ${['decks', 'review'].includes(this.page) ? '●' : '○'}     ${this.units.length} fichas`, width));
    lines.push(color('─'.repeat(width), 'muted'));
    let body = [], footer = 'Esc voltar  ·  ? ajuda  ·  Ctrl+C sair';
    if (this.help) {
      body = ['ATALHOS DO RECALL.MD', '', 'QUADRO E LISTA', 'Setas ou h/j/k/l: navegar · Enter: abrir ficha', 'Tab: alternar quadro/lista · /: buscar · d: filtrar plano', 'n: nova ficha · e: editar · m: mover · r: revisar planos', 'Ctrl+R: reler arquivos · q ou Ctrl+C: sair', '', 'DETALHES', 'q: responder quiz · a: adicionar questão · f: adicionar cartão de memorização', 'r: revisar deck · t: histórico de tentativas · s: criar vínculos', '↑/↓ ou j/k, PgUp/PgDn: rolar material e contexto', '', 'FORMULÁRIOS E TEXTO', 'Tab ou Enter: próximo campo · Shift+Tab: campo anterior', 'Ctrl+S: salvar · Ctrl+J: inserir linha · Ctrl+U: limpar campo', 'Digite no final do campo; Backspace apaga · Esc cancela', '', 'QUIZ', '↑/↓ ou 1–9: selecionar alternativa · Enter: confirmar resposta', 'Texto: digitar, Ctrl+J para nova linha · Enter: confirmar', 'Tentativa só é gravada ao enviar a última questão', 'Esc: cancelar respostas ainda não enviadas', '', 'RESULTADO', '←/→: questão anterior/próxima · Enter: continuar', '1: autoavaliar texto como correto · 2: preciso retomar', 'f: cartão de memorização do gabarito atual, preservando tentativa original', '', 'REVISÃO', 'Espaço ou Enter: revelar · depois 1 repetir / 2 difícil / 3 lembrei / 4 fácil', 'Esc: voltar aos planos de estudo, preservando revisões já gravadas'];
      footer = '? ou Esc fechar ajuda · ↑/↓ rolar';
    } else if (this.dialog) {
      const d = this.dialog;
      body.push(d.title, '');
      for (let i = 0; i < d.fields.length; i++) {
        const f = d.fields[i];
        body.push(`${i === d.index ? '›' : ' '} ${f.label}`, ...wrap(`${f.value || '(vazio)'}${i === d.index ? ' ▏' : ''}`, width - 4).map(s => `  ${s}`), '');
      }
      const active = body.findIndex(l => l.startsWith('›'));
      const activeEnd = active + wrap(`${d.fields[d.index].value || '(vazio)'} ▏`, width - 4).length;
      this.scroll = Math.max(0, activeEnd - bodyHeight + 2);
      footer = 'Esc cancelar · Tab próximo · Ctrl+S salvar · Ctrl+J linha · Ctrl+U limpar';
    } else if (this.picker) {
      const p = this.picker;
      body = [p.title, '', ...p.options.map((o, i) => `${i === p.index ? '›' : ' '} ${o}`)];
      this.scroll = Math.max(0, p.index - bodyHeight + 4); footer = '↑/↓ escolher · Enter confirmar · Esc cancelar';
    } else if (this.page === 'board') {
      const count = Math.min(5, Math.max(1, Math.floor((width - 1) / 25))), cell = Math.floor((width - (count - 1)) / count);
      const first = clamp(this.column - Math.floor(count / 2), STATUSES.length - count);
      body.push(fit(` Busca: ${this.query || 'todas'}  ·  Plano: ${this.filter || 'todos'}  ·  Colunas ${first + 1}–${first + count} de 5`, width));
      body.push(Array.from({ length: count }, (_, n) => { const c = first + n; return color(fit(` ${STATUSES[c]} (${this.lane(c).length})`, cell), c === this.column ? 'title' : 'muted'); }).join('│'));
      const visibleCards = Math.max(1, Math.floor((bodyHeight - 2) / 4));
      const start = Math.max(0, this.row - visibleCards + 1);
      for (let r = start; r < start + visibleCards; r++) {
        const columns = Array.from({ length: count }, (_, n) => { const c = first + n, u = this.lane(c)[r]; return { u, active: c === this.column && r === this.row }; });
        for (let sub = 0; sub < 4; sub++) body.push(columns.map(({ u, active }) => {
          const values = u ? [` ${u.id}`, ` ${u.title}`, ` ${u.deck} · ${u.questions.length}Q ${u.cards.length}F`, ''] : r === start ? [' —', ' Nenhuma ficha de conteúdo', '', ''] : ['', '', '', ''];
          const value = fit(values[sub], cell); return active && sub !== 3 ? color(value, 'selected') : value;
        }).join('│'));
      }
      footer = '←→ colunas · ↑↓ fichas · Enter abrir · Tab lista · n nova · / busca · r planos · ?';
    } else if (this.page === 'list') {
      const units = this.visible(); this.index = clamp(this.index, units.length - 1);
      body = [`FICHAS DE CONTEÚDO · busca: ${this.query || 'todas'} · plano: ${this.filter || 'todos'}`, '', ...units.map((u, i) => `${i === this.index ? '›' : ' '} ${u.id} · ${u.title} [${u.status}]`)];
      if (!units.length) body.push('Nenhuma ficha de conteúdo. Pressione n para criar.');
      this.scroll = Math.max(0, this.index - bodyHeight + 4); footer = '↑/↓ selecionar · Enter abrir · Tab quadro · n nova · e editar · m mover · / busca · r planos';
    } else if (this.page === 'detail') {
      const u = this.unit(), ctx = this.context;
      body = [`${u.id} · ${u.title}`, `${u.status}  /  Plano de estudo: ${u.deck}`, '', 'MATERIAL', ...wrap(u.description || 'Sem descrição. Pressione e para editar.', width - 2), '', 'REFERÊNCIAS', ...(u.sources.length ? u.sources.flatMap(s => wrap(s, width - 2)) : ['Nenhuma fonte cadastrada.']), '', `QUIZ · ${u.questions.length} questões (q para responder)`, ...u.questions.flatMap(q => wrap(`• ${q.prompt}`, width - 2)), '', `FLASHCARDS · ${u.cards.length} cartões (r para revisar)`, ...u.cards.flatMap(c => wrap(`• ${c.front} [${c.deck}]`, width - 2)), '', 'CONTEXTO DO BACKLOG.MD'];
      if (ctx?.id) body.push(...wrap(`${ctx.id} · ${ctx.title} [${ctx.status}]`, width - 2), ...wrap(ctx.description || 'Sem descrição na tarefa.', width - 2), ...wrap(ctx.file, width - 2), ...(ctx.acceptance ? ['', 'CRITÉRIOS DE ACEITE', ...wrap(ctx.acceptance, width - 2)] : []), ctx.state === 'pending' ? 'Link de retorno pendente: pressione s.' : 'Vínculo nos dois sentidos.');
      else body.push(...wrap(ctx?.error || (ctx?.state === 'missing' ? 'Tarefa vinculada não encontrada no caminho esperado.' : 'Sem tarefa vinculada. O Recall.md funciona independentemente.'), width - 2));
      footer = 'Esc voltar · q quiz · r revisar · e editar · m mover · a questão · f cartão · ?';
    } else if (this.page === 'quiz') {
      const quiz = this.quiz, q = quiz.unit.questions[quiz.index];
      body = [`QUIZ · ${quiz.unit.title}`, `Questão ${quiz.index + 1}/${quiz.unit.questions.length} · ${q.type === 'choice' ? 'Múltipla escolha' : 'Texto livre'}`, '', ...wrap(q.prompt, width - 2), ''];
      if (q.type === 'choice') {
        let optionLine = body.length;
        q.options.forEach((o, i) => { if (i === quiz.option) optionLine = body.length; body.push(...wrap(`${i === quiz.option ? '›' : ' '} ${i + 1}. ${o}`, width - 2)); });
        this.scroll = Math.max(0, optionLine - bodyHeight + 3);
      } else { body.push('SUA RESPOSTA', ...wrap(`${quiz.text} ▏`, width - 2)); this.scroll = Math.max(0, body.length - bodyHeight); }
      footer = q.type === 'choice' ? 'Esc cancelar · ↑↓ ou 1–9 escolher · Enter confirmar' : 'Esc cancelar · Enter confirmar · Ctrl+J nova linha · Ctrl+U limpar';
    } else if (this.page === 'results') {
      const r = this.attempt.results[this.resultIndex];
      const assessment = this.store.events('assessments', this.selected).filter(a => a.attempt === this.attempt.id && a.question === r.question).at(-1);
      const correct = r.correct ?? assessment?.correct;
      body = ['TENTATIVA REGISTRADA', `${new Date(this.attempt.created).toLocaleString('pt-BR')} · Questão ${this.resultIndex + 1}/${this.attempt.results.length}`, '', ...wrap(r.prompt, width - 2), '', correct === true ? 'CORRETA' : correct === false ? 'PRECISA RETOMAR' : 'COMPARE COM A REFERÊNCIA', ...(assessment ? ['Autoavaliação declarada pelo estudante.'] : []), '', 'SUA RESPOSTA', ...wrap(r.options ? r.options[r.answer] : r.answer, width - 2), '', 'REFERÊNCIA DA TENTATIVA', ...wrap(r.reference, width - 2), ...wrap(r.explanation, width - 2)];
      footer = `${r.type === 'text' ? '1 entendi · 2 retomar · ' : ''}←/→ questão · f cartão do gabarito atual · Enter continuar · Esc`;
    } else if (this.page === 'decks') {
      const decks = this.decks(); this.index = clamp(this.index, decks.length - 1);
      body = ['PLANOS DE ESTUDO PARA REVISÃO', '', ...decks.map((d, i) => `${i === this.index ? '›' : ' '} ${d.name} · ${d.cards.length} cartões · ${d.cards.filter(c => !c.due || Date.parse(c.due) <= Date.now()).length} para revisar`)];
      if (!decks.length) body.push('Nenhum plano de estudo. Crie fichas de conteúdo e cartões de memorização para começar.');
      this.scroll = Math.max(0, this.index - bodyHeight + 4); footer = '↑/↓ selecionar plano · Enter revisar cartões pendentes · Esc voltar';
    } else if (this.page === 'review') {
      const r = this.review, c = r.cards[r.index];
      if (!c) body = [`PLANO DE ESTUDO · ${r.deck}`, '', 'REVISÃO EM DIA', r.cards.length ? `${r.index} cartões revisados nesta sessão.` : 'Nenhum cartão pendente neste plano de estudo.', '', 'Enter para voltar aos planos de estudo.'];
      else body = [`REVISÃO · ${r.deck} · ${r.index + 1}/${r.cards.length}`, ...wrap(`Ficha: ${c.title}`, width - 2), '', 'TENTE LEMBRAR', ...wrap(c.front, width - 2), '', ...(r.revealed ? ['RESPOSTA', ...wrap(c.back, width - 2), '', '1 Repetir · 2 Difícil · 3 Lembrei · 4 Fácil'] : ['Resposta oculta. Espaço ou Enter para revelar.'])];
      footer = c ? r.revealed ? '1 repetir · 2 difícil · 3 lembrei · 4 fácil · ↑/↓ rolar · Esc planos' : 'Espaço/Enter revelar · ↑/↓ rolar · Esc planos' : 'Enter ou Esc voltar aos planos de estudo';
    } else if (this.page === 'history') {
      body = ['TENTATIVAS PRESERVADAS', '', ...this.attempts.map((a, i) => `${i === this.index ? '›' : ' '} ${new Date(a.created).toLocaleString('pt-BR')} · ${a.results.length} questões`)];
      if (!this.attempts.length) body.push('Nenhuma tentativa registrada.');
      this.scroll = Math.max(0, this.index - bodyHeight + 4); footer = '↑/↓ selecionar · Enter resultado · Esc voltar';
    }
    this.scroll = clamp(this.scroll, body.length - bodyHeight);
    const grid = this.page === 'board' && !this.help && !this.dialog && !this.picker;
    lines.push(...body.slice(this.scroll, this.scroll + bodyHeight).map(l => grid || l.includes('\x1b[') ? l : fit(' ' + l, width)));
    while (lines.length < height - 4) lines.push('');
    lines.push(color('─'.repeat(width), 'muted'));
    const scrollInfo = !grid && body.length > bodyHeight ? `↑↓ ${this.scroll + 1}–${Math.min(body.length, this.scroll + bodyHeight)}/${body.length} · ` : '';
    lines.push(this.searching ? fit(` / ${this.searching.value} ▏  [Enter buscar · Esc cancelar]`, width) : color(fit(` ${scrollInfo}${this.notice || (this.page === 'board' ? 'Markdown local · mesmas fichas, tentativas e revisões da CLI e web.' : '')}`, width), 'warning'));
    lines.push(fit(' ' + footer, width));
    return lines.join('\r\n');
  }
}

export async function startTui(store, streams) { return runTerminal(new TuiApp(store), streams); }
