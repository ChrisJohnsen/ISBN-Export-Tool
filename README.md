# Goodreads export tools

Currently under development. Existing features:

* List `to-read` entries that don't have ISBNs.

    These can happen when adding a book when its default (most popular?) edition
    is some version that does not haven an ISBN (often: eBook, audio). Such a
    list could be used to manaully "fix" the active edition.

        node goodreads-tool.js missing-ISBNS path/to/goodreads-export.csv

* Extract a list of ISBNs from shelved items.

    This can be imported by some library interfaces. Doing so can let you review
    which books in (the exported snapshot of) your Goodreads (e.g.) `to-read`
    shelf are available through a particular library.

        node goodreads-tool.js get-ISBNS path/to/goodreads-export.csv to-read

    If Goodreads supplies an ISBN-13 and ISBN-10, then only the ISBN-13 will be
    extracted.

    * Optionally include both the ISBN-13 and ISBN-10 of each shelved item:

            node goodreads-tool.js get-ISBNS path/to/goodreads-export.csv to-read --both

        ISBN-10s are a proper subset of ISBN-13s, so there usually isn't a need
        for both, but maybe the system you want to send the generated list to
        doesn't know (how) to convert between them.

    * Optionally ask external web services for the ISBNs of other editions of
      the work that is shelved in Goodreads. The supported web services are Open
      Library (two methods, probably equivalent), and LibraryThing (one method).
      Requests are rate limited, so it may take a second or two to retrieve the
      result ISBNs.

            node goodreads-tool.js get-ISBNS path/to/goodreads-export.csv to-read --editions

        This only produces ISBN-13s, but can be combined with `--both` if you
        want both of them. The "editions of" relation is cached locally to avoid
        spamming the web services.

        This can be handy if the system to which you'll be giving the extracted
        ISBNs does not automatically look for other editions of a particular work
        (maybe you shelved the paperback edition on Goodreads, the library doesn't
        have it, but does have a hardback edition).

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
