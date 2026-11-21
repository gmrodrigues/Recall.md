<script>
  let { data } = $props();
</script>

<div class="date-heading">
  <strong>{data.date}</strong>
  <span>{data.weekday}</span>
</div>

<style>
  .date-heading strong, .date-heading span { display: block; }
  .date-heading span { font-size: 12px; font-weight: 600; color: #405b76; margin-top: 2px; }
</style>
