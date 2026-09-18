export type QrJobState = 'queued' | 'running' | 'success' | 'error'

export interface QrJobView {
  id: string
  uid: string
  activityId: string
  clientId?: string
  submittedAt: number
  completedAt?: number
  state: QrJobState
  message: string
  result?: string
  activityName?: string
  courseName?: string
}

export interface QrJobEvent extends QrJobView {
  sequence: number
}

export type QrSubmitDecision =
  | { state: 'accepted'; job: QrJobView }
  | { state: 'busy'; job: QrJobView }

export interface QrStreamSnapshot {
  active: QrJobView[]
  recentSuccess: QrJobView[]
}
