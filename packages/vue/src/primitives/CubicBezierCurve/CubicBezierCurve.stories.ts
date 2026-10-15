import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import KeyboardExample from './examples/Keyboard.vue'

const meta = {
  title: 'Vue SDK/CubicBezierCurve',
  component: KeyboardExample
} satisfies Meta<typeof KeyboardExample>
export default meta

type Story = StoryObj<typeof meta>
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const control = canvas.getByRole('button', { name: 'Control point 1' })
    const parentKeydowns: string[] = []
    const onParentKeydown = (event: KeyboardEvent) => parentKeydowns.push(event.code)
    await userEvent.tab()
    await expect(control).toHaveFocus()
    canvasElement.addEventListener('keydown', onParentKeydown)
    try {
      await userEvent.keyboard('{ArrowRight}{ArrowUp}')
      await expect(canvas.getByRole('status')).toHaveTextContent('0.26, 0.11')
      await expect(parentKeydowns).toEqual([])
      await userEvent.keyboard('a')
      await expect(parentKeydowns).toEqual(['KeyA'])
    } finally {
      canvasElement.removeEventListener('keydown', onParentKeydown)
    }
  }
}
