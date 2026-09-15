/** Generated viewer copy is selected only by the authored locale, never browser preferences. */
export const VR_TOUR_COPY = {
  en: {
    toolbar: 'Tour controls',
    viewport:
      '360° panorama. Drag to look around. Arrow keys rotate; plus and minus zoom; Home resets.',
    load: 'Load panorama',
    reset: 'Reset view',
    source: 'Loads image from: ',
    noImage: 'No panorama image loaded',
    invalidURL: 'Invalid panorama URL. Select a listing with an allowed JPG, PNG or WebP URL.',
    placeholder: 'Panorama placeholder. Add a 2:1 image to use this tour.',
    offline: 'Image stays offline until you choose Load panorama.',
    loading: 'Loading panorama…',
    hotspotHint: '. Select room; then load its panorama.',
    ready: 'Drag to look around · Ctrl + wheel to zoom · Select a hotspot to change rooms',
    timedOut: 'Panorama loading timed out. Retry when ready.',
    unavailable: 'Panorama unavailable. Check the image URL, CORS and WebGL support.',
    room: 'Tour room',
    requestFailed: 'Panorama request failed',
    expectedImage: 'Expected a JPG, PNG or WebP panorama',
    tooLarge: 'Panorama exceeds 24 MiB',
    mismatchedDimensions: 'Decoded panorama dimensions do not match its header',
    displayFailed: 'Panorama could not be displayed',
    invalidWebPHeader: 'Invalid WebP image header',
    invalidDimensions: 'Use a 2:1 equirectangular JPG, PNG or WebP, 512–8192 pixels wide',
    viewer: {
      zoom: 'Zoom',
      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      moveUp: 'Move up',
      moveDown: 'Move down',
      moveLeft: 'Move left',
      moveRight: 'Move right',
      description: 'Description',
      download: 'Download',
      fullscreen: 'Fullscreen',
      loading: 'Loading...',
      menu: 'Menu',
      close: 'Close',
      twoFingers: 'Use two fingers to navigate',
      ctrlZoom: 'Use ctrl + scroll to zoom the image',
      loadError: 'The panorama cannot be loaded',
      webglError: 'Your browser does not seem to support WebGL',
      markers: 'Markers',
      markersList: 'Markers list'
    }
  },
  'zh-CN': {
    toolbar: '全景操作',
    viewport: '360° 全景。拖动查看四周；方向键转动视角，加减键缩放，Home 键复位。',
    load: '加载全景',
    reset: '重置视角',
    source: '图片来源：',
    noImage: '尚未加载全景图片',
    invalidURL: '全景图片地址无效。请选择包含受支持 JPG、PNG 或 WebP 图片地址的房源。',
    placeholder: '全景占位图。请添加一张宽高比为 2:1 的全景图片。',
    offline: '点击“加载全景”后才会读取图片。',
    loading: '正在加载全景…',
    hotspotHint: '。选择房间后，再加载该房间的全景。',
    ready: '拖动查看四周 · 按住 Ctrl 滚动滚轮可缩放 · 点击热点切换房间',
    timedOut: '全景加载超时，请重试。',
    unavailable: '无法显示全景。请检查图片地址、跨域访问设置和 WebGL 支持。',
    room: '全景房间',
    requestFailed: '全景图片请求失败',
    expectedImage: '请使用 JPG、PNG 或 WebP 全景图片',
    tooLarge: '全景图片超过 24 MiB',
    mismatchedDimensions: '全景图片解码后的尺寸与文件头不一致',
    displayFailed: '无法显示全景图片',
    invalidWebPHeader: 'WebP 图片文件头无效',
    invalidDimensions: '请使用宽高比为 2:1、宽度为 512–8192 像素的 JPG、PNG 或 WebP 等距柱状全景图',
    viewer: {
      zoom: '缩放',
      zoomOut: '缩小',
      zoomIn: '放大',
      moveUp: '向上查看',
      moveDown: '向下查看',
      moveLeft: '向左查看',
      moveRight: '向右查看',
      description: '说明',
      download: '下载',
      fullscreen: '全屏',
      loading: '正在加载…',
      menu: '菜单',
      close: '关闭',
      twoFingers: '请用双指拖动查看全景',
      ctrlZoom: '请按住 Ctrl 键并滚动滚轮缩放图片',
      loadError: '无法加载全景图片',
      webglError: '浏览器不支持 WebGL，无法显示全景',
      markers: '热点',
      markersList: '热点列表'
    }
  }
} as const

export const VR_TOUR_COPY_SOURCE = `
const VR_TOUR_COPY = ${JSON.stringify(VR_TOUR_COPY)} as const
type TourLocale = 'en' | 'zh-CN'
type TourCopy = (typeof VR_TOUR_COPY)[TourLocale]
export function tourCopy(locale: TourLocale = 'en'): TourCopy {
  return locale === 'zh-CN' ? VR_TOUR_COPY['zh-CN'] : VR_TOUR_COPY.en
}
export class PanoramaError extends Error {}
`
