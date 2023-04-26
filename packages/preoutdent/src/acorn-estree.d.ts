// from https://github.com/acornjs/acorn/issues/1136#issuecomment-1203671368

import type * as ESTree from 'estree';

declare module 'acorn' {
  type ExtendObject<T> = {
    [K in keyof T]: ExtendNode<T[K]>;
  };
  type WithStartEnd<T> = T extends ESTree.Node | ESTree.Comment
    ? { start: number; end: number }
    : unknown;
  export type ExtendNode<T> = T extends object ? ExtendObject<T> & WithStartEnd<T> : T;
  export function parse(s: string, o: Options): ExtendNode<ESTree.Program>;

  // fix type of Comment property 'type'
  export type AcornComment = Omit<Comment, 'type'> & {
    type: 'Line' | 'Block';
  };
}
