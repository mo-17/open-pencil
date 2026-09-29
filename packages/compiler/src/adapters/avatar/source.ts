/** Imports only compiler-bundled image files; config cannot manufacture a URL or import path. */
export function avatarAssetImports(paths: readonly string[] = []): string {
  const images = [...new Set(paths)]
    .filter((path) => /^src\/assets\/openpencil-image-[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(path))
    .sort()
  return (
    images
      .map(
        (path, index) => `import avatarAsset${index} from ${JSON.stringify('./' + path.slice(4))}`
      )
      .join('\n') +
    '\nconst avatarAssets: Record<string,string> = {' +
    images.map((path, index) => `${JSON.stringify(path)}:avatarAsset${index}`).join(',') +
    '}\n'
  )
}
export const AVATAR_CONFIG_SOURCE = `export interface OpenPencilAvatarConfig {
  name:string; fallbackText:string; shape:'circle'|'rounded'|'square';
  backgroundColor:string; textColor:string; borderColor:string; borderWidth:number;
  borderRadius:number; size:number; fontSize:number; imageFit:'cover'|'contain';
  imageAsset?:string; imageOpacity?:number
}`
export const AVATAR_PRESENTATION_SOURCE = `function avatarPresentation(config: OpenPencilAvatarConfig) {
  const words=config.name.trim().split(/\\s+/)
  const text=config.fallbackText.trim() || (words.length>1
    ? (Array.from(words[0])[0]+Array.from(words.at(-1) ?? '')[0]).toUpperCase()
    : Array.from(words[0]).slice(0,2).join('').toUpperCase())
  const size=config.size
  return {text,size, radius:config.shape==='circle' ? size/2 : config.shape==='rounded' ? Math.min(size/2,config.borderRadius) : 0,
    fontSize:Math.min(config.fontSize,size*0.7/Math.max(1,Array.from(text).length)),
    src:config.imageAsset && Object.hasOwn(avatarAssets,config.imageAsset) ? avatarAssets[config.imageAsset] : undefined,
    fit:config.imageFit==='contain' ? 'xMidYMid meet' : 'xMidYMid slice'}
}`
export const AVATAR_STYLE_SOURCE = `
[data-openpencil-avatar]{box-sizing:border-box;display:flex;justify-content:center;align-items:center;min-width:0;max-width:100%;overflow:hidden;background:transparent!important;background-image:none!important}
[data-openpencil-avatar] [data-avatar-surface]{display:block;width:100%;height:100%;flex-shrink:1;overflow:hidden;font-family:Inter,system-ui,sans-serif}
`
