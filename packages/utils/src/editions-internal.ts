// some internal-only helpers that "editions of" functions can use

import { FetchResult } from "./editions-common.js";

// the rest are more internal

export type InitialFault<T> = { warning: T; } | { temporary: T; };

export function fetcherResponseOrFault(identifier: string, response: FetchResult): string | InitialFault<string> {
  if (typeof response == 'string')
    return response;
  const status = response.status;
  const statusStr = `${status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const blurb = (status => {
    if (500 <= status && status < 600)
      return 'server error:';
    if (400 <= status && status < 500)
      return 'client error:';
    if (300 <= status && status < 400)
      return 'unfinished redirect:';
    if (200 <= status && status < 300)
      return 'OK as error!?:';
    if (100 <= status && status < 200)
      return 'interim as final!?:';
    return 'bad(?)';
  })(status);
  return { temporary: `${identifier} ${blurb} HTTP status ${statusStr}` };
}
