import { expect, test } from 'bun:test'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createCRMApplication } from '@/app/lowcode/backend/business/model/crm/application'

import { modelFiles } from '../model-capabilities/helpers'
import { publicationApplication, publicationAuthentication } from './helpers'

function text(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get('backend/nestjs/' + path)
  if (typeof value !== 'string') throw new Error('Missing publication artifact: ' + path)
  return value
}

for (const kind of ['blog', 'automotive'] as const) {
  test(kind + ' emits locked publication commands and identifier-only bookmarks', () => {
    const application = publicationApplication(kind)
    const prefix = kind === 'blog' ? 'blog' : 'auto'
    const files = modelFiles(application)
    const service = text(files, 'src/command.service.ts')
    const authority = "if (plan.access.kind === 'row-policy')"
    expect(service).toContain(authority)
    expect(service).toContain('const inserted =')
    expect(service.indexOf(authority)).toBeLessThan(service.indexOf('const inserted ='))
    const schema = text(files, 'migrations/001-initial.sql')
    expect(schema).toContain('UNIQUE ("owner_id", "article_id")')
    expect(schema).toContain('FOREIGN KEY ("article_id", "owner_id")')
    const api = JSON.parse(text(files, 'openapi.json'))
    const create = api.paths['/commands/create-' + prefix + '-article'].post
    const input = create.requestBody.content['application/json'].schema
    expect(input.additionalProperties).toBe(false)
    for (const field of ['owner_id', 'status', 'published_at'])
      expect(input.properties[field]).toBeUndefined()
    const bookmark = api.paths['/commands/create-' + prefix + '-bookmark'].post
    const output = bookmark.responses['200'].content['application/json'].schema.properties
    expect(Object.keys(output).sort()).toEqual([
      'active',
      'article_id',
      'created_at',
      'id',
      'version'
    ])
    const publicArticles = application.httpApi?.resources.find(
      (resource) => resource.id === prefix + '-articles'
    )
    expect(publicArticles?.query?.filterFields).toContain('id')
  })
}

test('blog, automotive and explicitly adopted CRM pass provider budgets and keep command ownership separate', () => {
  const application = composeBusinessModules(
    createCRMApplication('publication-composition', publicationAuthentication()),
    ['personal-blog', 'automotive-news'],
    { adoptExisting: ['customer-crm'] }
  ).application
  expect(application.dataModel.entities).toHaveLength(13)
  const files = modelFiles(application)
  for (const module of ['shared-accounts', 'customer-crm', 'personal-blog', 'automotive-news'])
    expect(files.has('backend/nestjs/src/modules/' + module + '/commands.service.ts')).toBe(true)
  const blog = text(files, 'src/modules/personal-blog/command-plans.ts')
  const automotive = text(files, 'src/modules/automotive-news/command-plans.ts')
  expect(blog).toContain('publish-blog-article')
  expect(blog).not.toContain('publish-auto-article')
  expect(automotive).toContain('publish-auto-article')
  expect(automotive).not.toContain('publish-blog-article')
  expect(text(files, 'src/command-execution.ts')).toContain(' FOR UPDATE')
})
