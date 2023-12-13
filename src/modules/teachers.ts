import * as cheerio from 'cheerio'
import { t } from 'i18next'
import similarity from 'similarity'
import chalk from 'chalk'

import { WithRequired, KeysMatching, ReadonlyNonEmptyArray, HtmlParser } from '../utils/types.js'
import {
  Named, getName, sortNamed, date2sql, average, ucFirst, isDev, delay, chunks,
  info, normalizeWhitespace, isObjectWithKeys, isObjectsWithKeys, isValidNumber
} from '../utils/utils.js'
import { IzusTable, IzusTableConstructorOptions, SortDir } from '../utils/ui.js'
import { IzusApi } from '../cmds.js'


type ClassStudent = Named & {
  id: number
}
type Record = {
  date: Date
  record: string
}
type Class = {
  id: number
  student: ClassStudent
  subject: string
  records?: Record[]
}
type FilledClass = WithRequired<Class, 'records'>

export type Teacher<C extends Class = Class> = Named & {
  i: number
  id: number
  classes?: C[]
  stats?: {
    similarity: number
    length: number
    similarityPercentil?: number
    lengthPercentil?: number
    avgPercentil?: number
  }
}
type FilledTeacher = WithRequired<Teacher<FilledClass>, 'classes'>
type TeacherWithStats = WithRequired<Teacher, 'stats'>
type Stats = Exclude<Teacher['stats'], undefined>
type Stat = keyof Stats


let teachers: Teacher[] | undefined

const config = {
  statsMaxTeachers: isDev ? 6 : undefined,
  statsMaxClasses: isDev ? 5 : undefined,
  statsDelay: 5, // sekundy
  statsChunk: 20
}

export function clearCaches() {
  teachers = undefined
}

export async function getTeachers(izusApi: IzusApi) {
  if (teachers) return teachers
  teachers = await getTeachersFromHTML(izusApi)
  return teachers
}

const htmlParsers = {

  parseTeachers(htmlZamestnanci: string) {
    const $ = cheerio.load(htmlZamestnanci)
    let teachers = $('table#tabulka_zamestnancu tbody tr').map((i, el) => {
      let lastName = $(el).find('td.prijmeni').text()
      let firstName = $(el).find('td.prijmeni + td').text()
      let id = $(el).find('td.prijmeni input[name="zamestnanci[]"]').val() as string

      return {
        i,
        id: parseInt(id),
        firstName,
        lastName
      } as Teacher
    }).toArray().sort(sortNamed)
    return teachers
  },

  parseClasses(htmlDokumentyZamestnance: string) {
    const $ = cheerio.load(htmlDokumentyZamestnance)
    let sliceEnd = config.statsMaxClasses ?? undefined
    let classes = $('select#zobrazit_tridni_knihu option:not([value=""])').slice(0, sliceEnd).map((i, el) => {
      let val = <string>$(el).val()
      let text = $(el).text()
      let [studentId, classId] = val.split('_', 2)
      let res = text.match(/([a-zá-ž ]+) \(([a-zá-ž0-9 ]+)\)/i)
      if (!res) return
      let [, studentName, subject] = res
      let [lastName, firstName] = studentName.split(' ', 2)

      return {
        id: parseInt(classId),
        student: { id: parseInt(studentId), firstName, lastName },
        subject
      } as Class
    })
    return classes.toArray()
  },

  parseRecords(htmlTridniKniha: string) {
    const $ = cheerio.load(htmlTridniKniha)
    let records = $('table.latka:first tbody tr:not(.nevyplneno)')
      .filter((i, el) => {
        let attendance = $(el).find('td.dochazka').text()
        return attendance === 'I'
      })
      .map((i, el) => {
        let dateStr = $(el).find('td.datum').text().replace(/\s/g, ' ')
        let dateSql = date2sql(dateStr)
        let record = $(el).find('td.probirana_latka').text().trim()
        record = normalizeWhitespace(record)
        return {
          date: new Date(dateSql),
          record
        } as Record
      })
    return records.toArray()
  }

} satisfies { [key: string]: HtmlParser }

async function getTeachersFromHTML(izusApi: IzusApi): Promise<Teacher[]> {
  let html = (await izusApi.web.zamestnanci()).data
  return htmlParsers.parseTeachers(html)
}

async function getClassesFromHTML(izusApi: IzusApi, teacher: Teacher): Promise<Class[]> {
  let html = (await izusApi.web.dokumentyZamestnance(teacher.id)).data
  return htmlParsers.parseClasses(html)
}

async function getClassRecordsFromHTML(izusApi: IzusApi, cls: Class): Promise<Record[]> {
  let html = (await izusApi.web.tridniKniha(cls.student.id, cls.id)).data
  return htmlParsers.parseRecords(html)
}

function getRecordsSimilarity(records: readonly Record[]) {
  let similarities = []
  if (records.length <= 1) return NaN
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const res = similarity(records[i].record, records[j].record)
      similarities.push(res)
    }
  }
  return average(similarities)
}

function getRecordsLength(records: readonly Record[]) {
  if (records.length <= 0) return NaN
  return average(records.map(record => record.record.length))
}

function getSubitemsAvg<T, K extends KeysMatching<T, unknown[]>>(
  items: T[],
  prop: K,
  avgCb: (subitems: T[K]) => number
) {
  let subAvgs = items.map(item => avgCb(item[prop]))
  return average(subAvgs)
}

export async function addClassesToTeacher(izusApi: IzusApi, teacher: Teacher): Promise<FilledTeacher> {
  const classes = await getClassesFromHTML(izusApi, teacher)
  const promises = classes.map(cls => getClassRecordsFromHTML(izusApi, cls))
  const records = await Promise.all(promises)
  classes.forEach((cls, i) => cls.records = records[i])
  teacher.classes = classes
  return <FilledTeacher>teacher
}

export async function getTeacherStats(izusApi: IzusApi, teacher: FilledTeacher): Promise<Stats> {
  let stats = { similarity: NaN, length: NaN }
  if (teacher.classes.length > 0) {
    stats.similarity = getSubitemsAvg(teacher.classes, 'records', getRecordsSimilarity)
    stats.length = getSubitemsAvg(teacher.classes, 'records', getRecordsLength)
  }
  return stats
}

function getSortByStat<K extends Stat>(statName: K) {
  return ({ stats: stats1 }: TeacherWithStats, { stats: stats2 }: TeacherWithStats) => {
    let stat1 = stats1?.[statName]
    let stat2 = stats2?.[statName]

    if (isValidNumber(stat1) && isValidNumber(stat2)) {
      if (stat1 === stat2) return 0
      return stat1 > stat2 ? 1 : -1
    }
    if (!isValidNumber(stat1) && !isValidNumber(stat2)) return 0
    if (!isValidNumber(stat1)) return -1
    return 1
  }
}

export function isTeachersWithStats(teacher: Teacher): teacher is TeacherWithStats
export function isTeachersWithStats(teachers: ReadonlyNonEmptyArray<Teacher>): teachers is ReadonlyNonEmptyArray<TeacherWithStats>
export function isTeachersWithStats(teacherOrTeachers: Teacher | ReadonlyNonEmptyArray<Teacher>) {
  const keys = ['stats'] as const
  if (Array.isArray(teacherOrTeachers))
    return isObjectsWithKeys<Teacher, TeacherWithStats, typeof keys>(teacherOrTeachers as ReadonlyNonEmptyArray<Teacher>, keys)
  else return isObjectWithKeys<Teacher, TeacherWithStats, typeof keys>(teacherOrTeachers as Teacher, keys)
}

export async function addStatsToTeachers(izusApi: IzusApi, teachers: readonly Teacher[]): Promise<TeacherWithStats[]> {
  if (config.statsMaxTeachers) teachers = teachers.slice(0, config.statsMaxTeachers)

  let teachersFinal: TeacherWithStats[] = []
  //console.log(...chunks(teachers, config.statsChunk)); process.exit()
  for (let teachersChunk of chunks(teachers, config.statsChunk)) {
    const promises = teachersChunk.map(async teacher => {
      const filledTeacher = await addClassesToTeacher(izusApi, teacher)
      const stats = getTeacherStats(izusApi, filledTeacher)
      stats.then(stats => !isNaN(stats.similarity) && info(t('teachers:similarityInfo', {
        teacherName: chalk.bold(getName(filledTeacher)),
        similarity: stats?.similarity * 100
      })))
      return stats
    })
    const stats = await Promise.all(promises)
    teachersChunk.forEach((teacher, i) => teacher.stats = stats[i])
    teachersFinal = [...teachersFinal, ...teachersChunk as TeacherWithStats[]]
    await delay(config.statsDelay * 1000)
  }
  addPercentilsToTeachers(teachersFinal)
  return teachersFinal.sort(getSortByStat('avgPercentil')).reverse()
}

function addPercentilsToTeachers(teachers: readonly TeacherWithStats[]) {
  addPercentilToTeachers(teachers, 'similarity', 'similarityPercentil')
  addPercentilToTeachers(teachers, 'length', 'lengthPercentil', true),
  teachers.forEach(teacher => {
    if (isValidNumber(teacher.stats.similarityPercentil) && isValidNumber(teacher.stats.lengthPercentil))
      teacher.stats.avgPercentil = (teacher.stats.similarityPercentil + teacher.stats.lengthPercentil) / 2
  })
}

function addPercentilToTeachers(teachers: readonly TeacherWithStats[], statSrc: Stat, statDest: Stat, reverse = false) {
  const teachers1 = [...teachers].filter(teacher => isValidNumber(teacher.stats[statSrc]))
  if (teachers1.length <= 1) return    // percentil z množiny jednoho nelze spočítat
  teachers1.sort(getSortByStat(statSrc))
  if (reverse) teachers1.reverse()
  teachers.forEach(teacher => {
    const i = teachers1.findIndex(teacher1 => teacher1.id === teacher.id)
    if (i !== -1) teacher.stats[statDest] = i / (teachers1.length - 1)
  })
}

export function formatTeachersWithStats(teachers: readonly TeacherWithStats[]) {
  return formatTeachers(teachers, true)
}

export function formatTeachers(teachers: readonly Teacher[], withStats = false) {
  let options: WithRequired<IzusTableConstructorOptions, 'head' | 'colAligns'> = {
    head: [`${ucFirst(t('common.teachers_one'))}`],
    colAligns: ['left'],
    noColumn: true,
  }
  if (withStats) {
    options.head.push(
      t('teachers:teachersTable.similarity'),
      t('teachers:teachersTable.percentil'),
      t('teachers:teachersTable.length'),
      t('teachers:teachersTable.percentil'),
      t('teachers:teachersTable.avgPercentil'),
    )
    options.colAligns.push('right', 'right', 'right', 'right', 'right')
  }

  let table = new IzusTable(options)
  let rows = teachers.map(teacher => {
    let row = [getName(teacher)]
    if (withStats) row.push(
      IzusTable.percentFormat(teacher.stats?.similarity),
      IzusTable.percentFormat(teacher.stats?.similarityPercentil),
      IzusTable.numberFormat(teacher.stats?.length),
      IzusTable.percentFormat(teacher.stats?.lengthPercentil),
      IzusTable.percentFormat(teacher.stats?.avgPercentil),
    )
    return row
  })
  withStats ? table.setSortHead(6, SortDir.Down) : table.setSortHead(1)
  table.push(...rows)
  return table.toString()
}
