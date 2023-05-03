The Node-based version of this tool has two main subcommands.

# Missing ISBNs

The `missing-ISBNs` subcommand lists entries that don't have ISBNs.

These can happen when adding a book when its default (most popular?) edition
is some version that does not haven an ISBN (often: eBook, audio). Such a
list could be used to manually "fix" the active edition.

    node isbn-tool.js missing-ISBNS path/to/export.csv to-read

# Get ISBNs

The `get-ISBNs` subcommand extracts a list of ISBNs from your exported book list.

Lists of ISBNs can be imported by some library interfaces. Doing so can let
you review which books from your exported data are available through a
particular library.

    node isbn-tool.js get-ISBNS path/to/export.csv to-read

ISBN-13 values are preferred over ISBN-10 values.

`get-ISBNs` has two options that can be combined.

## --editions

The `--editions` option asks external web services for the ISBNs of other
editions of the ISBN that was extracted from the exported data. The supported
web services are Open Library, and LibraryThing. Requests are rate limited, so
it may take a while to retrieve the result ISBNs.

    node isbn-tool.js get-ISBNS path/to/export.csv to-read --editions

This can be handy if the system to which you'll be giving the extracted
ISBNs does not automatically look for other editions of a particular
work (maybe you saved the paperback edition, the library doesn't have
it, but does have a hardcover edition).

This only produces ISBN-13s, but can be combined with `--both` if you
want both of them. The "editions of" relation is cached locally to avoid
spamming the web services.

## --both

The `--both` options causes both the ISBN-13 and ISBN-10 of each ISBN to be included.

    node isbn-tool.js get-ISBNS path/to/export.csv to-read --both

ISBN-10s are a (logical) proper subset of ISBN-13s, so there usually isn't a
need for both, but maybe the system you want to send the generated list to
doesn't know (how) to convert between them.
