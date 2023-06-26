// Scriptable generic stuff

const lfm = FileManager.local();

export function basename(path: string) {
  return lfm.fileName(path);
}

export function dirname(path: string) {
  const filename = lfm.fileName(path, true);
  if (!path.endsWith(filename)) throw 'path does not end with extracted filename!?';
  const dirSlash = path.slice(0, path.length - filename.length);
  return dirSlash.replace(/[/]*$/, '');
}

export async function localTempfile(filename: string, contents?: string | Data): Promise<ReadWrite> {
  const rw = new ReadWrite(lfm.joinPath(lfm.temporaryDirectory(), filename));
  if (contents != null)
    if (typeof contents == 'string')
      await rw.writeString(contents);
    else
      await rw.write(contents);
  return rw;
}

export async function downloadFilesFromiCloud(paths: string[]) {
  return Promise.all(paths.map(path => lfm.downloadFileFromiCloud(path))).then(() => paths);
}

/**
 * Generate a pathname (with the given extension) "next to" the given pathname.
 *
 * The generated pathname will be located in the same directory as the specified
 * pathname. By default it will have the same base name (filename without final
 * extension) as the specified pathname, but a modification function can be
 * given to modify the name used.
 *
 * For example, given a pathname like `foo/bar/Your Program.js`, and the
 * extension `json`, the generated pathname will be `foo/bar/Your Program.json`.
 * A filename modification function could add `' log'` to change it to
 * `foo/bar/Your Program log.json`.
 */
export function asidePathname(pathname: string, ext: string, modifyBasename?: (basename: string) => string) {
  const dir = dirname(pathname);
  const basename = lfm.fileName(pathname);
  const newBasename = modifyBasename?.(basename) ?? basename;
  return lfm.joinPath(dir, newBasename + '.' + ext);
}

export class Store {
  private rw: ReadWrite;
  constructor(pathname: string) {
    this.rw = new ReadWrite(pathname);
  }
  public data: unknown;
  async read(): Promise<void> {
    if (await this.rw.exists())
      this.data = JSON.parse(await this.rw.readString());
    else
      this.data = null;
  }
  async write(): Promise<void> {
    this.rw.writeString(JSON.stringify(this.data));
  }
}

export class Log {
  private rw: ReadWrite;
  constructor(pathname: string) {
    this.rw = new ReadWrite(pathname);
  }
  private log: string[] = [];
  append(line: string) {
    this.log.push(line);
  }
  async flush(): Promise<void> {
    if (this.log.length > 0) {
      const logs = this.log.splice(0);
      await this.rw.writeString(await this.rw.readString() + logs.join('\n') + '\n');
    }
  }
}

export class ReadWrite {
  constructor(private _pathname: string) { }
  get pathname(): string {
    return this._pathname;
  }
  async exists(): Promise<boolean> {
    return lfm.fileExists(this._pathname);
  }
  async read(): Promise<Data> {
    if (lfm.fileExists(this._pathname)) {
      await lfm.downloadFileFromiCloud(this._pathname);
      return lfm.read(this._pathname);
    }
    return Data.fromString('');
  }
  async write(data: Data): Promise<void> {
    lfm.write(this._pathname, data);
  }
  async readString(): Promise<string> {
    return (await this.read()).toRawString();
  }
  async writeString(str: string) {
    return this.write(Data.fromString(str));
  }
  async remove(): Promise<void> {
    return lfm.remove(this._pathname);
  }
}

