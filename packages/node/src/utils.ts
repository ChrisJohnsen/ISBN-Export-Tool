// Node ISBN tool stuff

import { type ExportFormat } from 'utils';

function kindsWith(name: string, groupKindInfo: ReturnType<ExportFormat['groupInfo']>): string[] {
  return Array.from(groupKindInfo.entries()).flatMap(([kind, groupInfo]) => groupInfo.has(name) ? [kind] : []);
}

export type Group = { kind: string, name: string };

export type GroupResult =
  | { status: 'single', group: Group }
  | { status: 'found as tagged, original also in kinds', group: Group, kinds: string[] }
  | { status: 'not found' }
  | { status: 'ambiguous', kinds: string[] }
  | never;

export function groupFromName(name: string, groupKindInfo: ReturnType<ExportFormat['groupInfo']>): GroupResult {
  for (const [kind, groupInfo] of groupKindInfo.entries()) {
    if (name.startsWith(kind)) {
      const sep = name.slice(kind.length, kind.length + 1);
      const stripped = name.slice(kind.length + 1);
      if (/[-:=. ]/.test(sep) && groupInfo.has(stripped)) {
        const kinds = kindsWith(name, groupKindInfo);
        if (kinds.length == 0)
          return { status: 'single', group: { kind, name: stripped } };
        else
          return { status: 'found as tagged, original also in kinds', group: { kind, name: stripped }, kinds: kinds };
      }
    }
  }
  const kinds = kindsWith(name, groupKindInfo);
  if (kinds.length == 1)
    return { status: 'single', group: { kind: kinds[0], name } };
  else if (kinds.length == 0)
    return { status: 'not found' };
  else
    return { status: 'ambiguous', kinds };
}
