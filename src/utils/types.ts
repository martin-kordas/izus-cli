export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] }
export type AsyncFunction<Args extends any[] = []> = (...args: Args) => Promise<any>
export type AnyFunction = (...args: any[]) => any
export type Asyncify<F extends AnyFunction> = (...args: Parameters<F>) => Promise<ReturnType<F>>
export type ParametersSafe<T> = T extends AnyFunction ? Parameters<T> : never
export type Tail<T extends any[]> = T extends [infer A, ...infer B] ? B : never
export type NonEmptyArray<T> = [T, ...T[]]
export type ReadonlyNonEmptyArray<T> = readonly [T, ...T[]]
export type Stringable = { toString: () => string }
export type HtmlParser = (html: string) => object[]

export type KeysMatching<T, PropsType> = keyof {
  [K in keyof T as T[K] extends PropsType ? K : never]: T[K]
}

export interface Logger {
  info: (str: string) => void
  error: (err: Error) => void
}
