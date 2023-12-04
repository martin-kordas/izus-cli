import Table, { CrossTableRow, HorizontalTableRow, TableConstructorOptions, VerticalTableRow } from 'cli-table3'
import { t } from 'i18next'

import { UserError } from './utils.js'
import { Stringable } from './types.js'


export enum SortDir {
  Up = 1,
  Down
}

type IzusTableInstanceOptions = {
  /** Zda vypsat sloupec s číslem řádku */
  noColumn: boolean
}
export type IzusTableConstructorOptions = TableConstructorOptions & Partial<IzusTableInstanceOptions>


export class IzusTable extends Table {

  izusOptions: IzusTableInstanceOptions
  iSortedHead?: number
  i: number = 1
  static emptyRow = '-'

  constructor(options?: IzusTableConstructorOptions) {
    super(options)

    this.options.style.compact = true

    this.izusOptions = {
      noColumn: options?.noColumn ?? false
    }

    if (this.izusOptions.noColumn) {
      this.options.head = [t('common.no'), ...this.options.head ?? []]
      this.options.colAligns = ['right', ...this.options.colAligns ?? []]
    }
  }
  
  push(...items: (HorizontalTableRow | VerticalTableRow | CrossTableRow)[]): number {
    if (this.izusOptions.noColumn) {
      items = items.map(item => {
        // noColumn funguje pouze pro HorizontalTableRow, což je pole
        if (Array.isArray(item)) item = [this.i++, ...item]
        return item
      })
    }
    return super.push(...items)
  }

  setSortHead(i: number, dir: SortDir = SortDir.Up) {
    if (i >= this.options.head.length) throw new UserError

    if (this.iSortedHead !== undefined) {
      let head = this.options.head[this.iSortedHead]
      this.options.head[this.iSortedHead] = head.substring(0, head.length - 2)
    }

    const arrow = dir === SortDir.Up ? '↑' : '↓'
    this.options.head[i] += ` ${arrow}`
  }

  private static format<T extends string | Stringable>(val?: T, cb?: (val: T) => T | string): string {
    if (val === undefined || typeof val === 'number' && isNaN(val)) return this.emptyRow
    const res = cb ? cb(val) : val
    return typeof res === 'string' ? res : res.toString()
  }

  static numberFormat(val?: number) {
    return this.format(val, val => t('common.numberFormat', { number: val }))
  }
  
  static percentFormat(val?: number) {
    return this.format(val, val => t('common.percentFormat', { percent: val * 100 }))
  }

}
