import type { BackendArtifactSource } from '#compiler/backend/contracts'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSBusinessModuleImports } from '../modules/model'
import { runtimeArtifact } from './artifact'
import { emitNestJSPreviewContract } from './preview-contract'

const ENVIRONMENT_SOURCE = String.raw`export function requiredEnvironment(name: string, maximum = 2048): string {
  const value = process.env[name]
  if (!value || value.length > maximum || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Backend runtime configuration is invalid.')
  }
  return value
}
`

const FILTER_SOURCE = String.raw`import { Catch, HttpException } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'

const MESSAGES: Readonly<Record<number, string>> = {
  400: 'Invalid request.',
  401: 'Authentication required.',
  403: 'Access denied.',
  404: 'Resource not found.',
  409: 'Request conflict.',
  413: 'Request too large.',
  415: 'Unsupported request content type.',
  429: 'Request limit reached.',
  503: 'Service unavailable.',
}

@Catch()
export class RuntimeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    let status = exception instanceof HttpException ? exception.getStatus() : 500
    if (exception && typeof exception === 'object' && 'status' in exception &&
        (exception.status === 400 || exception.status === 413 || exception.status === 415)) {
      status = exception.status
    }
    const response = host.switchToHttp().getResponse<Response>()
    response.status(status).json({ statusCode: status, message: MESSAGES[status] ?? 'Request failed.' })
  }
}
`

const BOOTSTRAP_SOURCE = String.raw`import 'reflect-metadata'
import { UnsupportedMediaTypeException, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'
import { AppModule } from './app.module.js'
import { configurePreviewContract } from './preview-contract.js'

export function configureApplication(app: NestExpressApplication): void {
  app.disable('x-powered-by')
  configurePreviewContract(app)
  app.use((request: Request, _response: Response, next: NextFunction) => {
    const type = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (type === 'application/x-www-form-urlencoded' ||
        (['POST', 'PUT', 'PATCH'].includes(request.method) && type !== 'application/json')) {
      next(new UnsupportedMediaTypeException('JSON content is required.'))
      return
    }
    next()
  })
  app.useBodyParser('json', { limit: '64kb', strict: true, inflate: false, type: 'application/json' })
  app.useGlobalPipes(new ValidationPipe({
    transform: false,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    disableErrorMessages: true,
  }))
}

export async function createApplication(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  })
  configureApplication(app)
  app.enableShutdownHooks()
  return app
}
`

const MAIN_SOURCE = String.raw`import 'reflect-metadata'
import { createApplication } from './bootstrap.js'

async function bootstrap(): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1'
  const rawPort = process.env.PORT ?? '3000'
  if (!/^[A-Za-z0-9.:-]+$/.test(host) || !/^[0-9]{1,5}$/.test(rawPort)) {
    throw new Error('Backend runtime configuration is invalid.')
  }
  const port = Number(rawPort)
  if (port < 1 || port > 65535) throw new Error('Backend runtime configuration is invalid.')
  const app = await createApplication()
  try {
    await app.listen(port, host)
  } catch {
    await app.close()
    throw new Error('Backend startup failed.')
  }
}

bootstrap().catch(() => {
  console.error('Backend startup failed.')
  process.exitCode = 1
})
`

function moduleSource(application: BackendApplicationSpecV1): string {
  const resources = application.httpApi?.resources
  if (!resources) throw new TypeError('NestJS runtime requires an HTTP API declaration.')
  const imports = resources.map(
    (resource, index) =>
      `import { Resource${index}Module } from './resources/${resource.id}.module.js'`
  )
  const modules = resources.map((_, index) => `Resource${index}Module`)
  if (application.modules) {
    const business = nestJSBusinessModuleImports(application)
    imports.splice(0, imports.length, ...business.imports)
    modules.splice(0, modules.length, ...business.modules)
  } else if (application.commands?.commands.length) {
    imports.push("import { CommandModule } from './command.module.js'")
    modules.push('CommandModule')
  }
  return `import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { AuthModule } from './auth.module.js'
import { DatabaseModule } from './database.module.js'
import { RuntimeExceptionFilter } from './errors.filter.js'
${imports.join('\n')}

@Module({
  imports: [DatabaseModule, AuthModule, ${modules.join(', ')}],
  providers: [{ provide: APP_FILTER, useClass: RuntimeExceptionFilter }],
})
export class AppModule {}
`
}

export function emitApplicationArtifacts(
  application: BackendApplicationSpecV1,
  previewSupported = true
): BackendArtifactSource[] {
  return [
    emitNestJSPreviewContract(application, previewSupported),
    runtimeArtifact('environment.ts', ENVIRONMENT_SOURCE),
    runtimeArtifact('errors.filter.ts', FILTER_SOURCE),
    runtimeArtifact('app.module.ts', moduleSource(application)),
    runtimeArtifact('bootstrap.ts', BOOTSTRAP_SOURCE),
    runtimeArtifact('main.ts', MAIN_SOURCE)
  ]
}
