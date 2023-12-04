import { createHash } from 'node:crypto'
import axios, { AxiosError, AxiosRequestConfig } from 'axios'
import { t } from 'i18next'

import * as auth from '../services/auth.js'
import { UserError, getEnv, getUnixTime } from '../utils/utils.js'
import { AsyncFunction } from '../utils/types.js'


export type Version = 'cz' | 'sk'

type IzusResponse = Record<string, never>
export type SchoolResponse<V extends Version = Version> = IzusResponse & {
  id_skoly: number
  nazev: string
  nazev_zkracene: string
  e_mail: string
  verze: V
}
export type SchoolsResponse<V extends Version = Version> = Record<number, SchoolResponse<V>>
type LoginResponse = IzusResponse & {
  access_token: string
  expires_in: number
}
type LogoutResponse = IzusResponse & {
  success: true
}
type WhoamiResponse = IzusResponse & {
  id: string
  userName: string
  id_skoly: string
  admin: boolean
  role: Role
}

export type IzusApiCallback = AsyncFunction

export enum Role {
  Student = 1,
  LegalGuard = 3,
  Employer = 5,
  Executive = 7,
  ShoolAdmin = 8,
  FullAdmin = 9,
}


let logged = false

const api = axios.create({
  baseURL: getEnv('BASE_URL'),
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
})

export async function doInIzusApi<T extends IzusApiCallback>(
  credentialsManager: auth.CredentialsManager,
  cb: T
): Promise<ReturnType<T>> {
  try {
    if (!logged) {
      const credentials = credentialsManager.get()
      await login(credentials)
    }
    const res = await cb()
    return res
  }
  catch (err) {
    if (err instanceof AxiosError)
      throw new UserError(t('izusApi.error'), err)
    throw err
  }
}

async function login({ username, password }: auth.Credentials): Promise<LoginResponse> {
  const [md5, sha1] = [createHash('md5'), createHash('sha1')]
  const salt = getUnixTime().toString()
  const part = md5.update(password + username).digest('hex')
  const passwordHash = sha1.update(part + salt).digest('hex')

  try {
    const res = (await api.post('/ws/api/login', {
      username,
      password: passwordHash,
      salt
    })).data as LoginResponse

    logged = true
    api.defaults.headers.common.Authorization = `Bearer ${res.access_token}`
    return res
  }
  catch (err) {
    throw new UserError(t('izusApi.loginFailed'), err)
  }
}

export function isLoggedIn() {
  return logged
}

export async function logout() {
  const res = (await api.get('/ws/api/logout')).data as LogoutResponse
  logged = false
  delete api.defaults.headers.common.Authorization
  return res
}

export async function whoami(): Promise<WhoamiResponse> {
  return (await getUrl('/ws/whoami')).data
}

export async function schools<V extends Version = Version>(version?: V): Promise<SchoolsResponse<V>> {
  const params: Record<string, string> = { }
  if (version) params.verze = version
  const res = await api.get('/ws/skoly', { params })
  return res.data
}

export function getUrl(url: string, config?: AxiosRequestConfig) {
  return api.get(url, config)
}

export const web = {

  index() {
    return getUrl('/')
  },

  zaci() {
    return getUrl('/zaci/')
  },

  zamestnanci() {
    return getUrl('/zamestnanci/', { params: {
      pocet_zaznamu_na_jedne_strane: 'vsechny',
      zobrazit_sloupce: 'ano',
      zobrazit_prijmeni: 'ano',
      zobrazit_jmeno: 'ano',
    }})
  },

  dokumentyZamestnance(teacherId: number) {
    return getUrl('/zamestnanci/dokumenty/', { params: {
      id_zamestnance: teacherId
    }})
  },

  tridniKniha(studentId: number, clsId: number) {
    return getUrl('/zaci/dokumenty/tridni_kniha/', { params: {
      id_zaka: studentId,
      id_tridni_knihy: clsId
    }})
  }

}
