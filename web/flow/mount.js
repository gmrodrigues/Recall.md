import { mount, unmount } from 'svelte';
import Gantt from './Gantt.svelte';
import '@xyflow/svelte/dist/style.css';

export function mountGantt(target, props) {
  target.replaceChildren();
  const app = mount(Gantt, { target, props });
  return () => unmount(app);
}
