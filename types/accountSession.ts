export interface AccountSessionEvent {
  uid: string
  loginExpired: boolean
  lastLoginTime: string
}

export interface AccountRecoveryResult {
  uid: string
  username: string
  info: Omit<CX.User, 'password'>
  setting: CX.Setting
  lastLoginTime: string
  loginExpired: boolean
  courses?: CX.Course[]
}
