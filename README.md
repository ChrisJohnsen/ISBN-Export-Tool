# Goodreads export tools

Currently under development. Planned features:

* List `to-read` entries that don't have ISBNs

    These can happen when adding a book when its default (most popular?) edition
    is some non-print version (eBook, audio). Such a list could be used to
    manaully "fix" the active edition.

* Extract a list of `to-read` ISBNs.

    This can be imported by some library interfaces. Doing so can let you review
    which books in (the exported snapshot of) your Goodreads `to-read` shelf are
    available through a particular library.

  * fancy version: Ask Worldcat for associated ISBNs and include those in the
    generated list, too. Just in case the library doesn't do something like this
    automatically (maybe you shelved the paperback edition on Goodreads, the
    library doesn't have it, but does have a hardback edition).

# Development

This software is developed with Node.js using the IDE and tooling described
below. It is intended to eventually run in the iOS Scriptable app, but also
directly in Node.js for easier testing of the functionality that can be shared.
A webpage-based version should also be possible, but is not a primary focus.

## Editor/IDE

This repository is set up for use with VS Code. Other editors might benefit from
additional [Yarn Editor SDKs][sdks].

[sdks]: https://yarnpkg.com/getting-started/editor-sdks

## CLI

Note: The `yarn workspace` command version of the following commands uses the
workspace's package name. The other top level command uses some form of the path
to the package. These might not always be the same (i.e. `package.json` `"name"`
can be different from the name of the directory that contains the
`package.json`).

### TypeScript

Note: Files under `tests/` are not included in the package-level
`tsconfig.json`. Those must be processed separately, as shown below.

    yarn tsc -p packages/foo
    yarn workspace foo run --top-level tsc
    packages/foo> yarn run --top-level tsc          # cwd in workspace

    yarn tsc -p packages/foo/tests
    packages/foo/tests> yarn run --top-level tsc    # cwd in workspace tests

### ESLint

    yarn eslint packages/foo
    yarn workspace foo run --top-level eslint .
    packages/foo> yarn run --top-level eslint .     # cwd in workspace

### Rollup

    yarn rollup -c      # top level config "imports" each package's config

    yarn workspace foo run --top-level rollup -c
    packages/foo> yarn run --top-level rollup -c    # cwd in workspace

## Jest

Note: A `package.json` `"script"` is used to add `--experimental-vm-modules` to
Node's options. This lets us directly use ESM test files. If Jest is run
with/without this flag the cached transformations can cause problems when Jest
is run again without/with the flag (e.g. `Cannot use import statement outside a
module` (ESM files, cached with, run again without) and `exports is not defined`
(TS ESM files, cached without, run again with)). So, avoid using
`--binaries-only`/`-B` with the `jest` script.

    yarn jest               # all tests in all packages
    yarn jest packages/foo  # regexp filter test pathnames
    yarn jest -t regexp     # regexp filter describe and test strings
