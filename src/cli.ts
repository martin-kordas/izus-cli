import { select, input, password, confirm, Separator } from '@inquirer/prompts';
import { t } from 'i18next'
import localeCode from 'locale-code'
import chalk from 'chalk'

import { info, keypress, isNonEmptyArray, rerunOnError, InputError, UserError, handleError } from './utils/utils.js'
import { AnyFunction } from './utils/types.js'
import { runCmd, runCmdSilently, CmdName } from './cmds.js'
import * as auth from './services/auth.js'
import { getLng, SupportedLng, supportedLngs } from './services/i18n.js'
import { Lesson, Student, formatLessons, formatStudents, isLessonChanged } from './modules/lessons.js'
import { formatTeachers, formatTeachersWithStats, isTeachersWithStats, Teacher } from './modules/teachers.js'


type SuperCmdTopic = 'exit' | 'main' | 'main/auth' | 'main/lessons' | 'main/teachers'
type SuperCmdName = `super.${SuperCmdTopic}`
type CliCmdName = CmdName | SuperCmdName


const cmdsHistory: CmdName[] = []
const showLessonsCmds: CmdName[] = ['lessons.getLessons', 'lessons.getLessonsWithImage']
const showTeachersCmds: CmdName[] = ['teachers.getTeachers']


export async function runCli() {
  info(t('cli.greet'))
  runCmd('misc.init').catch(handleError)
  return processSuperCmd('super.main')
}

async function processSuperCmd(superCmd: SuperCmdName = 'super.main') {
  let cmdName: CliCmdName
  const selectMsg = `${t('cli.chooseAction')}:`

  switch (superCmd) {
    case 'super.main': {
      const tLessonOptions = isLessonChanged() ? { context: 'newImage' } : undefined
      cmdName = await select<CliCmdName>({
        message: `${t('cli.main.chooseModule')}:`,
        choices: [
          { name: t('cli.main.lessons.name', tLessonOptions), value: 'super.main/lessons' },
          { name: t('cli.main.teachers.name', tLessonOptions), value: 'super.main/teachers' },
          new Separator(),
          { name: t('cli.main.auth.name'), value: 'super.main/auth' },
          { name: t('cli.main.changeLng.name'), value: 'misc.changeLng' },
          new Separator(),
          { name: t('cli.main.exit.name'), value: 'super.exit' },
        ]
      })
      break
    }

    case 'super.main/auth':
      cmdName = await select<CliCmdName>({
        message: selectMsg,
        choices: [
          { name: t('cli.auth.changeLogin.name'), value: 'auth.changeLogin' },
          { name: t('cli.auth.deleteLogin.name'), value: 'auth.deleteLogin' },
          { name: t('cli.auth.checkLogin.name'), value: 'auth.checkLogin' },
          new Separator(),
          { name: t('cli.return'), value: 'super.main' },
        ]
      })
      break
    
    case 'super.main/lessons': {
      const tLessonOptions = isLessonChanged() ? { context: 'newImage' } : undefined
      cmdName = await select<CliCmdName>({
        message: selectMsg,
        choices: [
          {
            name: t('cli.lessons.getLessons.name', tLessonOptions),
            value: 'lessons.getLessons',
            description: t('cli.lessons.getLessons.description')
          }, {
            name: t('cli.lessons.getLessonsWithImage.name'),
            value: 'lessons.getLessonsWithImage',
            description: t('cli.lessons.getLessonsWithImage.description')
          }, {
            name: t('cli.lessons.openLesson.name'),
            value: 'lessons.openLesson',
            description: t('cli.lessons.openLesson.description')
          },
          new Separator(),
          {
            name: t('cli.lessons.getStudents.name'),
            value: 'lessons.getStudents',
            description: t('cli.lessons.getStudents.description')
          }, {
            name: t('cli.lessons.createFolders.name'),
            value: 'lessons.createFolders',
            description: t('cli.lessons.createFolders.description')
          },
          new Separator(),
          { name: t('cli.return'), value: 'super.main' },
        ]
      })
      break
    }

    case 'super.main/teachers': {
      cmdName = await select<CliCmdName>({
        message: selectMsg,
        choices: [
          {
            name: t('cli.teachers.getTeacherSimilarity.name'),
            value: 'teachers.getTeacherSimilarity',
            description: t('cli.teachers.getTeacherSimilarity.description')
          }, {
            name: t('cli.teachers.getTeachersWithSimilarity.name'),
            value: 'teachers.getTeachersWithSimilarity',
            description: t('cli.teachers.getTeachersWithSimilarity.description')
          }, {
            name: t('cli.teachers.getTeachers.name'),
            value: 'teachers.getTeachers',
            description: t('cli.teachers.getTeachers.description')
          },
          new Separator(),
          { name: t('cli.return'), value: 'super.main' },
        ]
      })
      break
    }

    case 'super.exit':
      info(t('cli.goodbye'))
      process.exit()
      return

    default:
      throw new UserError(t('cli.unknownCommand'))
  }

  if (isSuper(cmdName)) return processSuperCmd(cmdName)
  try {
    await processCmd(cmdName)
  }
  catch (err) {
    handleError(err)
  }
  // po vykonání pøíkazu cmdName zobrazíme znovu stejnou nabídku superCmd
  return processSuperCmd(superCmd)
}

async function processCmd(cmdName: CmdName) {
  cmdsHistory.push(cmdName)
  
  switch (cmdName) {
    case 'auth.deleteLogin': {
      await runCmd(cmdName)
      info(t('cmds.deleteLogin.newLoginNeeded'))
      await processCmd('auth.changeLogin')
      break
    }

    case 'auth.changeLogin': {
      const loginHistory = auth.getCredentialsManager().history
      if (!loginHistory.isEmpty()) {
        info(`${t('cmds.changeLogin.loginHistory')}:\n${loginHistory.getFormatted()}`)
      }

      const credentials: Partial<auth.Credentials> = {}
      credentials.username = await input({
        message: `${t('cmds.changeLogin.usernamePrompt')}:`,
        validate: (username: string) => {
          if (!/^[._a-z0-9-]{4,50}$/i.test(username)) return t('cmds.changeLogin.usernameError')
          else return true
        }
      });
      credentials.password = await password({
        message: `${t('cmds.changeLogin.passwordPrompt')}:`,
        mask: '*',
        validate: (password: string) => {
          if (!/^.+$/.test(password)) return t('cmds.changeLogin.passwordError')
          else return true
        }
      });
      await runCmd(cmdName, <Required<typeof credentials>>credentials)
      break
    }

    case 'misc.changeLng': {
      let currentLng = getLng()
      let choices = [
        ...supportedLngs.map(lng => {
          let name = localeCode.getLanguageNativeName(lng)
          if (lng === currentLng) {
            name += ` (${t('cmds.changeLng.current')})`
            name = chalk.bold(name)
          }
          return { name, value: <SupportedLng>lng }
        }),
        new Separator(),
        { name: t('cli.return'), value: '' },
      ] as const

      let newLng = await select<SupportedLng | ''>({
        message: `${t('cmds.changeLng.prompt')}:`,
        choices: choices,
        default: currentLng,
      })
      if (newLng !== '') {
        if (newLng !== currentLng) await runCmd(cmdName, newLng)
        info(t('cmds.changeLng.success'))
      }
      break
    }

    case 'lessons.getLessons':
    case 'lessons.getLessonsWithImage': {
      let { data: lessons } = await runCmd(cmdName)
      printer.printLessons(lessons as Lesson[])
      break
    }

    case 'lessons.getStudents': {
      let { data: students } = await runCmd(cmdName)
      printer.printStudents(students)
      break
    }

    case 'lessons.createFolders': {
      let answer = await confirm({ message: t('cmds.createFolders.prompt') });
      if (answer) await runCmd(cmdName)
      break
    }

    case 'lessons.openLesson': {
      let lessonsPrinted = cmdsHistory.some(cmd => showLessonsCmds.includes(cmd))
      if (!lessonsPrinted) {
        info(`${t('cmds.openLesson.loadingList')} (${t('common.pressKeyToInterrupt')})`)
        let res = await Promise.race([
          runCmdSilently('lessons.getLessonsWithImage'),
          keypress()
        ])
        if (typeof res === 'object') {
          const lessons = res.data as Lesson[]
          printer.printLessons(lessons)
          const noLessons = lessons.length <= 0
          if (noLessons) return
        }
      }

      await rerunOnInputError(async () => {
        let i = await input({
          message: t('cmds.openLesson.lessonPrompt'),
          validate: (number: string) => {
            if (!/^[1-9][0-9]*$/.test(number)) return t('cmds.openLesson.lessonError')
            else return true
          }
        })
        return await runCmd(cmdName, parseInt(i) - 1)
      })
      break
    }

    case 'teachers.getTeachers': {
      let res = await runCmd(cmdName)
      printer.printTeachers(res.data)
      break
    }

    case 'teachers.getTeachersWithSimilarity': { 
      info(t('common.pressKeyToInterrupt'))
      let res = await Promise.race([
        runCmd(cmdName),
        keypress()
      ])
      if (res !== true) {
        const { data: teachers } = res
        printer.printTeachers(teachers)
      }
      break
    }

    case 'teachers.getTeacherSimilarity': {
      let teachersPrinted = cmdsHistory.some((cmd, i) => { 
        const isThisCmd = i === cmdsHistory.length - 1
        if (cmd === cmdName && !isThisCmd) return true
        return showTeachersCmds.includes(cmd)
      })
      if (!teachersPrinted) {
        const { data: teachers } = await runCmdSilently('teachers.getTeachers')
        printer.printTeachers(teachers)
        const noLessons = teachers.length <= 0
        if (noLessons) return
      }

      await rerunOnInputError(async () => {
        let i = await input({
          message: `${t('cmds.getTeachers.teacherPrompt')}:`,
          validate: (number: string) => {
            if (!/^[1-9][0-9]*$/.test(number)) return t('cmds.getTeachers.teacherError')
            else return true
          }
        })
        return await runCmd(cmdName, parseInt(i) - 1)
      })
      break
    }

    default: {
      const { result } = await runCmd(cmdName)
      if (!result) throw new UserError(t('cli.commandError'))
    }
  }
}

async function rerunOnInputError<Fn extends AnyFunction>(cb: Fn) {
  return rerunOnError(cb, InputError)
}

function isSuper(cmdName: CliCmdName): cmdName is SuperCmdName {
  return /^super\.[a-z0-9/]+$/.test(cmdName)
}

const printer = {
  
  printLessons(lessons: readonly Lesson[]) {
    if (!isNonEmptyArray(lessons)) info(t('cmds.getLessons.listEmpty'))
    else info([
      `${t('cmds.getLessons.list', { count: lessons.length })}:`,
      formatLessons(lessons)
    ])
  },

  printStudents(students: readonly Student[]) {
    if (!isNonEmptyArray(students)) info(t('cmds.getStudents.listEmpty'))
    else info([
      `${t('cmds.getStudents.list', { count: students.length })}:`,
      formatStudents(students)
    ])
  },

  printTeachers(teachers: readonly Teacher[]) {
    if (!isNonEmptyArray(teachers)) info(t('cmds.getTeachers.listEmpty'))
    else {
      info([
        `${t('cmds.getTeachers.list', { count: teachers.length })}:`,
        isTeachersWithStats(teachers) ? formatTeachersWithStats(teachers) : formatTeachers(teachers)
      ])
    }
  }

}
