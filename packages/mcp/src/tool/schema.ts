import { z } from 'zod'

import type { ParamDef, ParamType } from '@open-pencil/core/tools'

function requiredParam(param: ParamDef): ParamDef {
  return { ...param, required: true, default: undefined }
}

function objectSchema(param: ParamDef): z.ZodType {
  if (!param.properties) return z.record(z.string(), z.json())

  const shape: Record<string, z.ZodType> = {}
  for (const [key, property] of Object.entries(param.properties)) {
    shape[key] = paramToZod(property)
  }
  return param.additionalProperties ? z.looseObject(shape) : z.strictObject(shape)
}

function arraySchema(param: ParamDef): z.ZodType {
  let schema = z.array(param.items ? paramToZod(requiredParam(param.items)) : z.json())
  if (param.minItems !== undefined) schema = schema.min(param.minItems)
  if (param.maxItems !== undefined) schema = schema.max(param.maxItems)
  return schema
}

export function paramToZod(param: ParamDef): z.ZodType {
  const typeMap: Record<ParamType, () => z.ZodType> = {
    string: () =>
      param.enum
        ? z.enum(param.enum as [string, ...string[]]).describe(param.description)
        : z.string().describe(param.description),
    number: () => {
      let schema = z.coerce.number()
      if (param.min !== undefined) schema = schema.min(param.min)
      if (param.max !== undefined) schema = schema.max(param.max)
      return schema.describe(param.description)
    },
    boolean: () => z.boolean().describe(param.description),
    color: () => z.string().describe(param.description),
    'string[]': () => z.array(z.string()).min(1).describe(param.description),
    object: () => objectSchema(param).describe(param.description),
    array: () => arraySchema(param).describe(param.description)
  }

  const schema = typeMap[param.type]()
  return param.required ? schema : schema.optional()
}
