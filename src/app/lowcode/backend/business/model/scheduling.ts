import { businessAssert, businessParameter, businessResult } from './commands'
import { businessField } from './entities'

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

export function businessSlotFields() {
  return [
    businessField('title', 'string'),
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('capacity', 'integer'),
    businessField('reserved', 'integer', 0),
    businessField('active', 'boolean', true)
  ]
}

export function businessReservationFields() {
  return [
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('quantity', 'integer'),
    businessField('attendee_name', 'string'),
    businessField('contact', 'string'),
    businessField('note', 'string')
  ]
}

export function businessSlotParameterValues() {
  return [
    { field: 'title', value: businessParameter('title') },
    { field: 'starts_at', value: businessParameter('startsAt') },
    { field: 'ends_at', value: businessParameter('endsAt') },
    { field: 'capacity', value: businessParameter('capacity') }
  ]
}

export function businessReservationParameterValues() {
  return [
    { field: 'starts_at', value: businessResult('slot', 'starts_at') },
    { field: 'ends_at', value: businessResult('slot', 'ends_at') },
    { field: 'quantity', value: businessParameter('quantity') },
    { field: 'attendee_name', value: businessParameter('attendeeName') },
    { field: 'contact', value: businessParameter('contact') },
    { field: 'note', value: businessParameter('note') }
  ]
}
