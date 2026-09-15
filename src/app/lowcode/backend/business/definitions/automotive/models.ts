import {
  businessText as t,
  type BusinessInput,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import {
  publishingActive,
  publishingArticleColumns,
  publishingCatalogInputs
} from '../publishing/fields'
import { formAction, selectedParameter, textInput } from '../shared'

export const automotiveModelColumns = [
  { field: 'title', label: t('Model', '车型') },
  { field: 'brand_title', label: t('Brand', '品牌') },
  { field: 'segment', label: t('Segment', '级别') },
  { field: 'energy_type', label: t('Energy type', '能源类型') }
]
const details = [
  ...automotiveModelColumns,
  { field: 'description', label: t('Description', '说明'), multiline: true }
]

function modelInputs(edit = false): BusinessInput[] {
  return [
    ...publishingCatalogInputs(edit),
    {
      ...textInput('segment', 'Segment', '级别', 100),
      required: false,
      ...(edit ? { fromSelection: 'segment' } : {})
    },
    {
      ...textInput('energyType', 'Energy type', '能源类型', 100),
      required: false,
      ...(edit ? { fromSelection: 'energy_type' } : {})
    }
  ]
}

export function automotiveModelsPage(): BusinessPageDefinition {
  return {
    id: 'auto-models',
    path: '/automotive/models',
    title: t('Vehicle models', '车型目录'),
    public: true,
    description: t(
      'Browse the manually maintained model directory and its published news. These descriptions are editorial metadata, not a live specification, availability or price feed.',
      '浏览人工维护的车型目录及已发布资讯。车型说明属于编辑资料，不是实时配置、在售状态或报价数据。'
    ),
    listing: { resourceId: 'auto-models', columns: automotiveModelColumns, search: true },
    details,
    related: [
      {
        resourceId: 'auto-articles',
        foreignKey: 'model_id',
        title: t('Published model news', '车型已发布资讯'),
        columns: publishingArticleColumns
      }
    ],
    actions: []
  }
}

export function automotiveModelManagementPage(): BusinessPageDefinition {
  return {
    id: 'auto-management-models',
    path: '/automotive/editor/models',
    title: t('Manage vehicle models', '车型管理'),
    description: t(
      'auto-editor maintains models under an active brand. A model keeps its original brand. Existing articles keep their saved labels; publication rechecks current model and brand availability.',
      'auto-editor 在启用品牌下维护车型。车型所属品牌创建后不可更换。已有文章保留保存时的名称；发布时会重新检查车型及品牌是否启用。'
    ),
    listing: {
      resourceId: 'auto-management-models',
      columns: [...automotiveModelColumns, { field: 'active', label: t('Active', '启用') }],
      search: true,
      filter: { field: 'active', choices: publishingActive }
    },
    details: [...details, { field: 'active', label: t('Active', '启用') }],
    actions: [
      formAction({
        id: 'create-auto-model',
        en: 'Create vehicle model',
        zh: '新增车型',
        inputs: [
          {
            key: 'brandId',
            label: t('Active brand', '启用的品牌'),
            kind: 'relation',
            relation: { resourceId: 'auto-brands', labelField: 'title' }
          },
          ...modelInputs()
        ]
      }),
      formAction({
        id: 'update-auto-model',
        en: 'Edit vehicle model',
        zh: '编辑车型',
        inputs: modelInputs(true),
        parameters: { modelId: selectedParameter() }
      })
    ]
  }
}
