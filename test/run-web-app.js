import fs from 'node:fs';
import { confirmedSessions, sessionStatus, stageStatus } from '../web/flow/model.js';

import { DEFAULT_LINK_MINUTES, materialLinkIdentity, materialPageLinks, materialPages } from '../src/material.js';
import { editReading, playMaterial, renderMaterial, renderStudyTime } from '../web/material-view.js';
import { readingProgress } from '../web/reading-progress.js';
import { probeVideo, sampleVideoDurations } from '../web/video-metadata.js';

export function runApp(window) {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const script = source.replace(/^import .*;\n/gm, '');
  const imports = { confirmedSessions, sessionStatus, stageStatus, DEFAULT_LINK_MINUTES, materialLinkIdentity, materialPageLinks, materialPages, editReading,
    playMaterial, renderMaterial, renderStudyTime, readingProgress, probeVideo, sampleVideoDurations };
  return window.eval('(async (' + Object.keys(imports).join(', ') + ') => { ' + script + '\n})')(
    ...Object.values(imports));
}
