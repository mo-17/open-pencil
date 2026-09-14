import { describe, expect, test } from 'bun:test'

import { expect as browserExpect } from '@playwright/test'

import { BUSINESS_BROWSER_USER_ID } from './helpers'
import { finishBusinessRequest, submitBusinessAction, withBusinessBrowser } from './session/helpers'

const profileId = '00000000-0000-4000-8000-000000000010'
const colleagueId = '00000000-0000-4000-8000-000000000011'
const projectId = '00000000-0000-4000-8000-000000000020'
const memberId = '00000000-0000-4000-8000-000000000030'
const taskId = '00000000-0000-4000-8000-000000000040'
const recordedAt = '2026-09-14T00:00:00.000Z'
const dueAt = '2030-01-01T17:00:00+08:00'
const canonicalDueAt = '2030-01-01T09:00:00.000000Z'

describe('generated projects browser workflow', () => {
  test.each(['react', 'vue'] as const)(
    '%s creates a project, adds a member and completes an assigned task',
    async (target) => {
      await withBusinessBrowser('project-tasks', target, async ({ page, api, open }) => {
        const profile = { id: profileId, title: 'Alice', active: true, created_at: recordedAt }
        const colleague = { ...profile, id: colleagueId, title: 'Bob' }
        api.resources['my-profile'] = [profile]
        api.resources.users = [colleague]
        const project = {
          id: projectId,
          title: 'Website launch',
          description: 'Release the new website',
          created_at: recordedAt
        }
        const ownerMember = {
          id: '00000000-0000-4000-8000-000000000031',
          project_id: projectId,
          user_id: profileId,
          member_subject: BUSINESS_BROWSER_USER_ID,
          title: 'Alice',
          active: true,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'create-project',
          payload: { userId: profileId, title: project.title, description: project.description },
          result: project,
          resources: { projects: [project], 'project-members': [ownerMember] }
        })
        await open('projects')
        await page.getByRole('button', { name: 'New project', exact: true }).click()
        await page.getByRole('button', { name: 'Choose · Registered account', exact: true }).click()
        await page.getByPlaceholder('Project title', { exact: true }).fill(project.title)
        await page
          .getByPlaceholder('Project description', { exact: true })
          .fill(project.description)
        await submitBusinessAction(page, 'New project')
        await browserExpect(
          page.getByText('Project: Website launch', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)

        const member = {
          ...ownerMember,
          id: memberId,
          user_id: colleagueId,
          member_subject: '00000000-0000-4000-8000-000000000002',
          title: 'Bob'
        }
        api.steps.push({
          commandId: 'add-project-member',
          payload: { projectId, userId: colleagueId },
          result: member,
          resources: { 'project-members': [ownerMember, member] }
        })
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Add project member', exact: true }).click()
        await page.getByRole('button', { name: 'Choose · Registered account', exact: true }).click()
        await submitBusinessAction(page, 'Add project member')
        await browserExpect.poll(() => api.calls.length).toBe(2)
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await browserExpect(page.getByText('Member: Bob', { exact: true })).toBeVisible()

        let task = {
          id: taskId,
          project_id: projectId,
          member_id: memberId,
          title: 'Publish landing page',
          description: 'Review copy and release',
          due_at: canonicalDueAt,
          status: 'todo',
          version: 0,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'create-task',
          payload: {
            projectId,
            memberId,
            title: task.title,
            description: task.description,
            dueAt: canonicalDueAt
          },
          result: task,
          resources: { tasks: [task] }
        })
        await page.getByRole('button', { name: 'Create task', exact: true }).click()
        await page
          .getByRole('button', { name: 'Choose · Project member', exact: true })
          .last()
          .click()
        await page.getByPlaceholder('Task title', { exact: true }).fill(task.title)
        await page.getByPlaceholder('Task description', { exact: true }).fill(task.description)
        await page.getByPlaceholder('Due time (ISO 8601)', { exact: true }).fill(dueAt)
        await submitBusinessAction(page, 'Create task')
        await browserExpect.poll(() => api.calls.length).toBe(3)
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Tasks', exact: true }).click()
        await browserExpect(
          page.getByText('Task: Publish landing page', { exact: true }).first()
        ).toBeVisible()

        for (const [commandId, label, note, status] of [
          ['start-task', 'Start task', 'Copy review started', 'in_progress'],
          ['complete-task', 'Complete task', 'Landing page released', 'done']
        ] as const) {
          task = { ...task, status, version: task.version + 1 }
          api.steps.push({
            commandId,
            payload: { projectId, taskId, note },
            result: task,
            resources: {
              tasks: [task],
              'task-history': [
                {
                  id: '00000000-0000-4000-8000-' + String(50 + task.version).padStart(12, '0'),
                  project_id: projectId,
                  task_id: taskId,
                  action: commandId,
                  note,
                  actor_subject: member.member_subject,
                  created_at: recordedAt
                }
              ]
            }
          })
          await page.getByRole('button', { name: 'Select record', exact: true }).click()
          await page.getByRole('button', { name: label, exact: true }).click()
          await page.getByPlaceholder('Change note', { exact: true }).fill(note)
          await submitBusinessAction(page, label)
          await browserExpect(
            page.getByText('Status: ' + status, { exact: true }).first()
          ).toBeVisible()
          await finishBusinessRequest(page)
        }
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await browserExpect(
          page.getByText('Note: Landing page released', { exact: true })
        ).toBeVisible()
        expect(api.calls).toHaveLength(5)
        expect(new Set(api.calls.map((call) => call.key)).size).toBe(5)
        expect(api.reads).toContain('task-history')
      })
    },
    120_000
  )
})
