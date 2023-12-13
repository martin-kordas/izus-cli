import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import * as cheerio from 'cheerio'
import { drive_v3 } from 'googleapis'
import { t } from 'i18next'
import open from 'open'
import clipboard from 'clipboardy'
import * as auth from '../services/auth.js'

import * as googleApi from '../apis/google.js'
import { HtmlParser, WithRequired } from '../utils/types.js'
import { Named, getName, createNamed, sortNamed, date2sql, getEnv, info, ucFirst, handleError, UserError, isDev, isString } from '../utils/utils.js'
import { IzusTable } from '../utils/ui.js'
import doOCR from '../services/ocr.js'
import { IzusApi } from '../cmds.js'


export type Student = Named & {
  folderId?: string
  images?: drive_v3.Schema$File[]
}

export type Lesson = {
  i: number
  date: Date
  student: Student
  link: string
  image?: Student['images'] extends Array<infer T> | undefined ? T : never
}
type OpenableLesson = WithRequired<Lesson, 'image'>


const config = {
  refreshInterval: 10,   // sekundy
  logRefresh: false,
  // aby při testování souhlasilo datum výuky s datem nahraného obrázku, přepíšeme datum výuky na dnešek
  lessonDate: isDev ? new Date : undefined
}

let changedLesson: Lesson | undefined
let pendingLessonsPrevious: Lesson[] | undefined
let pendingLessons: Lesson[] | undefined
let pendingLessonsPromise: Promise<Lesson[]> | undefined

export function clearCaches() {
  changedLesson = pendingLessonsPrevious = pendingLessons = pendingLessonsPromise = undefined
}

export async function getPendingLessons(izusApi: IzusApi, forceRefresh = false) {
  if (!pendingLessons || forceRefresh) {
    if (!pendingLessonsPromise) pendingLessonsPromise = getPendingLessonsFromHTML(izusApi)
    pendingLessons = await pendingLessonsPromise
    pendingLessonsPromise = undefined
    const lessonsStudents = pendingLessons.map(lesson => lesson.student)
    await addImagesToStudents(lessonsStudents)
    addImagesToLessons(pendingLessons)
    if (pendingLessonsPrevious && !changedLesson) changedLesson = getChangedLesson(pendingLessons, pendingLessonsPrevious)
    pendingLessonsPrevious = pendingLessons
  }
  return pendingLessons
}

export function isLessonChanged() {
  if (changedLesson) {
    changedLesson = undefined
    return true
  }
  return false
}

function getChangedLesson(lessons1: readonly Lesson[], lessons2: readonly Lesson[]) {
  const lessons = getLessonsWithImage(lessons1)
  for (const lesson of lessons) {
    const lesson2 = lessons2.find(
      lesson2 => lesson2.date.getTime() === lesson.date.getTime() && getName(lesson2.student) === getName(lesson.student)
    )
    if (!lesson2 || !lesson2.image) return lesson
  }
}

export function initRefresh(izusApi: IzusApi) {
  const ms = config.refreshInterval * 1000
  return setTimeout(async () => {
    try {
      // initRefresh() se volá i v případě, že izusApi není přihlášené
      //  - getPendingLessons() dotazuje jen index, který je dostupný i pro nepřihlášené a nevzniká AxiosError
      //  - nepřihlášeného uživatele tedy musíme detekovat ručně
      if (!izusApi.isLoggedIn())
        throw new UserError(t('common.unloggedError'))

      await getPendingLessons(izusApi, true)
      if (config.logRefresh) info(t('lessons:refreshSuccess'))
    }
    catch (err) {
      if (config.logRefresh) {
        let userErr = new UserError(t('lessons:refreshError'), err)
        handleError(userErr)
      }
    }
    finally {
      // i při chybě opakujeme refresh
      initRefresh(izusApi)
    }
  }, ms)
}

const htmlParsers = {

  parseStudents(htmlZaci: string) {
    const $ = cheerio.load(htmlZaci)
    const students = $('#zarazeni_zaci > table > tbody > tr').map((i, el) => {
      let arr = $(el).find('td.prijmeni, td.prijmeni + td')
        .map((i, el) => $(el).text())
        .toArray()
      return { firstName: arr[1], lastName: arr[0] } as Student
    }).toArray().sort(sortNamed)
    return students
  },

  parsePendingLessons(htmlIndex: string) {
    const $ = cheerio.load(htmlIndex)
    let lessons = $('table.tridni_kniha:first tr:not(:first-of-type)').map((i, el) => {
      let dateStr = $(el).find('td.datum_vyuky').text().replace(/\s/g, ' ')
      let dateSql = date2sql(config.lessonDate ?? dateStr)
      if (dateSql) {
        let date = new Date(dateSql)
        let wholeName = $(el).find('td.prijmeni').text()
        wholeName = wholeName.replace(/\(.+\)/, '').trim()  // odstranit studijní zaměření
        let student = createNamed(wholeName)
        let link = $(el).find('td.zapsat button').attr('href')
        return { i, date, student, link } as Lesson
      }
    })
    return lessons.toArray()
  }

} satisfies { [key: string]: HtmlParser }

export async function getStudents(izusApi: IzusApi) {
  const html = (await izusApi.web.zaci()).data
  return htmlParsers.parseStudents(html)
}

async function getPendingLessonsFromHTML(izusApi: IzusApi): Promise<Lesson[]> {
  let html = (await izusApi.web.index()).data
  return htmlParsers.parsePendingLessons(html)
}

async function addImagesToStudents(students: readonly Student[]) {
  let studentFolders = await googleApi.listFiles(process.env.GOOGLE_FOLDER_ID)
  for (let student of students) {
    let wholeName = getName(student)
    let folder = studentFolders.find(folder => folder.name === wholeName)
    if (folder && typeof folder.id === 'string') {
      student.folderId = folder.id
      student.images = await googleApi.listFiles(student.folderId)
    }
  }
}

function addImagesToLessons(lessons: readonly Lesson[]) {
  lessons.map(lesson => {
    let images = lesson.student.images
    if (images) {
      let image = images.find(image => {
        if (image.createdTime) {
          let created = new Date(image.createdTime)
          created.setHours(0, 0, 0, 0)
          created = new Date(created.getTime() + 3600 * 1000)  // HACK: kvůli posunu času
          return created.getTime() === lesson.date.getTime()
        }
      })
      if (image) lesson.image = image
    }
  })
}

export function isOpenableLesson(lesson: Lesson): lesson is OpenableLesson {
  return 'image' in lesson
}

export function getLessonsWithImage(lessons: readonly Lesson[]) {
  return lessons.filter(isOpenableLesson)
}

export function formatLessons(lessons: readonly Lesson[]) {
  // nelze použít noColumn, uživatel v příkazu openLesson zadává lesson.i
  let table = new IzusTable({
    head: [
      t('common.no'),
      `${t('lessons:lessonsTable.lessonDate')}`,
      ucFirst(t('common.students_one')),
      t('lessons:lessonsTable.notebook')
    ],
    colAligns: ['right', 'left', 'left', 'center'],
  })
  let rows = lessons.map(lesson => [
    lesson.i + 1,
    lesson.date.toLocaleDateString(),
    getName(lesson.student),
    lesson.image ? 'Ano' : 'Ne'
  ])
  table.push(...rows)
  table.setSortHead(1)
  return table.toString()
}

export function formatStudents(students: Student[]) {
  return students.map(student => getName(student)).join('\n')
}

export async function openLesson(izusApi: IzusApi, lesson: OpenableLesson) {
  let url = new URL(lesson.link, getEnv('BASE_URL'))
  open(url.toString())

  if (!isString(lesson.image.id) || !isString(lesson.image.name)) throw new Error
  let data = (await googleApi.getFile(lesson.image.id))
  let fileName = path.join(process.cwd(), 'images', lesson.image.name)
  await fs.writeFile(fileName, Buffer.from(data));
  open(fileName)

  auth.getVersion(izusApi)
    .then(version => doOCR(fileName, version))
    .then(text => clipboard.write(text))
    .then(() => info(t('lessons:openLesson.clipboardSuccess')))
  info(t('lessons:openLesson.clipboardProcessing'))
}
