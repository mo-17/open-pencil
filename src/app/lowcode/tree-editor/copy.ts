export function treeEditorCopy(locale: string, cascader = false) {
  const copy = locale.startsWith('zh')
    ? {
        hint: '最多 128 个节点、6 层。多选不级联；禁用父节点会禁用其子树。初始值仅用于本地组件，不绑定表单。删除父节点会将其子节点提升一级。',
        id: '标识符',
        label: '节点名称',
        parent: '父节点',
        root: '根层级',
        disabled: '禁用',
        selected: '初始选中',
        expanded: '初始展开',
        add: '添加根节点',
        child: '添加子节点',
        remove: '删除节点',
        apply: '应用树配置',
        restore: '还原',
        newItem: '新节点',
        invalid: '配置无效：检查重复或无效标识符、父级循环、超过 6 层，以及单选模式的初始值。'
      }
    : {
        hint: 'Up to 128 items and 6 levels. Selection is independent, not cascading. Disabled parents disable their subtree. Initial values are local, not form bindings. Removing a parent moves its children up one level.',
        id: 'Identifier',
        label: 'Node label',
        parent: 'Parent',
        root: 'Root level',
        disabled: 'Disabled',
        selected: 'Initially selected',
        expanded: 'Initially expanded',
        add: 'Add root item',
        child: 'Add child item',
        remove: 'Remove item',
        apply: 'Apply tree configuration',
        restore: 'Restore',
        newItem: 'New item',
        invalid:
          'Invalid configuration: check duplicate or invalid IDs, parent cycles, the 6-level limit, and initial single selection.'
      }
  if (!cascader) return copy
  return {
    ...copy,
    hint: locale.startsWith('zh')
      ? '最多 128 项、6 层；仅叶节点可设为初始选中。禁用父项会禁用其子树；删除父项会提升子项并重建初始路径。绑定状态优先于初始路径。'
      : 'Up to 128 items and 6 levels; only leaves can be initially selected. Disabled parents disable their subtree. Removing a parent promotes children and rebuilds the initial path. Bound state takes priority over the initial path.',
    apply: locale.startsWith('zh') ? '应用级联配置' : 'Apply cascader configuration'
  }
}
