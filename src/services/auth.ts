import path from 'node:path'
import { promises as fs } from 'node:fs'
import { t } from 'i18next'

import * as izusApi from '../apis/izus.js'
import { IzusApi } from '../cmds.js'
import { UserError, getEnv, handleError, isString, scriptDirname } from '../utils/utils.js'
import { IzusTable, SortDir } from '../utils/ui.js'


export type Credentials = { username: string, password: string }
type CredentialsManagerFilled = CredentialsManager & Required<Pick<CredentialsManager, 'username' | 'password'>>
type CredentialsHistoryEntry = Whoami & { lastLogin: Date }

type School<V extends izusApi.Version = izusApi.Version> = {
  schoolId: number
  name: string
  nameShort: string
  version: V
}
type Schools<V extends izusApi.Version> = Record<number, School<V>>

type GetSchools<V extends izusApi.Version = izusApi.Version> = {
  (version?: V): Promise<Schools<V>>,
  schools?: Schools<V>
}

type Whoami = {
  id: number
  user: string
  userName: string
  school: School | string
  admin: boolean
  role: izusApi.Role
  roleName: string
}

export const defaultVersion: izusApi.Version = 'cz'
export let credentialsManager: CredentialsManager

export function getCredentialsManager() {
  if (!credentialsManager) credentialsManager = new CredentialsManager(new CredentialsHistory)
  return credentialsManager
}

export class CredentialsManager {

  username?: string = getEnv('IZUS_USERNAME')
  password?: string = getEnv('IZUS_PASSWORD')
  whoami?: Whoami

  constructor(public history: CredentialsHistory) { }

  get = (): Credentials => {
    if (this.hasCredentials())
      return { username: this.username, password: this.password }
    else throw new UserError()
  }
  set = ({ username, password }: Credentials) => {
    this.username = username
    this.password = password
    this.whoami = undefined
  }
  forget = () => {
    this.username = undefined
    this.password = undefined
    this.whoami = undefined
  }
  hasCredentials = (): this is CredentialsManagerFilled => {
    return this.username !== undefined && this.password !== undefined
  }
  checkCredentials = async (izusApi: IzusApi) => {
    if (!this.hasCredentials()) throw new UserError()
    this.whoami = await getWhoami(izusApi, this.username)
    this.history.add(this.whoami)
    return true
  }
  getWhoami = async (izusApi: IzusApi) => {
    if (!this.whoami) await this.checkCredentials(izusApi)
    return <Whoami>this.whoami
  }

}

class CredentialsHistory {

  private file = path.join(
    scriptDirname(import.meta.url),
    'auth',
    'credentials-history.json'
  )
  private history: CredentialsHistoryEntry[] = []

  constructor() {
    this.load()
  }

  private load = async () => {
    try {
      const fh = await fs.open(this.file, 'r')
      const buffer = await fh.readFile()
      const str = Buffer.from(buffer).toString()
      const json = JSON.parse(str)
      if (Array.isArray(json)) this.history = json
      else throw new UserError(t('auth.credentialsHistoryFileCorrupted'))
      fh.close()
    }
    catch (err) {
      let userError = new UserError(t('auth.credentialsHistoryFileError'), err)
      handleError(userError)
    }
  }

  get = () => this.history

  isEmpty = () => this.history.length <= 0

  add = (whoami: Whoami) => {
    const history = this.history.filter(entry => entry.id !== whoami.id)
    const historyEntry: CredentialsHistoryEntry = { ...whoami, lastLogin: new Date() }
    history.push(historyEntry)
    this.save()
    this.history = history
  }

  save = async () => {
    const fh = await fs.open(this.file, 'w')
    const str = JSON.stringify(this.history)
    fh.write(str)
    fh.close()
  }

  getFormatted = () => {
    const table = new IzusTable({
      head: [
        t('auth.credentialsHistoryTable.user'),
        t('auth.credentialsHistoryTable.userName'),
        t('auth.credentialsHistoryTable.school'),
        t('auth.credentialsHistoryTable.role'),
        `${t('auth.credentialsHistoryTable.lastLogin')}`
      ],
    })
    const rows = this.history.reverse().map(entry => [
      entry.user,
      entry.userName,
      getSchoolName(entry.school),
      entry.roleName,
      entry.lastLogin.toLocaleString()
    ])
    table.setSortHead(4, SortDir.Down)
    table.push(...rows)
    return table.toString()
  }

}


export const getSchools: GetSchools = async function getSchools<V extends izusApi.Version>(version?: V) {
  const mapSchool = (res: izusApi.SchoolResponse<V>): School<V> => {
    return {
      schoolId: res.id_skoly,
      name: res.nazev,
      nameShort: res.nazev_zkracene,
      version: res.verze
    }
  }
  const mapSchools = (res: izusApi.SchoolsResponse<V>): Schools<V> => {
    let schools: Schools<V> = { }
    for (let schoolId in res) schools[schoolId] = mapSchool(res[schoolId])
    return schools
  }
  
  if (version) return mapSchools(await izusApi.schools(version))
  const thisFunc = <GetSchools>getSchools
  if (!thisFunc.schools) thisFunc.schools = mapSchools(await izusApi.schools())
  return thisFunc.schools
}

export async function getSchool(schoolId: number) {
  const schools = await getSchools()
  if (!(schoolId in schools)) throw new UserError('Unknown school')
  return schools[schoolId]
}

export function getSchoolName(school: School | string) {
  return typeof school === 'string' ? school : school.nameShort
}


export async function getWhoami(izusApi: IzusApi, user: Whoami['user']): Promise<Whoami> {
  const res = await izusApi.whoami()
  const schoolId = parseInt(res.id_skoly)
  const school
    = res.role === izusApi.Role.FullAdmin
    ? await getSchool(schoolId)
    : t('common.unknownZus')

  return {
    id: parseInt(res.id),
    user,
    userName: res.userName,
    school: school,
    admin: res.admin,
    role: res.role,
    roleName: getRoleName(res.role),
  }
}

export async function getVersion(izusApi: IzusApi) {
  let whoami = await getCredentialsManager().getWhoami(izusApi)
  let version = isString(whoami.school) ? defaultVersion : whoami.school.version
  return version
}

export function getRoleName(role: izusApi.Role): string {
  return t([`auth.roles.${role}`, 'auth.roles.other'])
}
