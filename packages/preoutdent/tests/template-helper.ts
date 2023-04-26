export function tl(strings: TemplateStringsArray, ...values: unknown[]): string;
export function tl(tag: string): (strings: TemplateStringsArray, ...values: unknown[]) => string;
export function tl(stringsOrTag: TemplateStringsArray | string, ...values: unknown[]): string | ((strings: TemplateStringsArray, ...values: unknown[]) => string) {
  const _tl = (tag: string): (strings: TemplateStringsArray, ...values: unknown[]) => string => {
    return (strings, ...values) =>
      tag + '`'
      + String.raw(strings, ...values.map(v =>
        v && typeof v == 'object' && 'bare' in v
          ? v.bare
          : nq(`'${v}'`).bare)) // non-bare expr values become expr-strings of a single-quoted string: "foo" => "${'foo'}"
      + '`';
  };
  if (typeof stringsOrTag == 'string')
    return _tl(stringsOrTag);
  else
    return _tl('')(stringsOrTag, ...values);
}

export const ttl = (strings: TemplateStringsArray, ...values: unknown[]) => tl(String.raw(strings, ...values));

export function nx(string: string): { bare: string };
export function nx(strings: TemplateStringsArray, ...values: unknown[]): { bare: string };
export function nx(stringOrStrings: string | TemplateStringsArray, ...values: unknown[]): { bare: string } {
  const string = typeof stringOrStrings == 'string'
    ? stringOrStrings
    : String.raw(stringOrStrings, ...values);
  return { bare: string };
}

export function nq(string: string): { bare: string };
export function nq(strings: TemplateStringsArray, ...values: unknown[]): { bare: string };
export function nq(stringOrStrings: string | TemplateStringsArray, ...values: unknown[]): { bare: string } {
  const string = typeof stringOrStrings == 'string'
    ? stringOrStrings
    : String.raw(stringOrStrings, ...values);
  return nx(`\${${string}}`);
}
