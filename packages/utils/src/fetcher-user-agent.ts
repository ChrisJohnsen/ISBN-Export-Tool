import { version } from './version.js';

export function fetcherUserAgent(platform?: string) {
  return `ISBNExportTool/${version} (${platform ? platform + '; ' : ''}+https://github.com/ChrisJohnsen/ISBN-Export-Tool)`;
}
