import type { QrJobView } from './qrSignProtocol'
import { formatQrCodeFeedbackTime } from './qrCodeSign'

export function qrJobFeedbackMessage(job: QrJobView, otherClient: boolean): string {
  if (job.state === 'success')
    return `${job.courseName?.trim() || '未知课程'}${otherClient ? '在其他客户端签到成功' : '签到成功'}`
  if (job.state === 'error' && otherClient) {
    const message = job.message.trim()
    if (!message)
      return '其他客户端签到失败'
    if (message.includes('签到失败'))
      return message.replace('签到失败', '其他客户端签到失败')
    return `其他客户端签到失败：${message}`
  }
  return job.message
}

export function qrJobFeedbackTime(job: QrJobView): string {
  return formatQrCodeFeedbackTime(new Date(job.state === 'success'
    ? job.completedAt ?? job.submittedAt
    : job.submittedAt))
}
