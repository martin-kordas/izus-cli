import { Paths, Get } from 'type-fest'
import chalk from 'chalk';
import { t } from 'i18next'

import * as izusApi from './apis/izus.js'
import * as googleApi from './apis/google.js'
import * as auth from './services/auth.js'
import { ParametersSafe, Tail, Logger } from './utils/types.js'
import { InputError, countSettledPromises, getDescendantProp, getName, info, isValidNumber, noop, userError } from './utils/utils.js'
import { SupportedLng, changeLng as doChangeLng } from './services/i18n.js'
import {
  openLesson as doOpenLesson,
  getStudents as doGetStudents,
  getPendingLessons,
  getLessonsWithImage as doGetLessonsWithImage,
  isOpenableLesson,
  initRefresh as initLessonsRefresh,
  clearCaches as clearLessonsCaches
} from './modules/lessons.js'
import {
  getTeachers as doGetTeachers,
  getTeacherStats as doGetTeacherStats,
  addStatsToTeachers,
  addClassesToTeacher,
  clearCaches as clearTeachersCaches
} from './modules/teachers.js'


export type IzusApi = typeof izusApi

type Cmds = typeof cmds
type CmdFunction = (logger: Logger, ...args: any[]) => CmdResult | Promise<CmdResult>
type Cmd = CmdFunction | {
  run: CmdFunction
  next?: Cmd
}
type CmdPaths<T, AllPaths extends string> = keyof {
  [Path in AllPaths as Get<T, Path> extends Cmd ? Path : never]: Get<T, Path>
}
export type CmdName = CmdPaths<Cmds, Paths<Cmds>>

type CmdResult = {
  result: boolean
  data?: object
}
type ExtractCmdFunction<T extends Cmd> = T extends { run: any } ? T['run'] : T
type GetCmdFunction<Cmd extends CmdName> = ExtractCmdFunction<Get<Cmds, Cmd>>
type CmdParams<Cmd extends CmdName> = Tail<ParametersSafe<GetCmdFunction<Cmd>>>
type CmdReturn<Cmd extends CmdName> = ReturnType<GetCmdFunction<Cmd>>


const stdLogger = { info, error: userError }
const silentLogger = { info: noop, error: noop }

async function runCmdWithLogger<CmdObject extends Cmd>(
  cmd: CmdObject,
  logger: Logger,
  ...args: Tail<ParametersSafe<ExtractCmdFunction<CmdObject>>>
): Promise<ReturnType<ExtractCmdFunction<CmdObject>>>
async function runCmdWithLogger<Cmd extends CmdName>(
  cmd: Cmd,
  logger: Logger,
  ...args: CmdParams<Cmd>
): Promise<CmdReturn<Cmd>>
async function runCmdWithLogger(
  cmdOrCmdName: Cmd | CmdName,
  logger: Logger = stdLogger,
  ...args: any[]
): Promise<any> {
  let cmd
  if (typeof cmdOrCmdName === 'string') cmd = getCmd(cmdOrCmdName)
  else cmd = wrapCmd(cmdOrCmdName)
  let res = await (cmd.run)(logger, ...args)
  if (cmd.next) return await runCmdWithLogger(cmd.next, logger, res.data)
  return res
}

export async function runCmd<Cmd extends CmdName>(
  cmdName: Cmd,
  ...args: CmdParams<Cmd>
): Promise<CmdReturn<Cmd>> {
  return await runCmdWithLogger(cmdName, stdLogger, ...args)
}

// TODO: pøi volání nìkterých pøíkazù (napø. 'auth.changeLogin') nefunguje type hint pro návratový typ odpovídající zadanému cmdName
export function runCmdSilently<Cmd extends CmdName>(
  cmdName: Cmd,
  ...args: CmdParams<Cmd>
): Promise<CmdReturn<Cmd>> {
  return runCmdWithLogger(cmdName, silentLogger, ...args)
}

function wrapCmd(cmd: Cmd) {
  if ('run' in cmd) return cmd
  else return { run: cmd }
}

function getCmd<Cmd extends CmdName>(cmdName: Cmd) {
  let cmd = getDescendantProp(cmds, cmdName)
  return wrapCmd(cmd)
}

function doInIzusApi<T extends izusApi.IzusApiCallback>(cb: T): Promise<ReturnType<T>> {
  return izusApi.doInIzusApi(auth.getCredentialsManager(), cb)
}

function clearCaches() {
  clearLessonsCaches(), clearTeachersCaches()
}

//let res = runCmd('auth.changeLogin', { username: 'user', password: 'pasw' })
//let res2 = runCmdSilently('auth.changeLogin', { username: 'user', password: 'pasw' })


const init = async function (_logger: Logger) {
  await doInIzusApi(async () => {
    runCmd('auth.checkLogin')
  }).finally(() => {
    // i v pøípadì, že se pøihlášení nezdaøilo, musíme zavést refresh timer
    initLessonsRefresh(izusApi)
  })
  return { result: true }
} satisfies Cmd

const checkLogin = async function (logger: Logger) {
  let data = await doInIzusApi(async () => {
    await auth.getCredentialsManager().checkCredentials(izusApi)
    const whoami = await auth.getCredentialsManager().getWhoami(izusApi)
    logger.info(t('cmds.checkLogin.success', {
      username: chalk.bold(whoami.userName),
      role: whoami.roleName,
      school: auth.getSchoolName(whoami.school),
    }))
    return whoami
  })
  return { result: true, data }
} satisfies Cmd

const changeLogin: Cmd = async function (logger: Logger, { username, password }: auth.Credentials) {
  if (izusApi.isLoggedIn()) await izusApi.logout()
  auth.getCredentialsManager().set({ username, password })
  clearCaches()
  let res = await runCmd('auth.checkLogin')
  // bez pøetypování vzniká chyba 'circularly references itself'
  let result = <CmdResult['result']>res.result
  let data = <CmdResult['data']>res.data
  return { result, data }
} satisfies Cmd

const deleteLogin = {
  run(logger: Logger) {
    auth.getCredentialsManager().forget()
    clearCaches()
    logger.info(t('cmds.deleteLogin.success'))
    return { result: true }
  },
  // changeLogin se musí volat na úrovni CLI, protože potøebuje uživatelský vstup
  //next: changeLogin
} satisfies Cmd

const changeLng = async function (logger: Logger, lng: SupportedLng) {
  await doChangeLng(lng)
  return { result: true }
} satisfies Cmd

const createFolders = async function (logger: Logger) {
  let settledPromises = await doInIzusApi(async () => {
    let students = await doGetStudents(izusApi)
    if (!students.length) {
      logger.error(new Error(t('cmds.createFolders.noStudents')))
      return []
    }
    else {
      let folderNames = students.map(student => getName(student))
      return await googleApi.createFolders(folderNames, logger)
    }
  })

  const { fulfilledCount, rejectedCount } = countSettledPromises(settledPromises)
  logger.info(t('cmds.createFolders.success', { foldersCount: fulfilledCount }))
  if (rejectedCount) {
    const error = new Error(t('cmds.createFolders.error', { foldersCount: rejectedCount }))
    logger.error(error)
  }

  return { result: true, data: { settledPromises, fulfilledCount, rejectedCount } }
} satisfies Cmd

const getStudents = async function (_logger: Logger) {
  let data = await doInIzusApi(async () => {
    return await doGetStudents(izusApi)
  })
  return { result: true, data }
} satisfies Cmd

const getLessons = async function (logger: Logger, withImage: boolean = false) {
  let lessons = await doInIzusApi(async () => {
    return await getPendingLessons(izusApi)
  })
  if (withImage) lessons = doGetLessonsWithImage(lessons!)
  return { result: true, data: lessons }
} satisfies Cmd

const getLessonsWithImage = async function (_logger: Logger) {
  let res: CmdResult = await runCmdSilently('lessons.getLessons', true)
  return res
} satisfies Cmd

const openLesson = async function (logger: Logger, i: number) {
  await doInIzusApi(async () => {
    let lessons = await getPendingLessons(izusApi)
    let lesson = lessons[i]
    if (lesson === undefined || !isOpenableLesson(lesson)) throw new InputError(t('cmds.openLesson.inputError'))
    return doOpenLesson(izusApi, lesson)
  })
  return { result: true }
} satisfies Cmd

const getTeacherSimilarity = async function (logger: Logger, i: number) {
  let stats = await doInIzusApi(async () => {
    let teachers = await doGetTeachers(izusApi)
    let teacher = teachers[i]
    if (teacher === undefined) throw new InputError(t('cmds.getTeacherSimilarity.inputError'))
    const teacherWithStats = await addClassesToTeacher(izusApi, teacher)
    return doGetTeacherStats(izusApi, teacherWithStats)
  })
  if (!isValidNumber(stats.similarity)) userError(new Error(t('cmds.getTeacherSimilarity.error')))
  else {
    // @ts-ignore
    let infoArr: string[] = [t('cmds.getTeacherSimilarity.success.0', { similarity: stats.similarity * 100 })]
    // @ts-ignore
    if (isValidNumber(stats.length)) infoArr.push(t('cmds.getTeacherSimilarity.success.1', { length: stats.length }))
    info(infoArr)
  }
  return { result: true, data: { stats } }
} satisfies Cmd

const getTeachersWithSimilarity = async function (_logger: Logger) {
  let teachersWithStats = await doInIzusApi(async () => {
    let teachers = await doGetTeachers(izusApi)
    return addStatsToTeachers(izusApi, teachers)
  })
  return { result: true, data: teachersWithStats }
} satisfies Cmd

const getTeachers = async function (_logger: Logger) {
  let data = await doInIzusApi(async () => {
    return await doGetTeachers(izusApi)
  })
  return { result: true, data }
} satisfies Cmd


const cmds = {
  auth: {
    checkLogin,
    changeLogin,
    deleteLogin,
  },
  misc: {
    changeLng,
    init,
  },
  lessons: {
    createFolders,
    getStudents,
    getLessons,
    getLessonsWithImage,
    openLesson,
  },
  teachers: {
    getTeacherSimilarity,
    getTeachersWithSimilarity,
    getTeachers
  }
}

export default cmds
