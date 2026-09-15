import * as v from 'valibot'

import { toolNumber } from './input'
import type { ParamDef } from './schema'

/** Convert the retained fork declaration format once; every transport uses this same schema. */
export function legacyToolInput(params: Record<string, ParamDef>) {
  return v.object(legacyEntries(params))
}

function legacyEntries(params: Record<string, ParamDef>): v.ObjectEntries {
  return Object.fromEntries(
    Object.entries(params).map(([name, param]) => [name, legacyParameter(param)])
  )
}

function parameterValue(param: ParamDef): v.GenericSchema {
  switch (param.type) {
    case 'string':
      return param.enum ? v.picklist(param.enum) : v.string()
    case 'color':
      return v.string()
    case 'boolean':
      return v.boolean()
    case 'number':
      return toolNumber(
        v.pipe(
          v.number(),
          v.minValue(param.min ?? -Number.MAX_VALUE),
          v.maxValue(param.max ?? Number.MAX_VALUE)
        )
      )
    case 'string[]':
      return v.pipe(v.array(v.string()), v.minLength(1))
    case 'object': {
      if (!param.properties) return v.record(v.string(), v.unknown())
      const entries = legacyEntries(param.properties)
      return param.additionalProperties
        ? v.objectWithRest(entries, v.unknown())
        : v.strictObject(entries)
    }
    case 'array':
      return v.pipe(
        v.array(
          param.items
            ? legacyParameter({ ...param.items, required: true, default: undefined })
            : v.unknown()
        ),
        v.minLength(param.minItems ?? 0),
        v.maxLength(param.maxItems ?? Number.MAX_SAFE_INTEGER)
      )
  }
  throw new Error('Unknown legacy tool parameter type')
}

function legacyParameter(param: ParamDef): v.GenericSchema {
  const schema = v.pipe(parameterValue(param), v.description(param.description))
  return param.required ? schema : v.optional(schema, param.default)
}
