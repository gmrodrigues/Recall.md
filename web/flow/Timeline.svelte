<script>
  import { SvelteFlow } from '@xyflow/svelte';

  import DayDivider from './DayDivider.svelte';

  import DateHeading from './DateHeading.svelte';

  const nodeTypes = { dayDivider: DayDivider, dateHeading: DateHeading };
  let { nodes, edges, displayOnly = false } = $props();
</script>

<SvelteFlow
  {nodes}
  {edges}
  {nodeTypes}
  colorMode="light"
  minZoom={1}
  maxZoom={1}
  panOnDrag={false}
  zoomOnScroll={false}
  zoomOnPinch={false}
  nodesDraggable={false}
  nodesConnectable={false}
  elementsSelectable={false}
  zoomOnDoubleClick={false}
  preventScrolling={false}
  aria-label={displayOnly ? 'Cronograma de estudo por dia' : 'Comparação de sessões antes e depois'}
/>

<style>
  :global(.svelte-flow__node.flow-session) {
    width: 208px;
    min-height: 64px;
    padding: 8px;
    font-size: 12px;
    line-height: 1.35;
    text-align: left;
    border: 1px solid #b4c5d0;
    box-shadow: 0 2px 4px #25384918;
    background: #fff;
    color: #203443;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  :global(.svelte-flow__node.flow-status-done) { background: var(--schedule-done-bg, #e2f4e6); border-color: var(--schedule-done-border, #52a274); }
  :global(.svelte-flow__node.flow-status-planned) { background: var(--schedule-planned-bg, #fff3c7); border-color: var(--schedule-planned-border, #a78235); }
  :global(.svelte-flow__node.flow-status-missed) { background: var(--schedule-missed-bg, #fce8e8); border-color: var(--schedule-missed-border, #bb6969); }
  :global(.svelte-flow__node.flow-removed) { border-style: dashed; }
  :global(.svelte-flow__node.flow-added), :global(.svelte-flow__node.flow-after) { border-inline-start-width: 4px; }
  :global(.svelte-flow__node.flow-session .svelte-flow__handle) { opacity: 0; }
  :global(.svelte-flow__node.flow-rest) { background: #eef2fb; border-color: #a8bbd8; color: #314d7a; font-weight: 650; }
  :global(.svelte-flow__node.flow-rest .svelte-flow__handle) { display: none; }
  :global(.svelte-flow__node.flow-continuation) { background: #f3f6f8; border-style: dashed; }
  :global(.svelte-flow__node.flow-axis .svelte-flow__handle) { display: none; }
  :global(.flow-move .svelte-flow__edge-path) { fill: none; stroke: #24765f; stroke-width: 2; }
  :global(.svelte-flow__node.flow-date) { width: 440px; text-align: center; font-size: 24px; line-height: 1.2; border-radius: 4px; }
  :global(.svelte-flow__node.flow-before-heading), :global(.svelte-flow__node.flow-after-heading) { width: 208px; white-space: pre-line; }
  :global(.svelte-flow__node.flow-axis) { color: #203443; padding: 7px; border-color: transparent; background: #f5f7fa; font-weight: 650; }
  :global(.svelte-flow__node.flow-date.flow-date-single) { width: 208px; }
  :global(.svelte-flow__node.flow-day-summary) { width: 208px; }
  :global(.svelte-flow__node.flow-view-only .svelte-flow__handle) { display: none; }
  :global(.svelte-flow__node.flow-date) { background: #e2ecf3; color: #182f40; font-weight: 750; }
  :global(.svelte-flow__node.flow-before-heading) { background: #f9eee0; }
  :global(.svelte-flow__node.flow-after-heading) { background: #e8f3ee; }
</style>
