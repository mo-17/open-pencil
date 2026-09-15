import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandValueIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { publishingRevision } from './steps'
import {
  CATALOG_FIELDS,
  MODEL_FIELDS,
  type PublishingEntities,
  type PublishingProfile
} from './types'

const parameters = (model: boolean): BackendCommandParameterIR[] => [
  businessStringParameter('title', 100),
  businessStringParameter('description', 1000),
  ...(model
    ? [businessStringParameter('segment', 100), businessStringParameter('energyType', 100)]
    : []),
  { name: 'active', type: 'boolean', required: true }
]
const values = (model: boolean): BackendCommandValueIR[] => [
  ...['title', 'description', 'active'].map((field) => ({
    field,
    value: businessParameter(field)
  })),
  ...(model
    ? [
        { field: 'segment', value: businessParameter('segment') },
        { field: 'energy_type', value: businessParameter('energyType') }
      ]
    : [])
]

function catalogCommands(
  profile: PublishingProfile,
  entity: DataEntityIR,
  kind: 'category' | 'brand' | 'model',
  brands?: DataEntityIR
): BackendCommandDefinitionIR[] {
  const fields = kind === 'model' ? MODEL_FIELDS : CATALOG_FIELDS
  const inputs = () => parameters(kind === 'model')
  const content = () => values(kind === 'model')
  const title = () =>
    businessAssert('nonempty_title', businessParameter('title'), businessLiteral(''), 'neq')
  const role: BackendCommandDefinitionIR['access'] = { kind: 'role', roleId: profile.authorRole }
  return [
    businessCommand(
      `create-${profile.prefix}-${kind}`,
      `Create ${profile.prefix} ${kind}`,
      role,
      [...(brands ? [businessUUIDParameter('brandId')] : []), ...inputs()],
      [
        title(),
        ...(brands
          ? [
              businessRead(brands, 'brand', businessParameter('brandId'), CATALOG_FIELDS),
              businessAssert(
                'active_brand',
                businessResult('brand', 'active'),
                businessLiteral(true)
              )
            ]
          : []),
        businessInsert(
          entity,
          'catalog',
          [
            { field: 'owner_id', value: businessCaller() },
            ...content(),
            ...(brands
              ? [
                  { field: 'brand_id', value: businessResult('brand', 'id') },
                  { field: 'brand_title', value: businessResult('brand', 'title') }
                ]
              : [])
          ],
          fields
        )
      ],
      { resultName: 'catalog', fields: [...fields] }
    ),
    businessCommand(
      `update-${profile.prefix}-${kind}`,
      `Update ${profile.prefix} ${kind}`,
      role,
      [businessUUIDParameter(`${kind}Id`), ...inputs()],
      [
        businessRead(entity, 'catalog', businessParameter(`${kind}Id`), fields),
        title(),
        businessUpdate(
          entity,
          'catalog',
          'updated',
          [...content(), publishingRevision('catalog')],
          fields
        )
      ],
      { resultName: 'updated', fields: [...fields] }
    )
  ]
}

export function publishingCatalogCommands(
  profile: PublishingProfile,
  entities: PublishingEntities
): BackendCommandDefinitionIR[] {
  return [
    ...catalogCommands(profile, entities.categories, 'category'),
    ...(entities.automotive
      ? [
          ...catalogCommands(profile, entities.automotive.brands, 'brand'),
          ...catalogCommands(
            profile,
            entities.automotive.models,
            'model',
            entities.automotive.brands
          )
        ]
      : [])
  ]
}
