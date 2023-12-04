import process from 'node:process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { Get, Constructor } from 'type-fest'
import chalk from 'chalk';
import 'dotenv/config'
import { t } from 'i18next'

import { NonEmptyArray, AnyFunction, ReadonlyNonEmptyArray } from './types.js'


interface AppProcessEnv {
  IZUS_USERNAME: string
  IZUS_PASSWORD: string
  GOOGLE_FOLDER_ID: string
  BASE_URL: string
  NODE_ENV: 'production' | 'development'
}
declare global {
  namespace NodeJS {
    interface ProcessEnv extends AppProcessEnv { }
  }
}


export const getUnixTime = () => Math.floor(new Date().getTime() / 1000)
export const date2sql = (date: string | Date) => {
  let day: string; let month: string; let year: string
  if (date instanceof Date) {
    day = date.getDate().toString()
    month = (date.getMonth() + 1).toString()
    year = date.getFullYear().toString()
  }
  else {
    let res = date.match(/^([0-9]{1,2})\. ([0-9]{1,2})\. ([0-9]{4})$/)
    if (!res) throw new Error();
    [, day, month, year] = res
  }

  let dayPad = day.padStart(2, '0')
  let monthPad = month.padStart(2, '0')
  return `${year}-${monthPad}-${dayPad}`
}
export const info = (str: string | string[]) => {
  let strArr = Array.isArray(str) ? str : [str]
  let strStr = strArr.join('\n')
  console.log(`\n${chalk.blue('\u{24D8}')} ${strStr}`)
}
export const error = (error: Error) => console.error(error)
export const userError = (error: Error | string) => {
  const msg = error instanceof Error ? error.message : error
  console.log(chalk.red(`\n\u{1F7AD} ${msg}`))
}
export const noop = () => {}
export const getEnv = <K extends keyof AppProcessEnv>(name: K): AppProcessEnv[K] => process.env[name]
export const getDescendantProp = <BaseType extends object, Path extends string | readonly string[]>(object: BaseType, path: Path): Get<BaseType, Path> => {
  const pathArray: readonly string[]
    = typeof path === 'string'
    ? path.split('.')
    : path
  return pathArray.reduce<object>((a: object & { [key in typeof b]: any }, b) => a[b], object) as Get<BaseType, Path>
}
export const keypress = async () => {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise<true>(resolve => process.stdin.once('data', () => {
    process.stdin.setRawMode(false)
    resolve(true)
  }))
}
export const scriptDirname = (scriptUrl: string) => dirname(fileURLToPath(scriptUrl))
export const fileExists = (file: string) => {
  return fs.access(file, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false)
}
const ncFirst = (str: string, cb: (this: string) => string) => cb.call(str.charAt(0)) + str.slice(1)
export const ucFirst = (str: string) => ncFirst(str, String.prototype.toUpperCase)
export const lcFirst = (str: string) => ncFirst(str, String.prototype.toLowerCase)
export const average = (array: number[]) => array.reduce((a, b) => a + b) / array.length;
export const isValidNumber = (val?: number): val is number => val !== undefined && !isNaN(val)
export const isString = (val: unknown): val is string => typeof val === 'string'
export const isNonEmptyArray = <T>(arr: readonly T[]): arr is NonEmptyArray<T> => arr.length > 0
export const isDev = getEnv('NODE_ENV') === 'development'
export const delay = async (ms: number) => await setTimeout(ms)
export const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ')

export const countSettledPromises = (promiseResults: PromiseSettledResult<unknown>[]) => {
  const count = (status: PromiseSettledResult<unknown>['status']) => {
    return promiseResults.reduce(
      (sum, promiseResult) => promiseResult.status === status ? sum + 1 : sum,
      0
    )
  }
  return {
    fulfilledCount: count('fulfilled'),
    rejectedCount: count('rejected'),
  }
}

export function isObjectWithKeys<
  T extends object,
  U extends T & { [K1 in Keys[number]]: T[K1] },
  Keys extends readonly (keyof T & keyof U)[]
>(
  obj: T,
  keys: Keys
): obj is U {
  return keys.every(key => key in obj)
}

export function isObjectsWithKeys<
  T extends object,
  U extends T & { [K1 in Keys[number]]: T[K1] },
  Keys extends readonly (keyof T & keyof U)[]
>(
  arr: ReadonlyNonEmptyArray<T>,
  keys: Keys
): arr is ReadonlyNonEmptyArray<U> {
  const obj1 = arr[0]
  return isObjectWithKeys<T, U, Keys>(obj1, keys)
}

export interface Named {
  firstName: string
  lastName: string
}
export const getName = (named: Named) => named.lastName + ' ' + named.firstName
export const createNamed = (name: string): Named => {
  const [lastName, firstName] = name.split(' ', 2)
  return { firstName, lastName }
}
export const sortNamed = (named1: Named, named2: Named) => {
  const res = named1.lastName.localeCompare(named2.lastName)
  if (res !== 0) return res;
  return named1.firstName.localeCompare(named2.firstName)
}

export function* chunks<T>(arr: readonly T[], n: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n)
  }
}

export class UserError extends Error {

  constructor(userMessage?: string, public originalErr?: unknown) {
    let msg = userMessage
    if (userMessage && originalErr) {
      const originalMsg
        = typeof originalErr === 'string'
        ? originalErr
        : originalErr instanceof Error
        ? originalErr.message
        : undefined
      if (originalMsg) msg += `\n${t('common.error')}: ${originalMsg}`
    }
    super(msg)
  }

}

export class InputError extends UserError { }

export const handleError = (err: unknown) => {
  const msgUnknownErr = t('common.unknownError')
  let userErr
  if (err instanceof Error) {
    if (!err.message) err.message = msgUnknownErr
    if (!(err instanceof UserError)) {
      err.message = `${t('common.programError')}: ${err.message}`
      if (isDev) console.log(err)
    }
    userErr = err
  }
  else userErr = msgUnknownErr
  return userError(userErr)
}

export async function rerunOnError<Fn extends AnyFunction>(cb: Fn, errType: Constructor<Error> = Error) {
  async function run(): Promise<ReturnType<Fn>> {
    try {
      return await cb()
    }
    catch (err) {
      if (err instanceof errType) {
        handleError(err)
        return await run()
      }
      else throw err
    }
  }
  return await run()
}
