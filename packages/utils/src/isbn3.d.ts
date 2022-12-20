// as suggested in https://github.com/inventaire/isbn3/issues/8

interface ISBNAuditObject {
    source: string,
    validIsbn: boolean,
    groupname?: string,
    clues: Array<{
        message: string,
        candidate: string,
        groupname: string
    }>
}

interface ISBNObject {
    source: string,
    isValid: boolean,
    isIsbn10: boolean,
    isIsbn13: boolean,
    prefix?: string,
    group: string,
    publisher: string,
    article: string,
    check: string,
    isbn13?: string,
    isbn13h?: string,
    check10: string,
    check13: string,
    groupname: string,
    isbn10?: string,
    isbn10h?: string
}

declare module "isbn3" {
    function parse(isbn: string): ISBNObject | null;
    function asIsbn13(isbn: string): string;
    function asIsbn10(isbn: string): string;
    function hyphenate(isbn: string): string;
    function audit(isbn: string): ISBNAuditObject;
    const groups: Record<string, {
        name: string,
        ranges: Array<[string, string]>
    }>;

    export { parse, asIsbn10, asIsbn13, hyphenate, audit, groups };
}
