<script>
  import { onMount } from 'svelte';
  import Timeline from './Timeline.svelte';
  import { chartDate, chartWeekday, clockLabel, comparisonGraph, formatDailyTotals, formatRestTotals, overviewModel } from './model.js';

  let { mode, agenda, before = [], after = [], beforeZone, afterZone, beforeAgenda, afterAgenda } = $props();
  let page = $state(null);
  let selected = $state(null);
  let flowScroller = $state(null);
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 15_000);
    return () => clearInterval(timer);
  });
  const overview = $derived(mode === 'overview' ? overviewModel(agenda, page ?? 0, now) : null);
  const displayOnly = $derived(mode === 'schedule');
  const graph = $derived(mode === 'comparison' || displayOnly ? comparisonGraph(before, after, beforeZone, afterZone, {
    beforeAgenda, afterAgenda, page: displayOnly ? page ?? 0 : page, now, displayOnly,
  }) : null);
  const pagination = $derived(overview?.pagination || graph?.pagination);

  function changePage(next) {
    selected = null;
    page = next;
    flowScroller?.scrollTo(0, 0);
  }

  function label(unit) {
    if (unit.needsScheduling) return `${unit.name} · Pendente de reprogramação`;
    if (unit.workflowOnly) return `${unit.name} · Estudada no quadro`;
    return `${unit.name} · ${unit.minutes} min · ${{ done: 'Realizada', missed: 'Não realizada', planned: 'Programada' }[unit.status]}`;
  }
</script>

{#if pagination?.pageCount > 1}
  <nav class="gantt-pagination" aria-label="Intervalos do Gantt">
    <button type="button" class="button secondary" disabled={pagination.page === 0}
      onclick={() => changePage(pagination.page - 1)}>Anterior</button>
    <span aria-live="polite">{chartDate(pagination.start)} a {chartDate(pagination.end)} · {pagination.page + 1}/{pagination.pageCount}</span>
    <button type="button" class="button secondary" disabled={pagination.page + 1 >= pagination.pageCount}
      onclick={() => changePage(pagination.page + 1)}>Próximo</button>
    <label>Ir para a data<input type="date" min={pagination.first} max={pagination.last} value={pagination.start}
      onchange={event => {
        const offset = (Date.parse(event.currentTarget.value) - Date.parse(pagination.first)) / 86400000;
        if (Number.isFinite(offset)) changePage(Math.floor(offset / pagination.pageSize));
      }}></label>
  </nav>
{/if}

{#if overview}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="schedule-gantt-scroll" tabindex="0" role="region" aria-label="Datas da agenda">
    <table class="schedule-gantt">
      <thead><tr><th scope="col">Cronograma</th>
        {#each overview.columns as column (column.id)}
          {#if column.date}
            <th scope="col" class="gantt-day"><time datetime={column.date}>{chartDate(column.date)}</time>
              <span class="gantt-weekday">{chartWeekday(column.date)}</span>
              {#if overview.hasSessions}
                <span class="gantt-day-total">{formatDailyTotals(column.totals)}</span>
                <span class="gantt-hours"><span>{clockLabel(overview.axis.from)}</span><span>{clockLabel(overview.axis.to)}</span></span>
              {/if}
            </th>
          {:else}
            <th scope="col" class="gantt-gap">+{column.gap} dias</th>
          {/if}
        {/each}
      </tr></thead>
      <tbody>
        {#each overview.rows as row (row.id)}
          <tr><th scope="row"><button type="button" class="gantt-schedule-link" data-view-schedule={row.id} aria-haspopup="dialog">{row.name}</button><span class="gantt-rest-total">{formatRestTotals(row)}</span></th>
            {#each overview.columns as column, i (column.id)}
              {#if column.date}
                <td class="gantt-day">
                  {#each row.cells[i]?.stages || [] as unit (unit.id)}
                    <button type="button" class="gantt-stage-card" class:confirmed={unit.status === 'done'} class:missed={unit.status === 'missed'}
                      aria-label={label(unit)} aria-pressed={selected === unit} title={label(unit)}
                      onclick={() => { selected = selected === unit ? null : unit; }}>
                      <strong>{unit.name}</strong>
                      <small>{unit.needsScheduling ? 'Pendente de reprogramação' : unit.workflowOnly ? 'Estudada no quadro' : `${unit.minutes} min`}</small>
                      {#if !unit.workflowOnly && !unit.needsScheduling}
                        <span class="gantt-track" aria-hidden="true">
                          {#each unit.bars.filter(bar => !bar.workflowOnly) as bar (bar.id)}
                            <span class="gantt-cell" class:confirmed={bar.status === 'done'} class:missed={bar.status === 'missed'} class:overtime={bar.overtime}
                              style:left={bar.left + '%'} style:width={bar.width + '%'}></span>
                          {/each}
                        </span>
                      {/if}
                    </button>
                  {/each}
                  {#if row.restByDate.has(column.date)}
                    {@const rest = row.restByDate.get(column.date)}
                    <div class="gantt-rest-card" title={rest.intervals.join('\n')}>Folga <small>{formatRestTotals(rest)}</small></div>
                  {/if}
                </td>
              {:else}
                <td class="gantt-gap"></td>
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if overview.hasSessions}
    <p class="gantt-legend"><span class="legend-scheduled">Programada</span><span class="legend-confirmed">Realizada</span><span class="legend-missed">Não realizada</span></p>
    {#if selected}<p class="gantt-detail" role="status">{label(selected)}</p>{/if}
  {/if}
  <p class="gantt-rest-note">A folga ocupa janelas livres até o prazo, com limite de 50% do tempo de estudo e blocos baseados na duração média de uma ficha.</p>
{:else if graph}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="schedule-flow" bind:this={flowScroller} role="region" tabindex="0" aria-label={displayOnly ? 'Gantt do cronograma' : 'Gantt comparativo'}>
    {#key pagination.page}
      <div class="schedule-flow-canvas" style:width={`${graph.canvas.width}px`} style:height={`${graph.canvas.height}px`}>
        <Timeline nodes={graph.nodes} edges={graph.edges} {displayOnly} />
      </div>
    {/key}
  </div>
  <p class="gantt-legend"><span class="legend-scheduled">Programada</span><span class="legend-confirmed">Realizada</span><span class="legend-missed">Não realizada</span></p>
  {#if graph.restBefore.length || graph.restAfter.length}
    <div class="gantt-rest-comparison">
      {#each (displayOnly ? [['', graph.restAfter]] : [['Antes', graph.restBefore], ['Depois', graph.restAfter]]) as [label, list] (label)}
        <section>
          <h4>Folgas{label ? ` · ${label}` : ''}</h4>
          {#if list.length}
            <ul>{#each list as row (row.id)}<li><strong>{row.name}</strong> · {formatRestTotals(row)}</li>{/each}</ul>
          {:else}<p>Nenhum cronograma.</p>{/if}
        </section>
      {/each}
    </div>
    <p class="gantt-rest-note">A folga ocupa janelas livres até o prazo, com limite de 50% do tempo de estudo e blocos baseados na duração média de uma ficha.</p>
  {/if}
{/if}

<style>
  .schedule-gantt-scroll { overflow-x: auto; color-scheme: light; color: #253849; }
  .schedule-gantt { border-collapse: separate; border-spacing: 0; width: 100%; text-align: center; font-size: 12px; background: #fff; }
  .schedule-gantt th, .schedule-gantt td { min-width: 148px; padding: 6px 8px; border-bottom: 1px solid #dbe4eb; border-right: 1px solid #dbe4eb; }
  .schedule-gantt th:first-child { text-align: left; min-width: 128px; max-width: 190px; background: #fff; position: sticky; left: 0; z-index: 1; }
  .schedule-gantt .gantt-gap { min-width: 64px; background: #f3f6f8; color: #536677; }
  .schedule-gantt .gantt-day { border-inline-start: 2px solid #9aafbd; }
  .gantt-day time { display: block; font-size: 20px; line-height: 1.2; letter-spacing: -.45px; font-weight: 750; color: #182f40; }
  .gantt-weekday { display: block; color: #405b76; font-size: 12px; font-weight: 550; }
  .gantt-schedule-link { padding: 0; border: 0; background: none; color: #136d63; text-align: left; font-weight: 750; }
  .gantt-schedule-link:hover { text-decoration: underline; }
  .gantt-day-total { display: block; color: #4b6272; font-size: 11px; font-weight: 500; white-space: nowrap; }
  .gantt-hours { display: flex; justify-content: space-between; color: #526271; font-size: 10px; font-weight: 400; }
  .gantt-track { display: block; position: relative; min-height: 12px; background: #f1f6f6; border-radius: 4px; }
  .gantt-cell { position: absolute; top: 2px; min-width: 4px; height: 8px; padding: 0; border: 1px solid var(--schedule-planned-border, #a78235); border-radius: 4px; background: var(--schedule-planned-bg, #fff3c7); }
  .gantt-stage-card { display: grid; width: 100%; gap: 3px; margin: 3px 0; padding: 5px 7px; border: 1px solid var(--schedule-planned-border, #a78235); border-radius: 4px; background: var(--schedule-planned-bg, #fff3c7); color: #283d4a; text-align: left; font-size: 11px; overflow-wrap: anywhere; }
  .gantt-stage-card.confirmed { border-color: var(--schedule-done-border, #52a274); background: var(--schedule-done-bg, #e2f4e6); }
  .gantt-stage-card.missed { border-color: var(--schedule-missed-border, #bb6969); background: var(--schedule-missed-bg, #fce8e8); }
  .gantt-cell.confirmed { background: var(--schedule-done-bg, #e2f4e6); border-color: var(--schedule-done-border, #52a274); }
  .gantt-cell.missed { background: var(--schedule-missed-bg, #fce8e8); border-color: var(--schedule-missed-border, #bb6969); }
  .gantt-cell.overtime { border-style: dashed; }
  .gantt-stage-card[aria-pressed=true] { outline: 2px solid #183648; outline-offset: 1px; }
  .gantt-legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 0; font-size: 11px; }
  .gantt-legend span::before { display: inline-block; content: ''; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
  .legend-scheduled::before { background: var(--schedule-planned-bg, #fff3c7); border: 1px solid var(--schedule-planned-border, #a78235); }
  .legend-confirmed::before { background: var(--schedule-done-bg, #e2f4e6); border: 1px solid var(--schedule-done-border, #52a274); }
  .legend-missed::before { background: var(--schedule-missed-bg, #fce8e8); border: 1px solid var(--schedule-missed-border, #bb6969); }
  .gantt-detail { margin: 6px 0 0; color: #304b58; font-size: 12px; }
  .schedule-flow { width: 100%; max-height: min(590px, 62vh); border: 1px solid #c8d4dd; border-radius: 8px; overflow: auto; background: #f7fafb; color-scheme: light; }
  .schedule-flow :global(.svelte-flow) {
    color-scheme: light;
    --xy-background-color: #f7fafb;
    --xy-attribution-background-color: #ffffffdf;
  }
  .gantt-pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 10px; }
  .gantt-pagination label { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 0 auto; }
  .gantt-pagination input { width: auto; margin: 0; padding: 5px 7px; }
  .gantt-rest-card { margin-top: 4px; padding: 5px 8px; border: 1px solid #b4c3df; border-radius: 6px; background: #eef2fb; color: #314d7a; font-size: 12px; font-weight: 700; }
  .gantt-rest-card small { color: inherit; margin-left: 4px; }
  .gantt-rest-total { display: block; font-size: 11px; font-weight: 400; color: #405b76; }
  .gantt-rest-note { margin: 9px 0 0; font-size: 12px; color: #405b76; }
  .gantt-rest-comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 10px; }
  .gantt-rest-comparison h4 { margin: 0 0 4px; }
  .gantt-rest-comparison ul { margin: 0; padding-inline-start: 18px; }
</style>
