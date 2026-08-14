import {
  DE,
  DE_PROG,
  ES,
  ES_PROG,
  FR,
  FR_PROG,
  IT,
  IT_PROG,
  PL,
  PL_PROG,
  RU,
  RU_PROG
} from './labels'
import { DOCS_BUILD_LOCALES, type DocsLocale } from './locale-constants'
import { localeThemeConfig } from './locale-theme'
import { zhCnThemeConfig } from './zh-cn-theme'

export const docsLocaleRegistry = {
  root: {
    label: 'English',
    lang: 'en'
  },
  de: {
    label: 'Deutsch',
    lang: 'de',
    description: 'Open-Source, KI-nativer Design-Editor. Figma-Alternative.',
    themeConfig: localeThemeConfig(
      '/de',
      {
        overview: 'Überblick',
        userGuide: 'Benutzerhandbuch',
        programmable: 'Automation',
        sdk: 'SDK',
        reference: 'Referenz',
        development: 'Entwicklung',
        openApp: 'App öffnen'
      },
      DE,
      DE_PROG
    )
  },
  it: {
    label: 'Italiano',
    lang: 'it',
    description: 'Editor di design open-source, IA-nativo. Alternativa a Figma.',
    themeConfig: localeThemeConfig(
      '/it',
      {
        overview: 'Panoramica',
        userGuide: 'Guida utente',
        programmable: 'Automation',
        sdk: 'SDK',
        reference: 'Riferimento',
        development: 'Sviluppo',
        openApp: 'Apri app'
      },
      IT,
      IT_PROG
    )
  },
  fr: {
    label: 'Français',
    lang: 'fr',
    description: 'Éditeur de design open-source, IA-natif. Alternative à Figma.',
    themeConfig: localeThemeConfig(
      '/fr',
      {
        overview: 'Vue d’ensemble',
        userGuide: 'Guide utilisateur',
        programmable: 'Automation',
        sdk: 'SDK',
        reference: 'Référence',
        development: 'Développement',
        openApp: "Ouvrir l'app"
      },
      FR,
      FR_PROG
    )
  },
  es: {
    label: 'Español',
    lang: 'es',
    description: 'Editor de diseño open-source, IA-nativo. Alternativa a Figma.',
    themeConfig: localeThemeConfig(
      '/es',
      {
        overview: 'Resumen',
        userGuide: 'Guía del usuario',
        programmable: 'Automation',
        sdk: 'SDK',
        reference: 'Referencia',
        development: 'Desarrollo',
        openApp: 'Abrir app'
      },
      ES,
      ES_PROG
    )
  },
  pl: {
    label: 'Polski',
    lang: 'pl',
    description: "Open-source'owy edytor graficzny z natywnym AI. Alternatywa dla Figmy.",
    themeConfig: localeThemeConfig(
      '/pl',
      {
        overview: 'Przegląd',
        userGuide: 'Podręcznik',
        programmable: 'Automation',
        sdk: 'SDK',
        reference: 'Referencja',
        development: 'Rozwój',
        openApp: 'Otwórz app'
      },
      PL,
      PL_PROG
    )
  },
  ru: {
    label: 'Русский',
    lang: 'ru',
    description: 'Дизайн-редактор с открытым исходным кодом. Альтернатива Figma с встроенным ИИ.',
    themeConfig: localeThemeConfig(
      '/ru',
      {
        overview: 'Обзор',
        userGuide: 'Руководство',
        programmable: 'Automation',
        sdk: 'SDK',
        reference: 'Справочник',
        development: 'Разработка',
        openApp: 'Открыть приложение'
      },
      RU,
      RU_PROG
    )
  },
  'zh-cn': {
    label: '简体中文',
    lang: 'zh-CN',
    description: '开源、AI 原生的设计编辑器。从零构建，兼容 .fig 文件。',
    themeConfig: zhCnThemeConfig()
  }
}

type DocsLocaleConfig = (typeof docsLocaleRegistry)[keyof typeof docsLocaleRegistry]

function localeConfigKey(locale: DocsLocale): keyof typeof docsLocaleRegistry {
  return locale === 'en' ? 'root' : locale
}

export function docsLocalesFor(locales: readonly DocsLocale[]): Record<string, DocsLocaleConfig> {
  return Object.fromEntries(
    locales.map((locale) => {
      const key = localeConfigKey(locale)
      return [key, docsLocaleRegistry[key]]
    })
  )
}

export const docsLocales = docsLocalesFor(DOCS_BUILD_LOCALES)
