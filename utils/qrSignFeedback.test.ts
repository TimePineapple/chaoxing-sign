import { describe, expect, it } from 'vitest'
import { qrJobFeedbackMessage, qrJobFeedbackTime } from './qrSignFeedback'
import type { QrJobView } from './qrSignProtocol'

const base: QrJobView = {
  id: 'job-1', uid: 'cx-a', activityId: '10', clientId: 'client-a',
  submittedAt: new Date(2026, 0, 2, 3, 4, 5).getTime(),
  state: 'queued', message: '已进入服务器扫码队列',
}

describe('QR job feedback', () => {
  it('uses the same queued and running messages on every client', () => {
    expect(qrJobFeedbackMessage(base, true)).toBe('已进入服务器扫码队列')
    expect(qrJobFeedbackMessage({ ...base, state: 'running', message: '正在访问学习通，等待结果' }, true)).toBe('正在访问学习通，等待结果')
    expect(qrJobFeedbackMessage(base, false)).toBe('已进入服务器扫码队列')
    expect(qrJobFeedbackTime(base)).toBe('03:04:05')
  })

  it('shows the course name for success on both clients and uses the completion time', () => {
    const success: QrJobView = { ...base, state: 'success', message: '签到成功', courseName: '高等数学',
      completedAt: new Date(2026, 0, 2, 3, 5, 6).getTime() }
    expect(qrJobFeedbackMessage(success, false)).toBe('高等数学签到成功')
    expect(qrJobFeedbackMessage(success, true)).toBe('高等数学在其他客户端签到成功')
    expect(qrJobFeedbackTime(success)).toBe('03:05:06')
    expect(qrJobFeedbackMessage({ ...success, courseName: undefined }, false)).toBe('未知课程签到成功')
  })

  it('marks failures from another client and preserves their details', () => {
    expect(qrJobFeedbackMessage({ ...base, state: 'error', message: '签到失败：二维码已失效' }, true))
      .toBe('其他客户端签到失败：二维码已失效')
    expect(qrJobFeedbackMessage({ ...base, state: 'error', message: '等待签到响应超时' }, true))
      .toBe('其他客户端签到失败：等待签到响应超时')
    expect(qrJobFeedbackMessage({ ...base, state: 'error', message: '签到失败：二维码已失效' }, false))
      .toBe('签到失败：二维码已失效')
  })
})
