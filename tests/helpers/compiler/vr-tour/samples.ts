import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'

export interface VRTourSampleFixture {
  files: Map<string, string | Uint8Array>
  samples: Array<{ path: string; fileName: string; sha256: string; byteLength: number }>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Source aliases and compiler execution stay in Bun; Node receives inert project data. */
export function generatedVRTourSampleFixture(target: 'react' | 'vue'): VRTourSampleFixture {
  const source = execFileSync(
    'bun',
    [
      '-e',
      `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { compile, withDefaults } from '@open-pencil/compiler';
import { SceneGraph } from '@open-pencil/scene-graph';
import { createLocalizedVRTourConfig, createVRTourSampleScenes, createVRTourModuleFrameOverrides, VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins';
const graph = new SceneGraph();
const page = graph.getPages()[0];
graph.updateNode(page.id, { name: '住宅全景试用' });
graph.createNode('TEXT', page.id, { name: 'Heading', text: '住宅全景试用', x: 24, y: 20, width: 1080, height: 40, fontSize: 28, fills: [{ type: 'SOLID', color: { r: 0.06, g: 0.09, b: 0.16, a: 1 }, opacity: 1, visible: true }] });
graph.createNode('TEXT', page.id, { name: 'Sample description', text: '两处独立住宅示例。点击“加载全景”开始体验，切换示例后再次加载。图片：Poly Haven / Greg Zaal / CC0。', x: 24, y: 72, width: 1080, height: 40, fontSize: 16, fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.3, b: 0.4, a: 1 }, opacity: 1, visible: true }] });
const config = createLocalizedVRTourConfig('zh-CN');
config.scenes = createVRTourSampleScenes('zh-CN');
graph.createNode('FRAME', page.id, { ...createVRTourModuleFrameOverrides(config), x: 24, y: 124, width: 1080, height: 620 });
for (const sample of VR_TOUR_SAMPLE_ASSETS) graph.images.set(sample.graphImageHash, new Uint8Array(readFileSync(join('packages/demos/vr-tour', sample.fileName))));
const output = compile({ graph, pageIds: [page.id], options: withDefaults({ target: '${target}', packageName: 'openpencil-vr-residential-demo', devMode: false }) });
if (output.warnings.length) throw new Error(JSON.stringify(output.warnings));
process.stdout.write(JSON.stringify({ files: [...output.files].map(([path, content]) => [path, typeof content === 'string' ? 'text' : 'base64', typeof content === 'string' ? content : Buffer.from(content).toString('base64')]), samples: VR_TOUR_SAMPLE_ASSETS.map(({ panoramaUrl, fileName, sha256, byteLength }) => ({ path: panoramaUrl, fileName, sha256, byteLength })) }));`
    ],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 }
  )
  const value: unknown = JSON.parse(source)
  if (!record(value) || !Array.isArray(value.files) || !Array.isArray(value.samples))
    throw new Error('Invalid generated VR sample fixture')
  const files: VRTourSampleFixture['files'] = new Map()
  for (const item of value.files) {
    if (
      !Array.isArray(item) ||
      item.length !== 3 ||
      typeof item[0] !== 'string' ||
      !['text', 'base64'].includes(item[1]) ||
      typeof item[2] !== 'string'
    )
      throw new Error('Invalid generated project file')
    files.set(
      item[0],
      item[1] === 'text' ? item[2] : new Uint8Array(Buffer.from(item[2], 'base64'))
    )
  }
  const samples: VRTourSampleFixture['samples'] = []
  for (const sample of value.samples) {
    if (
      !record(sample) ||
      typeof sample.path !== 'string' ||
      typeof sample.fileName !== 'string' ||
      typeof sample.sha256 !== 'string' ||
      typeof sample.byteLength !== 'number'
    )
      throw new Error('Invalid generated sample metadata')
    samples.push({
      path: sample.path,
      fileName: sample.fileName,
      sha256: sample.sha256,
      byteLength: sample.byteLength
    })
  }
  return { files, samples }
}
