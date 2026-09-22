import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import type { ACPContextUsageView } from '@/app/ai/acp/context-usage'

import ACPContextUsage from './AcpContextUsage.vue'

interface Args {
  usage: ACPContextUsageView
}

const meta = {
  title: 'Chat/Context usage',
  component: ACPContextUsage,
  args: { usage: { state: 'unavailable' } },
  render: (args) => ({
    components: { ACPContextUsage },
    setup: () => ({ args }),
    template: '<div class="w-80 bg-panel"><ACPContextUsage v-bind="args" /></div>'
  })
} satisfies Meta<Args>
export default meta
type Story = StoryObj<Omit<typeof meta, 'component'>>
export const NotProvided: Story = {}
export const Invalid: Story = { args: { usage: { state: 'invalid' } } }
export const Expired: Story = { args: { usage: { state: 'stale' } } }
export const Available: Story = {
  args: {
    usage: {
      state: 'available',
      used: 12_000,
      capacity: 200_000,
      percent: 6,
      inputTokens: 1_200,
      outputTokens: 250,
      updatedAt: Date.UTC(2026, 8, 22, 8)
    }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText(/6.0%/))
    await expect(canvas.getByText(/Latest token report/)).toBeVisible()
    await expect(canvas.getByText(/No reliable history compression event/)).toBeVisible()
  }
}
