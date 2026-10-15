import type { ComarkPlugin, MarkdownDocument, MarkdownElement } from 'vue-stream-markdown'

type MarkdownNode = MarkdownDocument['nodes'][number]

function isElement(node: MarkdownNode | undefined): node is MarkdownElement {
  return node !== undefined && typeof node !== 'string' && node[0] !== null
}

function labelTaskItem(item: MarkdownElement) {
  const classes = item[1].class
  if (typeof classes !== 'string' || !classes.split(/\s+/).includes('task-list-item')) return

  const first = item[2]
  const paragraph = isElement(first) && first[0] === 'p' ? first : item
  const checkbox = paragraph[2]
  if (!isElement(checkbox) || checkbox[0] !== 'input' || checkbox[1].type !== 'checkbox') {
    return
  }

  const [, , ...children] = paragraph
  const nestedList = children.findIndex(
    (child) => isElement(child) && (child[0] === 'ul' || child[0] === 'ol')
  )
  const inline = nestedList === -1 ? children : children.slice(0, nestedList)
  // A nested list belongs to its own tasks, never to the parent's accessible name.
  paragraph.splice(2, inline.length, ['label', {}, ...inline])
}

function labelTasks(nodes: MarkdownNode[]) {
  for (const node of nodes) {
    if (!isElement(node)) continue
    if (node[0] === 'li') labelTaskItem(node)
    const [, , ...children] = node
    labelTasks(children)
  }
}

export const markdownTaskLabels: ComarkPlugin = {
  name: 'task-labels',
  post({ tree }) {
    labelTasks(tree.nodes)
  }
}
