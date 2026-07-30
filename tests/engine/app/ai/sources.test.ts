import { describe, expect, test } from 'bun:test'

import {
  archiveAssistantFileMessage,
  collectAssistantFiles,
  collectChatSources,
  MAX_ASSISTANT_FILES,
  MAX_ASSISTANT_INLINE_DATA_URL_CHARS,
  MAX_INLINE_IMAGE_DATA_URL_LENGTH,
  parseAssistantFileArchive,
  presentAssistantFile,
  safeExternalHttpUrl,
  type ChatPresentationLabels
} from '@/app/ai/chat/sources'

const SCRIPT_URL = ['java', 'script:alert(1)'].join('')
const LABELS: ChatPresentationLabels = {
  document: 'Document',
  generatedImage: 'Generated image',
  file: 'File'
}

describe('chat source presentation', () => {
  test('accepts only absolute HTTP(S) URLs without embedded credentials', () => {
    expect(safeExternalHttpUrl(' https://example.com/reference?q=1 ')).toBe(
      'https://example.com/reference?q=1'
    )
    expect(safeExternalHttpUrl('http://example.com')).toBe('http://example.com/')

    for (const value of [
      SCRIPT_URL,
      'data:text/html,<script>alert(1)</script>',
      'file:///tmp/private.txt',
      'ftp://example.com/file',
      '/relative/path',
      'https://user:secret@example.com/private'
    ]) {
      expect(safeExternalHttpUrl(value)).toBeNull()
    }
  })

  test('filters unsafe URLs, de-duplicates sources, and prefers HTTPS', () => {
    const sources = collectChatSources(
      [
        {
          type: 'source-url',
          sourceId: 'http',
          url: 'http://example.net/reference',
          title: 'HTTP reference'
        },
        {
          type: 'source-document',
          sourceId: 'document',
          title: 'Provider document',
          filename: 'brief.pdf',
          mediaType: 'application/pdf'
        },
        {
          type: 'source-url',
          sourceId: 'https',
          url: 'https://example.com/reference',
          title: '  Secure\nreference  '
        },
        {
          type: 'source-url',
          sourceId: 'https',
          url: 'https://example.com/reference',
          title: 'Duplicate'
        },
        {
          type: 'source-url',
          sourceId: 'unsafe',
          url: SCRIPT_URL,
          title: 'Unsafe'
        }
      ],
      LABELS
    )

    expect(sources).toHaveLength(3)
    expect(sources.map((source) => source.kind)).toEqual(['url', 'url', 'document'])
    expect(sources[0]).toMatchObject({
      kind: 'url',
      title: 'Secure reference',
      hostname: 'example.com',
      secure: true
    })
    expect(sources[1]).toMatchObject({ kind: 'url', secure: false })
    expect(sources[2]).toMatchObject({
      kind: 'document',
      title: 'Provider document',
      filename: 'brief.pdf',
      mediaType: 'application/pdf'
    })
  })

  test('uses localized document fallback copy', () => {
    const sources = collectChatSources(
      [
        {
          type: 'source-document',
          sourceId: 'document',
          title: '',
          mediaType: 'application/pdf'
        }
      ],
      { ...LABELS, document: 'Dokument' }
    )

    expect(sources).toEqual([expect.objectContaining({ kind: 'document', title: 'Dokument' })])
  })

  test('bounds source output and supports disabling it', () => {
    const parts = Array.from({ length: 20 }, (_, index) => ({
      type: 'source-url' as const,
      sourceId: `source-${index}`,
      url: `https://example.com/${index}`
    }))

    expect(collectChatSources(parts, LABELS)).toHaveLength(12)
    expect(collectChatSources(parts, LABELS, 2)).toHaveLength(2)
    expect(collectChatSources(parts, LABELS, 0)).toEqual([])
  })
})

describe('assistant file presentation', () => {
  test('keeps hosted HTTP(S) files as explicit links and previews inline raster images', () => {
    expect(
      presentAssistantFile(
        {
          type: 'file',
          filename: 'chart.png',
          mediaType: 'image/png',
          url: 'https://cdn.example.com/chart.png'
        },
        0,
        LABELS
      )
    ).toMatchObject({
      name: 'chart.png',
      mediaType: 'image/png',
      previewUrl: null,
      openUrl: 'https://cdn.example.com/chart.png',
      blocked: false
    })

    expect(
      presentAssistantFile(
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aGVsbG8=' },
        1,
        LABELS
      )
    ).toMatchObject({
      name: 'Generated image 2',
      previewUrl: 'data:image/png;base64,aGVsbG8=',
      openUrl: null,
      blocked: false
    })
  })

  test('uses localized generated image and generic file names', () => {
    const localized = { document: '文档', generatedImage: '生成的图片', file: '文件' }
    expect(
      presentAssistantFile(
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aGVsbG8=' },
        0,
        localized
      ).name
    ).toBe('生成的图片 1')
    expect(
      presentAssistantFile(
        {
          type: 'file',
          mediaType: 'application/pdf',
          url: 'https://files.example.com/report.pdf'
        },
        1,
        localized
      ).name
    ).toBe('文件 2')
  })

  test('never auto-fetches provider-controlled remote images', () => {
    for (const url of [
      'https://cdn.example.com/chart.png',
      'https://[2606:4700:4700::1111]/chart.png',
      'http://cdn.example.com/chart.png',
      'https://localhost/chart.png',
      'https://localhost./chart.png',
      'https://127.0.0.1/chart.png',
      'https://10.0.0.1/chart.png',
      'https://100.64.0.1/chart.png',
      'https://169.254.1.1/chart.png',
      'https://172.16.0.1/chart.png',
      'https://192.168.1.1/chart.png',
      'https://printer.local/chart.png',
      'https://[::1]/chart.png',
      'https://[fc00::1]/chart.png',
      'https://[fe80::1]/chart.png'
    ]) {
      expect(
        presentAssistantFile({ type: 'file', mediaType: 'image/png', url }, 0, LABELS)
      ).toMatchObject({ previewUrl: null, openUrl: safeExternalHttpUrl(url), blocked: false })
    }
  })

  test('rejects oversized inline raster data URLs before preview', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(MAX_INLINE_IMAGE_DATA_URL_LENGTH)}`
    expect(
      presentAssistantFile({ type: 'file', mediaType: 'image/png', url: oversized }, 0, LABELS)
    ).toMatchObject({ previewUrl: null, openUrl: null, blocked: true })
  })

  test('never exposes active or mismatched URLs to rendering or click handlers', () => {
    for (const file of [
      { type: 'file' as const, mediaType: 'text/html', url: 'data:text/html,<script>x</script>' },
      { type: 'file' as const, mediaType: 'image/png', url: 'data:image/jpeg;base64,aGVsbG8=' },
      {
        type: 'file' as const,
        mediaType: 'image/svg+xml',
        url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
      },
      { type: 'file' as const, mediaType: 'text/plain', url: SCRIPT_URL },
      { type: 'file' as const, mediaType: 'application/pdf', url: 'file:///tmp/private.pdf' }
    ]) {
      expect(presentAssistantFile(file, 0, LABELS)).toMatchObject({
        previewUrl: null,
        openUrl: null,
        blocked: true
      })
    }
  })

  test('archives unsafe and over-budget payloads while retaining blocked file cards', () => {
    const oversizedPayload = `data:image/png;base64,${'S'.repeat(MAX_ASSISTANT_INLINE_DATA_URL_CHARS + 1)}`
    const activePayload = 'data:text/html;base64,PHNjcmlwdD5iYWQ8L3NjcmlwdD4='
    const message = {
      id: 'assistant-files',
      role: 'assistant' as const,
      parts: [
        {
          type: 'file' as const,
          filename: 'oversized.png',
          mediaType: 'image/png',
          url: oversizedPayload
        },
        {
          type: 'file' as const,
          filename: 'active.html',
          mediaType: 'text/html',
          url: activePayload
        },
        {
          type: 'file' as const,
          filename: 'safe.pdf',
          mediaType: 'application/pdf',
          url: 'https://files.example.com/safe.pdf'
        }
      ]
    }

    const archived = archiveAssistantFileMessage(message)
    const serialized = JSON.stringify(archived)
    const presentation = collectAssistantFiles(archived.parts, archived.metadata, LABELS)

    expect(serialized).not.toContain(oversizedPayload)
    expect(serialized).not.toContain(activePayload)
    expect(archived.parts.filter((part) => part.type === 'file')).toHaveLength(1)
    expect(presentation).toHaveLength(3)
    expect(presentation.filter((file) => file.blocked)).toHaveLength(2)
    expect(presentation.find((file) => file.name === 'safe.pdf')).toMatchObject({
      openUrl: 'https://files.example.com/safe.pdf',
      blocked: false
    })
  })

  test('bounds actual and archived files by count and aggregate inline characters', () => {
    const message = {
      id: 'assistant-many-files',
      role: 'assistant' as const,
      parts: Array.from({ length: 12 }, (_, index) => ({
        type: 'file' as const,
        filename: `image-${index}.png`,
        mediaType: 'image/png',
        url: `data:image/png;base64,${String(index).repeat(100_000)}`
      }))
    }

    const archived = archiveAssistantFileMessage(message)
    const archive = parseAssistantFileArchive(archived.metadata)
    const retainedFiles = archived.parts.filter((part) => part.type === 'file')
    const presentation = collectAssistantFiles(archived.parts, archived.metadata, LABELS)
    const retainedInlineCharacters = retainedFiles.reduce(
      (total, part) => total + (part.type === 'file' ? part.url.length : 0),
      0
    )

    expect(retainedFiles.length + (archive?.files.length ?? 0)).toBe(MAX_ASSISTANT_FILES)
    expect(presentation).toHaveLength(MAX_ASSISTANT_FILES)
    expect(retainedInlineCharacters).toBeLessThanOrEqual(MAX_ASSISTANT_INLINE_DATA_URL_CHARS)
    expect(JSON.stringify(archived)).not.toContain('11'.repeat(100_000))
  })

  test('rejects malformed archive metadata and removes its untrusted payload', () => {
    const maliciousMetadata = {
      keep: 'safe',
      assistantFileArchive: {
        schema: 'openpencil.assistant-file-archive.v1',
        files: [
          {
            filename: 'x'.repeat(241),
            mediaType: 'image/png',
            reason: 'unsafe',
            url: 'https://attacker.example/payload'
          }
        ]
      }
    }
    const message = {
      id: 'assistant-malicious-archive',
      role: 'assistant' as const,
      metadata: maliciousMetadata,
      parts: [{ type: 'text' as const, text: 'done' }]
    }

    expect(parseAssistantFileArchive(maliciousMetadata)).toBeNull()
    expect(collectAssistantFiles(message.parts, message.metadata, LABELS)).toEqual([])
    const archived = archiveAssistantFileMessage(message)
    expect(archived.metadata).toEqual({ keep: 'safe' })
    expect(JSON.stringify(archived)).not.toContain('attacker.example')
  })
})
