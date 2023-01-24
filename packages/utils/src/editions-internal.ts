// some internal-only helpers that "editions of" functions can use

import { CacheControl } from "./cache.js";
import { ContentError, EditionsISBNResults, FetchResult } from "./editions-common.js";

export type InitialFault<T> = ({ warning: T } | { temporary: T }) & { cacheUntil?: number };

export function fetcherResponseOrFault(identifier: string, ccResponse: FetchResult): string | InitialFault<string> {
  if (typeof ccResponse == 'string')
    return ccResponse;
  const response = ccResponse instanceof CacheControl ? ccResponse.value : ccResponse;
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
  return maybeCacheUntil({ temporary: `${identifier} ${blurb} HTTP status ${statusStr}` });
  function maybeCacheUntil<T>(i: InitialFault<T>) {
    if (ccResponse instanceof CacheControl)
      return { ...i, cacheUntil: ccResponse.expiration };
    else return i;
  }
}

// some helper classes for accumulating results and errors

export class StringsAndFaults {
  set: Set<string> = new Set;
  warnings: ContentError[] = [];
  temporaryFaults: ContentError[] = [];
  cacheUntil?: number;
  constructor(fault?: InitialFault<string | ContentError>) {
    if (!fault) return;
    this.cacheUntil = fault.cacheUntil;
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
    const { warnings, temporaryFaults } = this;
    const isbns = this.set;
    return { isbns, warnings, temporaryFaults, cacheUntil: this.cacheUntil };
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
}

export class EditionsResult extends StringsAndFaults {
  next?: string;
  setNext(next: string) {
    this.next = next;
  }
  absorb(other: EditionsResult) {
    other.set.forEach(datum => this.set.add(datum));
    this.absorbFaults(other);
    return this;
  }
}
