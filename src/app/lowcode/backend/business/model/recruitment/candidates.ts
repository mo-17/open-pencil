import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { HR_CANDIDATE_FIELDS, HR_INTERVIEW_FIELDS, type RecruitmentEntities } from './fields'
import {
  hrCandidateReferences,
  hrHistory,
  hrIncrement,
  hrOpenPosition,
  hrPositionAccess,
  hrReadCandidate,
  hrReadPosition,
  hrRequired,
  hrState,
  hrVersion,
  hrVersionParameter
} from './steps'

const candidateParameters = () => [
  businessStringParameter('title', 100),
  businessStringParameter('contact', 200),
  businessStringParameter('experience', 4000)
]
const candidateValues = () =>
  ['title', 'contact', 'experience'].map((field) => ({ field, value: businessParameter(field) }))
export const hrCandidateKeys = () => [
  businessUUIDParameter('positionId'),
  businessUUIDParameter('candidateId'),
  hrVersionParameter()
]
export const hrCandidateRead = (entities: RecruitmentEntities) => [
  hrReadPosition(entities),
  ...hrReadCandidate(entities),
  hrVersion('candidate')
]

export function recruitmentCandidateCommands(entities: RecruitmentEntities) {
  return [
    businessCommand(
      'create-hr-candidate',
      'Add a candidate to my open position',
      hrPositionAccess(entities),
      [businessUUIDParameter('positionId'), ...candidateParameters()],
      [
        hrReadPosition(entities),
        hrOpenPosition(),
        hrRequired('title'),
        hrRequired('contact'),
        businessInsert(
          entities.candidates,
          'candidate',
          [
            { field: 'owner_id', value: businessResult('position', 'owner_id') },
            { field: 'position_id', value: businessResult('position', 'id') },
            ...candidateValues()
          ],
          HR_CANDIDATE_FIELDS
        ),
        hrHistory(entities, 'candidate', 'candidate', 'create-candidate', true)
      ],
      { resultName: 'candidate', fields: HR_CANDIDATE_FIELDS }
    ),
    businessCommand(
      'update-hr-candidate',
      'Edit an application before an offer',
      hrPositionAccess(entities),
      [...hrCandidateKeys(), ...candidateParameters(), businessStringParameter('note', 500)],
      [
        ...hrCandidateRead(entities),
        hrState('candidate', 'applied'),
        hrRequired('title'),
        hrRequired('contact'),
        businessUpdate(
          entities.candidates,
          'candidate',
          'updated',
          [...candidateValues(), hrIncrement('candidate')],
          HR_CANDIDATE_FIELDS
        ),
        hrHistory(entities, 'candidate', 'candidate', 'update-candidate')
      ],
      { resultName: 'updated', fields: HR_CANDIDATE_FIELDS }
    ),
    interviewCommand(entities),
    ...candidateDecisionCommands(entities)
  ]
}

function interviewCommand(entities: RecruitmentEntities) {
  return businessCommand(
    'record-hr-interview',
    'Record HR feedback without automatically making an offer',
    hrPositionAccess(entities),
    [
      ...hrCandidateKeys(),
      { name: 'score', type: 'integer', required: true, min: 1, max: 5 },
      businessStringParameter('feedback', 2000),
      businessStringParameter('note', 500)
    ],
    [
      ...hrCandidateRead(entities),
      hrState('candidate', 'applied'),
      hrRequired('feedback'),
      businessInsert(
        entities.interviews,
        'interview',
        [
          ...hrCandidateReferences(),
          { field: 'candidate_version', value: businessResult('candidate', 'version') },
          { field: 'actor_subject', value: businessCaller() },
          { field: 'score', value: businessParameter('score') },
          { field: 'feedback', value: businessParameter('feedback') }
        ],
        HR_INTERVIEW_FIELDS
      ),
      businessUpdate(
        entities.candidates,
        'candidate',
        'updated',
        [hrIncrement('candidate', 'interview_count'), hrIncrement('candidate')],
        HR_CANDIDATE_FIELDS
      ),
      hrHistory(entities, 'candidate', 'candidate', 'record-interview', false, 'interview')
    ],
    { resultName: 'updated', fields: HR_CANDIDATE_FIELDS }
  )
}

function candidateDecisionCommands(entities: RecruitmentEntities) {
  return (['offer', 'reject'] as const).map((decision) => {
    const status = decision === 'offer' ? 'offered' : 'rejected'
    const checks =
      decision === 'offer'
        ? [
            hrOpenPosition(),
            hrState('candidate', 'applied'),
            businessAssert(
              'interview_recorded',
              businessResult('candidate', 'interview_count'),
              businessLiteral(1),
              'gte'
            )
          ]
        : ['hired', 'rejected'].map((value) =>
            businessAssert(
              `not_${value}`,
              businessResult('candidate', 'status'),
              businessLiteral(value),
              'neq'
            )
          )
    return businessCommand(
      `${decision}-hr-candidate`,
      `${decision === 'offer' ? 'Record an explicit offer for' : 'Reject or withdraw the offer for'} this candidate`,
      hrPositionAccess(entities),
      [...hrCandidateKeys(), businessStringParameter('note', 500)],
      [
        ...hrCandidateRead(entities),
        ...checks,
        hrRequired('note'),
        businessUpdate(
          entities.candidates,
          'candidate',
          'updated',
          [{ field: 'status', value: businessLiteral(status) }, hrIncrement('candidate')],
          HR_CANDIDATE_FIELDS
        ),
        hrHistory(entities, 'candidate', 'candidate', `${decision}-candidate`)
      ],
      { resultName: 'updated', fields: HR_CANDIDATE_FIELDS }
    )
  })
}
