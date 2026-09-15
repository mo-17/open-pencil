import { businessAssert, businessParameter } from './commands'

/** Shared future, positive-duration window for new viewing or registration slots. */
export function businessFutureSlotWindow() {
  return [
    businessAssert('future_start', businessParameter('startsAt'), { kind: 'server-now' }, 'gte'),
    businessAssert(
      'ordered_times',
      businessParameter('endsAt'),
      businessParameter('startsAt'),
      'gte'
    ),
    businessAssert(
      'nonempty_slot',
      businessParameter('endsAt'),
      businessParameter('startsAt'),
      'neq'
    )
  ]
}
