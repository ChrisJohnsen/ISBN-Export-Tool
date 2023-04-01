declare module 'consts:production' {
  const production: boolean;
  export default production;
}

declare module 'consts:git' {
  const git: { description: string };
  export default git;
}

declare module 'consts:dependencies' {
  const dependencies: {
    name: string | null,
    version: string | null,
    license: string | null,
    licenseText: string | null,
  }[];
  export default dependencies;
}
