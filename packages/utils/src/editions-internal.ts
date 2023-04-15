// some internal-only helpers that "editions of" functions can use

import { CacheControl } from "./cache.js";
import { type BareFetchResult, ContentError, type EditionsISBNResults, type FetchResult } from "./editions-common.js";

export type InitialFault<T> = { warning: T } | { temporary: T };

function fetcherResponseOrFault(identifier: string, response: BareFetchResult): string | InitialFault<string> {
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

// spell-checker:ignore ccfr
export async function processFetcherResult<R extends StringsAndFaults>(
  identifier: string,
  ccfr: FetchResult,
  ctor: new (f: InitialFault<string>) => R,
  fn: (fetched: string) => Promise<R>,
) {
  const [cc, fr] = ccfr instanceof CacheControl
    ? [ccfr, ccfr.value]
    : [void 0, ccfr];

  const responseOrFault = fetcherResponseOrFault(identifier, fr);

  return (typeof responseOrFault == 'string'
    ? await fn(responseOrFault)
    : new ctor(responseOrFault))
    .expires(cc?.expiration);
}

// some helper classes for accumulating results and errors

export class StringsAndFaults {
  set: Set<string> = new Set;
  warnings: ContentError[] = [];
  temporaryFaults: ContentError[] = [];
  cacheUntil?: number;
  constructor(fault?: InitialFault<string | ContentError>) {
    if (!fault) return;
    if ('warning' in fault) this.addWarning(fault.warning);
    if ('temporary' in fault) this.addTemporaryFault(fault.temporary);
  }
  addString(datum: string) {
    this.set.add(datum);
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private addError(err: any, arr: ContentError[]) {
    const fault = err instanceof ContentError ? err : new ContentError(err.toString());
    arr.push(fault);
    return this;
  }
  asEditionsISBNResults(): EditionsISBNResults {
    const { warnings, temporaryFaults, cacheUntil } = this;
    const isbns = this.set;
    return { isbns, warnings, temporaryFaults, cacheUntil };
  }
  absorbFaults(other: StringsAndFaults) {
    this.warnings = this.warnings.concat(other.warnings);
    this.temporaryFaults = this.temporaryFaults.concat(other.temporaryFaults);
    return this;
  }
  addWarning(fault: string | ContentError) {
    return this.addError(fault, this.warnings);
  }
  addTemporaryFault(fault: string | ContentError) {
    return this.addError(fault, this.temporaryFaults);
  }
  expires(expiration: Date | number | undefined) {
    if (typeof expiration == 'undefined') return this;
    if (expiration instanceof Date)
      expiration = expiration.valueOf();
    if (typeof this.cacheUntil == 'undefined')
      this.cacheUntil = expiration;
    else
      this.cacheUntil = Math.min(this.cacheUntil, expiration);
    return this;
  }
}

export class EditionsResult extends StringsAndFaults {
  next?: string;
  setNext(next: string) {
    this.next = next;
  }
  absorb(other: EditionsResult) {
    other.set.forEach(datum => this.set.add(datum));
    this.absorbFaults(other);
    this.expires(other.cacheUntil);
    return this;
  }
}
