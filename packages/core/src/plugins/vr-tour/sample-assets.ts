/** Reviewed CC0 sample pack. Image bytes are acquired only by the app's explicit installer. */
export interface VRTourSampleAsset {
  readonly id: string
  readonly title: string
  readonly fileName: string
  readonly panoramaUrl: string
  readonly downloadUrl: string
  /** SceneGraph lookup key, not a cryptographic integrity proof. */
  readonly graphImageHash: string
  readonly sha256: string
  readonly byteLength: number
  readonly width: number
  readonly height: number
  readonly author: string
  readonly sourceUrl: string
  readonly license: 'CC0-1.0'
  readonly licenseUrl: string
}

export const VR_TOUR_SAMPLE_PACK_ID = 'open-pencil.vr-tour.samples.v1'
export const VR_TOUR_SAMPLE_PACK_DIGEST =
  'da616e75d7a856f881ccaaf61b4e0ed6cb7734cc86364348b173d6b923fa8af8'
export const VR_TOUR_SAMPLE_PACK_BYTES = 6_456_319

export const VR_TOUR_SAMPLE_ASSETS: readonly VRTourSampleAsset[] = Object.freeze([
  Object.freeze({
    id: 'cayley-interior',
    title: 'Cayley Interior',
    fileName: 'cayley_interior.jpg',
    panoramaUrl: '/assets/vr-tour/cayley_interior.jpg',
    downloadUrl:
      'https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/cayley_interior.jpg',
    graphImageHash: '15f764c0f877a4c39d142c7b81de01b44e742659',
    sha256: 'abf4897f4c2f36226a1ffbb2dbc52e5777e04f2ab18a8b46d05f327b98c879cc',
    byteLength: 4_583_075,
    width: 8192,
    height: 4096,
    author: 'Greg Zaal',
    sourceUrl: 'https://polyhaven.com/a/cayley_interior',
    license: 'CC0-1.0' as const,
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  }),
  Object.freeze({
    id: 'lebombo',
    title: 'Lebombo',
    fileName: 'lebombo.jpg',
    panoramaUrl: '/assets/vr-tour/lebombo.jpg',
    downloadUrl: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/lebombo.jpg',
    graphImageHash: '76df83c660b192f7bc8a141d8bda7550550a39c9',
    sha256: '2e70777b9947b8a74809c22b9485bea6c4d67955e1ab2747507890b429eb1e9b',
    byteLength: 1_873_244,
    width: 8192,
    height: 4096,
    author: 'Greg Zaal',
    sourceUrl: 'https://polyhaven.com/a/lebombo',
    license: 'CC0-1.0' as const,
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  })
])
