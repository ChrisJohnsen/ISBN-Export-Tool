import type * as ESTree from 'estree';
import { type parse, type ExtendNode } from 'acorn';
import { attachScopes, type AttachedScope } from '@rollup/pluginutils';
import MagicString, { type SourceMap } from 'magic-string';
import { walk } from 'estree-walker';

//
// outdent-based types, consts, and helpers
//
const namedExports = new Set(['outdent', 'default']); // outdent functions directly importable from outdent module
type MaybeStatic<T> = { static: true, value: T } | { static: false, value?: undefined }
function staticValue<T>(value: T): MaybeStatic<T> { return { static: true, value } }
function nonStaticValue<T>(): MaybeStatic<T> { return { static: false } }
type AnalyzedOutdentOptions = {
  trimLeadingNewline: MaybeStatic<boolean | undefined>,
  trimTrailingNewline: MaybeStatic<boolean | undefined>,
  newline: MaybeStatic<string | null | undefined>
};
const isOptionKey = (() => {
  const optionKeys: Set<keyof AnalyzedOutdentOptions> = new Set(['trimLeadingNewline', 'trimTrailingNewline', 'newline']);
  return (str: string): str is keyof AnalyzedOutdentOptions => (optionKeys as Set<string>).has(str);
})();
// these update helpers offer better type safety for key -> value type vs. the bare spread expression (which allows any PropertyKey for key and any value)
function staticOption<K extends keyof AnalyzedOutdentOptions>(base: AnalyzedOutdentOptions, key: K, value: AnalyzedOutdentOptions[K]['value']): AnalyzedOutdentOptions {
  return { ...base, [key]: staticValue(value) };
}
function nonStaticOption<K extends keyof AnalyzedOutdentOptions>(base: AnalyzedOutdentOptions, key: K): AnalyzedOutdentOptions {
  return { ...base, [key]: nonStaticValue() };
}
export type ImportFilter = (importedModule: string) => boolean;

//
// the transform functions
//
export function transform(acornParse: typeof parse, code: string, moduleIsOutdent: ImportFilter = m => m == 'outdent'): string {
  const transformed = transformWithMapping(acornParse, code, moduleIsOutdent);
  return transformed ? transformed.code : code;
}

export function transformWithMapping(acornParse: typeof parse, code: string, moduleIsOutdent: ImportFilter = m => m == 'outdent'): null | { code: string, map: SourceMap } {

  const parsed = acornParse(code, {
    ecmaVersion: 2023,
    sourceType: 'module'
  });

  const rootScope = attachScopes(parsed);

  const state = makeParseState();

  const ms = new MagicString(code);

  let currentScope: AttachedScope | undefined = rootScope;
  walk(parsed as ESTree.Node, {
    enter(n) {
      const node = n as ExtendNode<ESTree.Node> & { scope?: AttachedScope };
      if (node.scope) currentScope = node.scope;
      if (!currentScope) return this.skip();

      if (node.type == 'ImportDeclaration')
        state.recordAnyOutdentImports(node, currentScope, moduleIsOutdent);
      else if (node.type == 'VariableDeclaration')
        state.recordAnyOutdentConsts(node, currentScope);
      else if (node.type == 'TaggedTemplateExpression') {
        state.maybeOutdent(node, currentScope, ms);
      }
    },
    leave(n) {
      const node = n as ExtendNode<ESTree.Node> & { scope?: AttachedScope };
      if (node.scope) currentScope = currentScope?.parent;
    }
  });

  if (ms.hasChanged())
    return { code: ms.toString(), map: ms.generateMap() };
  else
    return null;
}

//
// the parsing helper
//
// A walker tells us about imports, variable declarations, and tagged template
// literal expressions.
//
// We remember outdent-related imports and consts so that we can recognize and
// possibly transform outdent-tagged template literals.
//
const makeParseState = (() => {

  // we track outdent imports and consts of them and consts of outdent-with-applied-options
  type BindableValue = 'imported outdent namespace' | 'imported outdent' | AnalyzedOutdentOptions;
  const scopedBindings = new Map<AttachedScope, Map<string, BindableValue | undefined>>;
  function bindValue(scope: AttachedScope, name: string, value: BindableValue) {
    const bindings = scopedBindings.get(scope);
    if (bindings) {
      if (bindings.has(name))
        bindings.set(name, void 0); // duplicate binding, invalid code?
      else
        bindings.set(name, value);
    } else
      scopedBindings.set(scope, new Map([[name, value]]));
  }
  function boundValue(startingScope: AttachedScope, name: string): undefined | BindableValue {
    let scope: AttachedScope | undefined = startingScope;
    while (scope) {
      if (scope.declarations[name])
        return scopedBindings.get(scope)?.get(name);
      else if (!scope.parent)
        // attachScopes does not track imports in its declarations, so if we
        // make it to the root scope without finding anything, we still need to
        // check our bindings for imported values
        return scopedBindings.get(scope)?.get(name);
      scope = scope.parent;
    }
  }

  return () => ({
    //
    // walker tells us about imports
    //
    // if this is importing the outdent module, record the imported identifiers
    // as either default outdent functions, or the outdent namespace
    recordAnyOutdentImports(decl: ExtendNode<ESTree.ImportDeclaration>, scope: AttachedScope, moduleIsOutdent: ImportFilter): void {
      if (!(isLiteralString(decl.source)
        && moduleIsOutdent(decl.source.value)))
        return;

      decl.specifiers.forEach(spec => {

        if (spec.type == 'ImportSpecifier') {
          if (isIdentifier(spec.imported)
            && namedExports.has(spec.imported.name))
            bindValue(scope, spec.local.name, 'imported outdent');

        } else if (spec.type == 'ImportDefaultSpecifier')
          bindValue(scope, spec.local.name, 'imported outdent');

        else if (spec.type == 'ImportNamespaceSpecifier')
          bindValue(scope, spec.local.name, 'imported outdent namespace');

        else
          assertNever(spec);
      });
    },

    //
    // walker tells us about variable declarations
    //
    // if these are consts, record the identifiers (and effective values) for
    // any initializer expressions that we analyze as being outdent expressions
    // (default outdent, outdent namespace, or applied outdent options)
    recordAnyOutdentConsts(decl: ExtendNode<ESTree.VariableDeclaration>, scope: AttachedScope): void {
      if (decl.kind != 'const') return;

      decl.declarations.forEach(decl => {
        if (decl.id.type != 'Identifier') return;
        if (!decl.init) return;
        const value = analyzePossibleOutdentExpression(scope, decl.init);
        if (value)
          bindValue(scope, decl.id.name, value);
      });
    },

    //
    // walker tells us about tagged template literal expressions
    //
    // if the tag can be analyzed as (a call to) a tracked outdent value, apply
    // the effective options to the template literal strings (as much as
    // possible given our limited static analysis of the options and possible
    // indentation marker expression)
    maybeOutdent(tagged: ExtendNode<ESTree.TaggedTemplateExpression>, scope: AttachedScope, ms: MagicString) {

      // bail if we can not tell if the the tag is an outdent
      const options = analyzePossibleOutdentOptions(scope, tagged.tag);
      if (!options) return;

      const strs = tagged.quasi.quasis // spell-checker:ignore strs quasis
        .map(({ start, end, value: { raw } }) => ({ start, end, raw }));
      const firstExpr = tagged.quasi.expressions.slice(0, 1);

      // find first indent and its size
      let indentSize = 0;
      {
        const firstIndentMatch = strs[0].raw.match(rx`(?<=${raw.assertEvenBackslash(raw.lineBreak)})${raw.spaceOrTab}*(?:$|(?!${raw.spaceOrTab}|${raw.lineBreak}))`);
        if (firstIndentMatch)
          indentSize = Array.from(firstIndentMatch[0].matchAll(rx('g')`${raw.spaceOrTab}`)).length;
      }

      // check whether first expression qualifies as indentation marker
      const { hasMarker, substitutionStart } = exprIsIndentationMarkerInContext(strs[0], firstExpr[0], strs[1]);

      // keep track of the region in which we might eventually replace line breaks
      const lineBreakSubstitution = { start: substitutionStart, end: strs[strs.length - 1].end };

      // we can remove the tag only if all options (including indentation
      // marker) have been statically determined
      const removingTag = hasMarker.static
        && options.trimLeadingNewline.static
        && options.trimTrailingNewline.static
        && options.newline.static;

      // remove first string and expression if first expression is an indentation marker
      if (removingTag) // we could remove the marker when retaining the tag, but only if we do the work to disqualify the next expression in its future context (i.e. after line break subst)
        if (hasMarker.static && hasMarker.value) {
          // the expression is definitely the indentation marker: remove the
          // whole first first and first expression (the marker expression)
          ms.remove(strs[0].start, strs[1].start);
          strs.shift();
        }

      // remove the tag if possible (removes runtime outdent processing)
      if (removingTag)
        ms.remove(tagged.tag.start, tagged.tag.end);

      // remove leading line break
      if (!options.trimLeadingNewline.static || options.trimLeadingNewline.value) {
        const first = strs[0];
        const leadingNewlineRe = rx`^${raw.spaceOrTab}*(${raw.lineBreak})`;
        const leading = matchRange(first.raw.match(leadingNewlineRe), first.start);
        if (leading) {
          if (lineBreakSubstitution.start < leading.end)
            // a non-static marker will have already established a later start
            // point for line break substitution; only update the region's start
            // point if we are actually moving it forward
            lineBreakSubstitution.start = leading.end;
          if (options.trimLeadingNewline.static && options.trimLeadingNewline.value) {
            if (removingTag)
              // no runtime outdent, so we should trim the leading line break
              // (and its leading spaces and tabs)
              ms.remove(leading.start, leading.end);
            else
              // runtime will still do outdent, so we need to leave a line break
              // for it; we can remove and spaces and tabs though
              ms.update(leading.start, leading.end, leading.match[1]);
          }
        }
      }

      // remove indent after each line break
      const indentRe = raw.indent(indentSize);
      if (indentSize > 0) {
        strs.forEach(str =>
          Array.from(str.raw.matchAll(indentRe)).forEach(match => {
            const indent = matchRange(match, str.start);
            ms.remove(indent.start, indent.end);
          }));
      }

      // remove trailing line break
      if (!options.trimTrailingNewline.static || options.trimTrailingNewline.value) {
        const last = strs[strs.length - 1];
        const trailingNewLineRe = rx`(${raw.assertEvenBackslash(raw.lineBreak)})${indentRe}(${raw.spaceOrTab}*)$`;
        const trailing = matchRange(last.raw.match(trailingNewLineRe), last.start);
        if (trailing) {
          // do not substitute the trailing line break (if it survives)
          lineBreakSubstitution.end = trailing.start;
          if (options.trimTrailingNewline.static && options.trimTrailingNewline.value)
            if (removingTag)
              // no runtime outdent, so we should trim the trailing line break
              // (and its trailing spaces or tabs)
              ms.remove(trailing.start, trailing.end);
            else
              // runtime will still do outdent, so we need to leave a line break
              // for it; we can remove and spaces and tabs though
              ms.update(trailing.start, trailing.end, trailing.match[1]);
        }
      }

      // substitute line breaks in region (original leading/trailing line breaks preserved if not removing the tag)
      if (options.newline.static && typeof options.newline.value == 'string') {
        const subst = options.newline.value;
        const lb = subst.match(rx`\r\n|\n|\r(?!\n)`);
        if (removingTag || !lb || subst == lb[0]) {
          // we can only do the line break substitution if
          // 1) we are removing the runtime outdent processing (so we need to do
          //    it now), OR
          // 2) there is no line break in the substitution string (so runtime
          //    outdent processing will not re-substitute based on our
          //    substitutions), OR
          // 3) the substitution is exactly a single line break (runtime outdent
          //    substitution will be idempotent)

          // literal (unescaped) CR and CRLF inside a template literal (tagged
          // or not) are always translated to LF thus, any CR needs to be escaped
          const substEscaped = subst.replaceAll('\r', '\\r');
          strs.forEach(str =>
            Array.from(str.raw.matchAll(rx('g')`${raw.assertEvenBackslash(raw.lineBreak)}`)).forEach(lbMatch => {
              const lb = matchRange(lbMatch, str.start);
              if (lb.end <= lineBreakSubstitution.start || lineBreakSubstitution.end <= lb.start) return;
              ms.update(lb.start, lb.end, substEscaped);
            }));
        }
      }

      // helper functions
      function matchRange(m: null, base?: number): undefined;
      function matchRange(m: RegExpMatchArray, base?: number): { start: number, end: number, match: RegExpMatchArray };
      function matchRange(m: RegExpMatchArray | null, base?: number): undefined | { start: number, end: number, match: RegExpMatchArray };
      function matchRange(m: RegExpMatchArray | null, base = 0): undefined | { start: number, end: number, match: RegExpMatchArray } {
        if (m == null) return;
        // We could take RegExpExecArray (and change most callers to use
        // re.exec(str)), but we also use str.matchAll(re)... I think (and
        // https://github.com/microsoft/TypeScript/issues/36788 shows some
        // agreement) that matchAll should be typed as returning (an iterator
        // of) RegExpExecArray, but it hasn't been changed yet.
        if (m.index == null) throw new TypeError('matchRange called with a match that has a null index (str.match on a re with global flag?)');
        return { start: base + m.index, end: base + m.index + m[0].length, match: m };
      }

      function exprIsIndentationMarkerInContext(before: { raw: string, start: number }, expr: ExtendNode<ESTree.Expression> | undefined, after: { raw: string, start: number } | undefined): { hasMarker: MaybeStatic<boolean>, substitutionStart: number } {

        if (!expr || !after)
          return { hasMarker: staticValue(false), substitutionStart: before.start };

        const hasMarker = exprIsIndentationMarker(expr);

        if (hasMarker.static && !hasMarker.value)
          return { hasMarker: staticValue(false), substitutionStart: before.start };

        // only spaces, tabs, and line breaks may precede marker, must have at least one line break
        const markerLeadInRe = rx`^(?:${raw.spaceOrTab}*${raw.lineBreak})+${raw.spaceOrTab}*$`;
        // string after marker must be empty, or start with a line break
        const markerLeadOutRe = rx`${raw.empty}|^${raw.lineBreak}`;

        const markerLeadOut = matchRange(after.raw.match(markerLeadOutRe), after.start);
        if (markerLeadInRe.test(before.raw) && markerLeadOut) {
          if (hasMarker.static && hasMarker.value)
            // the expression is definitely the indentation marker: start line
            // break substitution immediately after the expression
            return { hasMarker, substitutionStart: after.start };
          else
            // the expression might or might not be the indentation marker:
            // protect the immediately following line break from substitution
            return { hasMarker, substitutionStart: markerLeadOut.end };
        } else
          // the expression is definitely not the indentation marker: it did not
          // pass check of surrounding string content; start line break
          // substitution at the start of the before string
          return { hasMarker: staticValue(false), substitutionStart: before.start };
      }

      function exprIsIndentationMarker(expr: ExtendNode<ESTree.Expression>): MaybeStatic<boolean> {

        if (analyzePossibleOutdentExpression(scope, expr, true) == 'imported outdent')
          return staticValue(true);

        if (isIdentifier(tagged.tag) && isIdentifier(expr) && tagged.tag.name == expr.name)
          return staticValue(true);

        // the following exprs either do not produce function values or produce
        // _new_ function values that could not possibly be an indentation marker
        if (false
          || expr.type == 'ArrayExpression'
          || expr.type == 'ArrowFunctionExpression'
          || expr.type == 'AssignmentExpression' && (false
            || expr.operator == '+='
            || expr.operator == '-='
            || expr.operator == '*='
            || expr.operator == '/='
            || expr.operator == '%='
            || expr.operator == '**='
            || expr.operator == '<<='
            || expr.operator == '>>='
            || expr.operator == '>>>='
            || expr.operator == '|='
            || expr.operator == '^='
            || expr.operator == '&='
            // plain assignment and boolean assignments can evaluate to an indentation marker
            // || expr.operator == '='    // x=outdent
            // || expr.operator == '||='  // x=falsy; ... x||=outdent
            // || expr.operator == '&&='  // x=truthy; ... x&&=outdent
            // || expr.operator == '??='  // x=nullish; ... x??=outdent
          )
          || expr.type == 'BinaryExpression'
          || expr.type == 'ClassExpression'
          || expr.type == 'FunctionExpression'
          || expr.type == 'ImportExpression'
          || expr.type == 'Literal'
          || expr.type == 'ObjectExpression'
          || expr.type == 'TemplateLiteral'
          || expr.type == 'UnaryExpression'
          || expr.type == 'UpdateExpression'
          // the remaining expressions could all possibly evaluate to an indentation marker
          // || node.type == 'AwaitExpression'          // ${await Promise.resolve(outdent)}
          // || node.type == 'CallExpression'           // ${(()=>outdent)()}
          // || node.type == 'ChainExpression'          // x={o:outdent}; ... ${x?.o}
          // || node.type == 'ConditionalExpression'    // ${true?outdent:outdent}
          // || node.type == 'Identifier'               // let o=outdent; ... ${o} we don't track all possible bindings, so keep tag for unrecognized identifiers
          // || expr.type == 'LogicalExpression'        // falsy||outdent, truthy&&outdent, nullish??outdent
          // || node.type == 'MemberExpression'         // x={o:outdent}; ... ${x.o}
          // || node.type == 'MetaProperty'             // ${import.meta} unlikely, but maybe some environment could arrange (e.g.) import.meta to be outdent?
          // || node.type == 'NewExpression'            // ${new (function(){return outdent}()}
          // || node.type == 'SequenceExpression'       // ${1,outdent}
          // || node.type == 'TaggedTemplateExpression' // const t = () => outdent; ${t``}
          // || node.type == 'ThisExpression'           // (function () {return outdent`${this}`}).call(outdent)
          // || node.type == 'YieldExpression'          // ${yield} in generator; caller can supply outdent as value of yield expression
        )
          return staticValue(false);

        // other static, referentially transparent tag==marker constructions are possible {o:outdent}.o`...${{o:outdent}.o}}`; are any compelling?

        return nonStaticValue();
      }
    },
  });

  function isLiteralString(node: ExtendNode<ESTree.Node>): node is ExtendNode<ESTree.Literal> & { value: string; } {
    return node.type == 'Literal' && typeof node.value == 'string';
  }
  function isIdentifier(node: ExtendNode<ESTree.Node>): node is ExtendNode<ESTree.Identifier> {
    return node.type == 'Identifier';
  }

  // analyze various expressions for effective outdent options
  function analyzePossibleOutdentOptions(scope: AttachedScope, node: ExtendNode<ESTree.Expression>): undefined | AnalyzedOutdentOptions {
    const value = analyzePossibleOutdentExpression(scope, node);

    if (value == 'imported outdent namespace')
      return;

    else if (value == 'imported outdent')
      return {
        trimLeadingNewline: { static: true, value: true },
        trimTrailingNewline: { static: true, value: true },
        newline: { static: true, value: null },
      } satisfies AnalyzedOutdentOptions;

    else
      return value;
  }

  // lookup or analyze various expressions for outdent values or effective options
  // we use this against const init expressions and tagged template literal tag expressions
  function analyzePossibleOutdentExpression(scope: AttachedScope, node: ExtendNode<ESTree.Expression>, defaultOnly = false): undefined | BindableValue {

    const allNonStatic = {
      trimLeadingNewline: { static: false },
      trimTrailingNewline: { static: false },
      newline: { static: false }
    } as const satisfies AnalyzedOutdentOptions;

    // Identifiers of import/const outdent values or analyzed options
    if (isIdentifier(node))
      return boundValue(scope, node.name);

    // MemberExpressions against import/const of outdent namespace
    else if (node.type == 'MemberExpression') {
      // object.property
      if (!isIdentifier(node.object)) return;
      if (boundValue(scope, node.object.name) != 'imported outdent namespace') return;
      // object is an imported namespace; i.e. import * as od ...;
      if (!node.computed) {
        if (isIdentifier(node.property) && namedExports.has(node.property.name))
          // od.outdent`...`
          return 'imported outdent';
      } else {
        if (isLiteralString(node.property) && namedExports.has(node.property.value))
          // od['outdent']`...`
          return 'imported outdent';
      }

    } else if (defaultOnly)
      return; // only Identifiers and MemberExpressions can be default outdent values (no options applied or being applied), so stop here

    // CallExpression calling outdent (or derived outdent) with options
    else if (node.type == 'CallExpression') {
      if (node.callee.type == 'Super') return;
      const baseOptions = analyzePossibleOutdentOptions(scope, node.callee);
      if (baseOptions)
        return analyzeOptionsFromCall(baseOptions, node);
    }

    return;

    // parse call expression with a single object expression (after un-spreading arguments)
    function analyzeOptionsFromCall(baseOptions: AnalyzedOutdentOptions, call: ExtendNode<ESTree.SimpleCallExpression>): AnalyzedOutdentOptions {
      const args = collectStaticArgumentSpreads(call.arguments);
      if (args?.length == 1) {
        const opts = args[0];
        if (opts?.type == 'ObjectExpression')
          return analyzeOptionsFromObject(baseOptions, opts);
      }
      return allNonStatic;
    }

    // un-spread arguments in a function call; returns undefined if a spread
    // argument is not an array expression
    function collectStaticArgumentSpreads(elements: ExtendNode<ESTree.Expression | ESTree.SpreadElement | null>[]): undefined | (ExtendNode<ESTree.Expression> | null)[] {
      return elements.reduce((result: ReturnType<typeof collectStaticArgumentSpreads>, el) => {
        if (!result) return;

        if (el === null)
          return result.concat([null]);

        else if (el.type == 'SpreadElement')
          if (el.argument.type == 'ArrayExpression') {
            const newEls = collectStaticArgumentSpreads(el.argument.elements);
            if (!newEls) return;
            return result.concat(newEls);
          } else
            return;

        else
          return result.concat([el]);
      }, []);
    }

    // analyze an object expression for outdent option values
    function analyzeOptionsFromObject(baseOptions: AnalyzedOutdentOptions, obj: ExtendNode<ESTree.ObjectExpression>): AnalyzedOutdentOptions {
      if (obj.properties.length == 0)
        return baseOptions;

      const getters = new Set<string>;
      return obj.properties.reduce((options, p) => {
        if (p.type == 'Property') {

          // { key:… }
          if (isIdentifier(p.key))
            return analyzeOptionValueFromProperty(options, p, p.key.name);

          // { "key":… } or { ["key"]:… }
          else if (isLiteralString(p.key)) // computed or not
            return analyzeOptionValueFromProperty(options, p, p.key.value);

          // { [`key`]:… }
          else if (p.computed && p.key.type == 'TemplateLiteral' && p.key.expressions.length == 0 && p.key.quasis[0].value.cooked)
            return analyzeOptionValueFromProperty(options, p, p.key.quasis[0].value.cooked);

          return allNonStatic;

          // eslint-disable-next-line no-inner-declarations
          function analyzeOptionValueFromProperty(baseOptions: AnalyzedOutdentOptions, p: ExtendNode<ESTree.Property>, key: string) {
            // ignore extraneous keys
            if (!isOptionKey(key))
              return baseOptions;

            if (p.kind == 'set') {
              // a lone setter causes undefined value
              // or uses its getter-derived value
              return getters.has(key)
                ? baseOptions // if we have a getter, keep its result (probably non-static, since we don't examine the guts of a getter)
                : staticOption(baseOptions, key, void 0); // set it to undefined, possibly until a subsequent getter or init overrides it

            } else if (p.kind == 'get') {
              // getters are not statically analyzed
              getters.add(key);
              return nonStaticOption(baseOptions, key);
            }

            return analyzeOptionValue(baseOptions, key, p.value);
          }

        } else if (p.type == 'SpreadElement')

          if (p.argument.type == 'ObjectExpression')
            // { ...{…} }
            return analyzeOptionsFromObject(options, p.argument);
          else
            return allNonStatic;

        else
          assertNever(p);
      }, baseOptions);
    }

    // analyze an object expression property value for outdent option value
    function analyzeOptionValue(baseOptions: AnalyzedOutdentOptions, key: keyof AnalyzedOutdentOptions, value: ExtendNode<ESTree.Expression | ESTree.Pattern>): AnalyzedOutdentOptions {

      const update = (key: keyof AnalyzedOutdentOptions, value: unknown) => {

        if (key == 'trimLeadingNewline' || key == 'trimTrailingNewline')
          return staticOption(baseOptions, key, !!value);

        else if (key == 'newline')
          return staticOption(baseOptions, 'newline', typeof value == 'string' ? value : null);

        else
          assertNever(key);
      };

      if (value.type == 'Literal')
        return update(key, value.value);

      // void …
      else if (value.type == 'UnaryExpression' && value.operator == 'void')
        return update(key, void 0);

      // `…` (no expressions)
      else if (value.type == 'TemplateLiteral')
        if (value.expressions.length == 0) // expr may throw, so can't assume value if any exprs
          return update(key, value.quasis[0].value.cooked);

      // some expression types are always truthy, never falsy, could handle them specially for trim options?

      return nonStaticOption(baseOptions, key);
    }
  }
})();

// helper for building regular expressions
function rx(flags: string): (strs: TemplateStringsArray, ...values: unknown[]) => RegExp;
function rx(strings: TemplateStringsArray, ...values: unknown[]): RegExp;
function rx(stringsOrFlags: TemplateStringsArray | string, ...values: unknown[]): RegExp | ((strs: TemplateStringsArray, ...values: unknown[]) => RegExp) {
  if (typeof stringsOrFlags == 'string')
    return (strings, ...values) => {
      return new RegExp(String.raw(strings, ...values.map((v, i) => {
        v = v instanceof RegExp ? v.source : v;
        if (/^[?*+{]/.test(strings[i + 1]))
          return `(?:${v})`;
        return v;
      })), stringsOrFlags);
    };
  return rx('')(stringsOrFlags, ...values);
}

//
// regular expressions used to parse raw strings
//
const raw = (() => {
  const assertEvenBackslash = (r: RegExp) => rx(r.flags)`(?<=(?<!\\)(?:\\\\)*)${r}`;
  const CR = (() => {
    const actual = rx`\r`;
    const escaped = rx`\\r`;
    const hex = rx`\\x0[dD]`;
    const u4 = rx`\\u000[dD]`;
    const uAny = rx`\\u\{0*[dD]\}`;
    return rx`(?:${actual}|${escaped}|${hex}|${u4}|${uAny})`;
  })();
  const LF = (() => {
    const actual = rx`\n`;
    const escaped = rx`\\n`;
    const hex = rx`\\x0[aA]`;
    const u4 = rx`\\u000[aA]`;
    const uAny = rx`\\u\{0*[aA]\}`;
    return rx`(?:${actual}|${escaped}|${hex}|${u4}|${uAny})`;
  })();
  const lineCont = rx`\\\n`;
  const lineBreak = (() => {
    return rx`${lineCont}*(?:(?:${CR}${lineCont}*${LF})|${LF}|(?:${CR}(?!${lineCont}*${LF})))`;
  })();
  const spaceOrTab = (() => {
    const actual = rx`[\t ]`;
    const escaped = rx`\\t|\\ |\\	`;
    const hex = rx`\\x09|\\x20`;
    const u4 = rx`\\u0009|\\u0020`;
    const uAny = rx`\\u\{0*9\}|\\u\{0*20\}`;
    return rx`${lineCont}*(?:(?:${actual}|${escaped}|${hex}|${u4}|${uAny})${lineCont}*)`;
  })();
  const empty = rx`^${lineCont}*$`;
  const indent = (indentSize: number) => {
    const unescaped = rx`(?<!\\)[^\\]`;
    const special =/**/rx`\\[0bfnrtv'"\\]`; // spell-checker:ignore bfnrtv unspecial
    const unspecial = rx`\\[^0bfnrtv'"\\ux]`;
    const hex = rx`\\x[0-9a-fA-F][0-9a-fA-F]`;
    // okay for \uHHHH to match surrogates individually, it is what outdent will match when processing the cooked version
    const u4 = rx`\\u[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]`;
    const uBMP = rx`\\u\{0{0,2}[0-9a-fA-F]{1,4}\}`;

    // Code points outside the Basic Multilingual Plane must be treated
    // specially when dealing with raw \u{} sequences.
    //
    // outdent will see the cooked version and it "counts" by UTF-16 code units,
    // thus the surrogate pair for a non-BMP code point will be counted as two
    // "characters".
    //
    // We will maintain that "character" count by artificially splitting the
    // non-BMP \u{} sequence into two parts:
    //
    //     first second
    //  [1-9a-f] [0-9a-f]{4}     U+10000 - U+fffff
    //        10 [0-9a-f]{4}    U+100000 - U+10ffff

    const uAstralFirst = rx`\\u\{(?:[1-9a-fA-F]|10)`;
    const uAstralSecond = rx`[0-9a-fA-F]{4}\}`;
    const uAstral = rx`(?<=${uAstralFirst})${uAstralSecond}|${uAstralFirst}(?=${uAstralSecond})`;

    // match astral before unescaped to make sure the Second part is not matched as plain unescaped characters
    return rx('g')`(?<=${assertEvenBackslash(lineBreak)})(?:${lineCont}*(?:${uAstral}|${unescaped}|${special}|${unspecial}|${hex}|${u4}|${uBMP})(?<!${LF}|${CR})){0,${indentSize}}${lineCont}*`;
  };
  return { assertEvenBackslash, lineCont, lineBreak, spaceOrTab, empty, indent };
})();

export function assertNever(value: never): never { throw 'assertNever called' } // eslint-disable-line @typescript-eslint/no-unused-vars
