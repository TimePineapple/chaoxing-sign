export interface RecentSign {
  name: string
  time: string
}

export interface RecentSignEvent {
  uid: string
  sign: RecentSign
}
