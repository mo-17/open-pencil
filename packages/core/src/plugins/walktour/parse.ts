import { compact } from 'es-toolkit'

import * as values from '@open-pencil/plugin-contracts/adapter-helpers'

import {
  parseBoundedModuleObjectArray,
  parseExactModuleConfig
} from '#core/plugins/module-contract'

import {
  WALKTOUR_MODULE_LIMITS as LIMITS,
  type WalktourStep,
  type WalktourModuleConfigV1
} from './types'

const STEP_KEYS = new Set(['id', 'title', 'content', 'targetChildName', 'placement'])
const PLACEMENTS = new Set(['top', 'right', 'bottom', 'left'] as const)
export function parseWalktourSteps(value: unknown): WalktourStep[] {
  if (
    Array.isArray(value) &&
    Reflect.ownKeys(value).some(
      (key) =>
        key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
    )
  )
    throw new TypeError('walktour steps must not contain custom or symbol properties')
  const steps = parseBoundedModuleObjectArray(
    value,
    1,
    LIMITS.steps,
    'walktour needs 1–12 steps',
    () => 'walktour steps must be plain data objects',
    (source) => {
      if (!values.hasExactPluginKeys(source, STEP_KEYS))
        throw new TypeError('walktour step has unknown or missing fields')
      const id = values.parseBoundedPluginText(source.id, 'walktour step id', 1, LIMITS.id)
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id))
        throw new TypeError(
          'walktour step IDs must start with a letter and contain only letters, numbers, _ or -'
        )
      const title = values.parseBoundedPluginText(
        source.title,
        'walktour step title',
        1,
        LIMITS.title
      )
      if (!title.trim()) throw new TypeError('walktour steps need readable titles')
      const targetChildName = values.parseBoundedPluginText(
        source.targetChildName,
        'walktour target child name',
        0,
        LIMITS.targetChildName
      )
      if (targetChildName && !targetChildName.trim())
        throw new TypeError('walktour target must be a readable layer name or empty for overview')
      return {
        id,
        title,
        targetChildName,
        content: values.parseBoundedPluginText(
          source.content,
          'walktour step content',
          0,
          LIMITS.content
        ),
        placement: values.parsePluginStringEnum(
          source.placement,
          'walktour placement',
          PLACEMENTS,
          'top, right, bottom, or left'
        )
      }
    }
  )
  if (new Set(steps.map((step) => step.id)).size !== steps.length)
    throw new TypeError('walktour step IDs must be unique')
  const targets = compact(steps.map((step) => step.targetChildName))
  if (new Set(targets).size !== targets.length)
    throw new TypeError('walktour target child names must be unique')
  return steps
}
export function parseWalktourConfig(value: unknown, keys: ReadonlySet<string>) {
  return parseExactModuleConfig(
    value,
    keys,
    'walktour config must contain exactly its declared fields',
    (source) => {
      const text = values.parseBoundedPluginText(
        source.triggerLabel,
        'walktour trigger label',
        1,
        120
      )
      if (!text.trim()) throw new TypeError('walktour needs a readable trigger label')
      const color = (key: string) =>
        values.parseCanonicalPluginColor(source[key], 'walktour ' + key)
      const boolean = (key: string) => values.parsePluginBoolean(source[key], 'walktour ' + key)
      const config: WalktourModuleConfigV1 = {
        triggerLabel: text,
        steps: parseWalktourSteps(source.steps),
        disabled: boolean('disabled'),
        showProgress: boolean('showProgress'),
        showSkip: boolean('showSkip'),
        panelWidth: values.parseBoundedPluginInteger(
          source.panelWidth,
          'walktour panel width',
          160,
          600
        ),
        overlayOpacity: values.parseBoundedPluginNumber(
          source.overlayOpacity,
          'walktour overlay opacity',
          0,
          0.8
        ),
        triggerBackground: color('triggerBackground'),
        triggerTextColor: color('triggerTextColor'),
        panelBackground: color('panelBackground'),
        textColor: color('textColor'),
        accentColor: color('accentColor'),
        borderColor: color('borderColor'),
        fontSize: values.parseBoundedPluginInteger(source.fontSize, 'walktour font size', 10, 24),
        borderRadius: values.parseBoundedPluginInteger(
          source.borderRadius,
          'walktour border radius',
          0,
          24
        )
      }
      values.assertBoundedPluginConfigBytes(config, 'walktour config', LIMITS.configBytes)
      return config
    }
  )
}
