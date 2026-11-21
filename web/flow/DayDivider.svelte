<script>
  let { data } = $props();
</script>

<div class="day-divider" style:height={data.height + 'px'} aria-hidden="true"></div>

<style>
  .day-divider { width: 2px; border-inline-start: 2px solid #9aafbd; pointer-events: none; }
</style>
