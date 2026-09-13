import { nestJSArtifact } from './artifact'
import type { NestJSResource } from './model'
import { nestJSQuerySpec } from './query'

function resourceMethods(model: NestJSResource, index: number): string {
  const result: string[] = []
  const { resource } = model
  const publicRead = model.authorization.select.public ? '  @PublicRead()\n' : ''
  if (resource.operations.includes('list'))
    result.push(`${publicRead}  @Get()
  list(@Req() request: AuthenticatedRequest) {
    noBody(request.body)
    return this.service.list(requestPrincipal(request), listQuery(request.query, ${resource.maxPageSize}, ${JSON.stringify(nestJSQuerySpec(model))}))
  }`)
  if (resource.operations.includes('read'))
    result.push(`${publicRead}  @Get(':id')
  read(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    noBody(request.body)
    noQuery(request.query)
    return this.service.read(requestPrincipal(request), itemId(id))
  }`)
  if (resource.operations.includes('create'))
    result.push(`  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: Resource${index}CreateDTO) {
    noQuery(request.query)
    bodyFields(request.body, ${JSON.stringify(resource.createFields)})
    return this.service.create(requestPrincipal(request), body)
  }`)
  if (resource.operations.includes('update'))
    result.push(`  @Patch(':id')
  update(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: Resource${index}UpdateDTO) {
    noQuery(request.query)
    bodyFields(request.body, ${JSON.stringify(resource.updateFields)})
    return this.service.update(requestPrincipal(request), itemId(id), body)
  }`)
  if (resource.operations.includes('delete'))
    result.push(`  @Delete(':id')
  delete(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    noBody(request.body)
    noQuery(request.query)
    return this.service.delete(requestPrincipal(request), itemId(id))
  }`)
  return result.join('\n\n')
}

export function emitNestJSController(model: NestJSResource, index: number) {
  const base = model.resource.id
  const dtos = [
    ...(model.resource.operations.includes('create') ? ['Resource' + index + 'CreateDTO'] : []),
    ...(model.resource.operations.includes('update') ? ['Resource' + index + 'UpdateDTO'] : [])
  ]
  const controller = `import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common'
import { Resource${index}Service } from ${JSON.stringify('./' + base + '.service.js')}
import { PublicRead, requestPrincipal, type AuthenticatedRequest } from '../identity.js'
import { bodyFields, noBody, noQuery, itemId, listQuery } from '../request-validation.js'
${dtos.length ? 'import { ' + dtos.join(', ') + ' } from ' + JSON.stringify('./' + base + '.dto.js') : ''}

@Controller(${JSON.stringify(model.resource.path.slice(1))})
export class Resource${index}Controller {
  constructor(private readonly service: Resource${index}Service) {}

${resourceMethods(model, index)}
}
`
  const module = `import { Module } from '@nestjs/common'
import { Resource${index}Controller } from ${JSON.stringify('./' + base + '.controller.js')}
import { Resource${index}Service } from ${JSON.stringify('./' + base + '.service.js')}

@Module({ controllers: [Resource${index}Controller], providers: [Resource${index}Service] })
export class Resource${index}Module {}
`
  return [
    nestJSArtifact('src/resources/' + base + '.controller.ts', controller),
    nestJSArtifact('src/resources/' + base + '.module.ts', module)
  ]
}
