Using a book list app or service is a great way to track books you have read and those you want to read. Unfortunately it is quite easy for your "to be read" list to grow until it is difficult to review while browsing books.

Many book sources (libraries, stores, etc.) will let you maintain lists (or wishlists), but there may be no good way to import your "to be read" list from your book list service.

This programs in this repository aim to bridge that gap for services that can import a list of ISBNs. Starting with an export from your book list service, they can:

1. select a portion of your book list entries (e.g. your "to be read" list)
2. review entries that are missing ISBNs (some eBooks and audio books do not use ISBNs and book list services sometimes use these as the default edition of a book if you do not pick a different one),
3. extract the ISBNs of your book entries,
4. optionally add the ISBNs of other editions of your books (using external services),
5. produce the extracted (and, optionally, expanded) list of ISBNs.

Then you can upload this list of ISBNs to a book source (i.e. library or book store) to find out which books they have available.

# Platforms

This repository has a Node program for command-line use on "PC" systems
(Windows/Mac), and a Scriptable program for use on iOS devices.

# Supported Book List Services

The programs understand these services' export formats:

* Goodreads
    * CSV with its specific set of columns
    * its "shelves" system
* LibraryThing
    * TSV with its specific set of columns
    * its "collections and tags" system

Suggest your favorite book list format for support in future versions!

# Development

This software is developed with Node.js using the IDE and tooling described
below. It runs in the iOS Scriptable app, and in Node.js (for easier testing of
the functionality that can be shared). A webpage-based version should also be
possible, but is not a primary focus.

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
    yarn workspace foo run --top-level eslint
    packages/foo> yarn run --top-level eslint       # cwd in workspace

### Rollup

    yarn rollup -c      # top level config "imports" each package's config

    yarn workspace foo run --top-level rollup -c
    packages/foo> yarn run --top-level rollup -c    # cwd in workspace

### Jest

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

# Releases

The Node tool is not currently bundled and released (if you already have Node, a
`yarn install` and `yarn rollup -c` should get you there).

The fully-bundled Scriptable tool is released on a separately-rooted ("orphan")
branch named `released`. This pre-bundled file can be used to distribute the
program to iOS-only Scriptable users.

The Scriptable content of this branch is created with these steps:

1. Commit all the desired changes and stash any incomplete changes to tracked files.

    The committed changes to `packages/utils/src/version.ts` should include a new
    (previously untagged) version number.

2. Create an annotated (or annotated and signed) tag for the new release.

        git tag -a v1.0

    The tag's annotation text should include a summary of what has changed.

3. Make sure the `released` branch is checked out in a worktree at the top of
   the main repository. Skip this step, if it is already present.

        git worktree add released

4. Run the Scriptable release helper:

        yarn workspace scriptable run release

    Or, from inside the Scriptable package:

        packages/Scriptable> yarn run release

    This will check that the worktree is clean and tagged, run a release-mode
    Rollup, and check the released file's header for a Git description
    annotation, production mode, and make sure it doesn't have too many newlines
    (as a proxy for minification).

5. Commit in the `released` worktree.

        released> git commit -a

    The commit message should mention which version is being released.
