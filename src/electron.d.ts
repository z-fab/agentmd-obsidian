// Minimal ambient typing for the Electron `shell` API used to reveal/open
// files on the desktop. The module is provided by the host at runtime and is
// marked external in the esbuild bundle.
declare module "electron" {
  export const shell: {
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
  };
}
