export type QrJobState = 'queued' | 'running' | 'success' | 'error'

export interface QrJobView {
  id: string
  uid: string
  activityId: string
  state: QrJobState
  message: string
  result?: string
  activityName?: string
}

export interface QrJobEvent extends QrJobView {
  sequence: number
}

export type QrSubmitDecision =
  | { state: 'accepted'; job: QrJobView }
  | { state: 'busy'; job: QrJobView }

export interface QrStreamSnapshot {
  active: QrJobView[]
}
