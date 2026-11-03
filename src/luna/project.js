// Verbindet Luna-Prüfung/Vorschläge mit dem Projekt: andere Scripts kennen (let/const/function ohne local).
import { Facet } from '../../vendor/core.js';
import { getProject, filesSync } from '../projects/projects.js';
import { summarize } from './analysis.js';

/** { projectId, path } der Datei im Editor */
export const fileCtxFacet = Facet.define({ combine: (v) => v[0] || null });

export const isLunaPath = (p) => /\.(luna|lu)$/i.test(p);

export function otherScripts(state) {
  const ctx = state.facet(fileCtxFacet);
  if (!ctx) return [];
  const p = getProject(ctx.projectId);
  const files = p && filesSync(p);
  if (!files) return [];
  const out = [];
  for (const rec of files.values()) {
    if (rec.path === ctx.path || !isLunaPath(rec.path) || rec.content == null) continue;
    out.push({ path: rec.path, summary: summarize(rec.content) });
  }
  return out;
}
