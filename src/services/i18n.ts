import path from 'node:path'
import i18next from 'i18next'
import FsBackend, { FsBackendOptions } from 'i18next-fs-backend'

import nsGeneral from './i18n/general/cs-CZ.json' with { type: 'json' };
import nsLessons from './i18n/lessons/cs-CZ.json' with { type: 'json' };
import nsTeachers from './i18n/teachers/cs-CZ.json' with { type: 'json' };


declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'general'
    resources: {
      general: typeof nsGeneral,
      lessons: typeof nsLessons,
      teachers: typeof nsTeachers,
    }
  }
}

export type SupportedLng = (typeof supportedLngs)[number]


export const supportedLngs = ['cs-CZ', 'sk-SK', 'en-US'] as const
const fallbackLng: SupportedLng = 'cs-CZ'

function getDefaultLng() {
  return Intl.DateTimeFormat().resolvedOptions().locale
}

export async function changeLng(lng: SupportedLng) {
  return await i18next.changeLanguage(lng)
}

export function getLng() {
  return i18next.language as SupportedLng
}

export function init() {
  const loadPath = path.join(process.cwd(), '/src/services/i18n/{{ns}}/{{lng}}.json')

  return i18next
    .use(FsBackend)
    .init<FsBackendOptions>({
      lng: getDefaultLng(),
      fallbackLng: fallbackLng,
      ns: ['general', 'lessons', 'teachers'],
      defaultNS: 'general',
      //debug: true,
      backend: { loadPath }
    })
}
