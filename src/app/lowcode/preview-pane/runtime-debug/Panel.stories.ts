import type { Meta, StoryObj } from '@storybook/vue3-vite'

import Panel from './Panel.vue'
import type { RuntimeDebugEntry } from './protocol'

const entries: RuntimeDebugEntry[] = [
  {
    sequence: 1,
    trace: 1,
    nodeId: 'submit',
    kind: 'event',
    label: 'onClick',
    status: 'start',
    durationMs: null
  },
  {
    sequence: 2,
    trace: 1,
    nodeId: 'submit',
    kind: 'action',
    label: 'apiCall',
    status: 'start',
    durationMs: null
  },
  {
    sequence: 3,
    trace: 1,
    nodeId: 'submit',
    kind: 'request',
    label: 'POST 503',
    status: 'error',
    durationMs: 120
  },
  {
    sequence: 4,
    trace: 1,
    nodeId: 'submit',
    kind: 'state',
    label: 'requestError',
    status: 'changed',
    durationMs: null
  }
]

const meta = {
  title: 'App/Lowcode/Runtime Debug',
  component: Panel,
  args: { entries, recording: false, available: true, dropped: 0 },
  decorators: [() => ({ template: '<div class="w-96 bg-panel"><story /></div>' })]
} satisfies Meta<typeof Panel>
export default meta
type Story = StoryObj<typeof meta>
export const RequestFailure: Story = {}
export const EmptyRecording: Story = { args: { entries: [], recording: true } }
export const Unavailable: Story = { args: { entries: [], available: false } }
