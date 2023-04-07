import * as t from 'typanion';

const isCheckHeaders = t.isObject({
  ETag: t.isOptional(t.isString()),
  'Last-Modified': t.isOptional(t.isString()),
});
export type CheckHeaders = t.InferType<typeof isCheckHeaders>;

export type CheckableFetcher = (url: string, previousCheckHeaders?: CheckHeaders) => Promise<{ status: number, content: string, checkHeaders: CheckHeaders }>;

export const isCheckStorage = t.isOptional(t.isObject({
  content: t.isString(),
  expires: t.isNumber(),
}, { extra: isCheckHeaders }));
export type CheckStorage = t.InferType<typeof isCheckStorage>;

export async function webcheck(
  fetcher: CheckableFetcher,
  url: string,
  forMillis: number,
  value: CheckStorage,
  freshContent: (content: string) => string = c => c,
): Promise<CheckStorage> {

  if (!webcheckExpired(value))
    return value;

  const { status, content, checkHeaders } = await fetcher(url, value);

  if (status == 200)
    return { content: freshContent(content), expires: Date.now() + forMillis, ...checkHeaders };
  else if (status == 304) {
    if (value) {
      return { ...value, expires: Date.now() + forMillis };
    } else {
      console.error('Got a 304, but had no previous value to make If-None-Match or If-Modified-Since');
      return void 0;
    }
  } else {
    console.error(`HTTP status ${status} for ${url}`);
    return value;
  }
}

export function webcheckExpired(value: CheckStorage): boolean {
  return !value || value.expires <= Date.now();
}
