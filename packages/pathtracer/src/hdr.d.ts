// Bundled environment images (@modelshot/looks environmentImages.ts) ship inlined as data URLs: Vite's `?url&inline`
// makes any file an asset and inlines it, so no config names the extension and nothing is fetched.
declare module '*.hdr?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}
