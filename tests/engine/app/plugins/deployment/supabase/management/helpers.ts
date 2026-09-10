export interface RecordedRequest {
  readonly url: string
  readonly init: RequestInit
  readonly maximum: number
  readonly timeout: number
}

export interface QueryBody {
  readonly query: string
  readonly parameters: readonly unknown[]
}
