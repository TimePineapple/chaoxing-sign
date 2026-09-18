<script setup lang="ts">
import { useQRCode } from '@vueuse/integrations/useQRCode'
import { QrcodeCapture, QrcodeDropZone, QrcodeStream } from 'vue-qrcode-reader'
import { createQrCodeSubmissionGuard, parseQrCodeSignLink } from '~/utils/qrCodeSign'
import { clientLocationStatus, requestQrModalLocationOnce } from '~/utils/clientLocation.client'

export interface DetectedBarcode {
  boundingBox: BoundingBox
  rawValue: string
  format: string
  cornerPoints: {
    x: number
    y: number
  }[]
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

const props = withDefaults(defineProps<{
  title?: string
  loading?: boolean
  retryFailedAvailable?: boolean
  waitForSecondUrl?: number | string
}>(), {
  loading: false,
  retryFailedAvailable: false,
})

const emit = defineEmits<{
  (e: 'success', text: string): void
  (e: 'retry-failed'): void
}>()

const ms = useMessage()
const runtimeConfig = typeof useRuntimeConfig === 'function'
  ? useRuntimeConfig()
  : { public: {} }
const text = ref('')
const showScan = ref(false)
const cameraReady = ref(false)
const rearCameras = ref<{ deviceId: string; label: string }[]>([])
const selectedCameraId = ref<string | null>(null)
const activeCameraId = ref<string | null>(null)
const scanLocked = ref(false)
const errorMessage = ref('')
const lastInvalidCode = ref('')
const pendingDetectedLink = ref<string | null>(null)
const scannerContainer = ref<HTMLElement>()
const captureContainer = ref<HTMLElement>()
const submissionGuard = createQrCodeSubmissionGuard()
let pendingDetectedTimer: ReturnType<typeof setTimeout> | undefined
let cameraListRequest = 0

const waitForSecondUrlSeconds = computed(() => {
  const value = props.waitForSecondUrl ?? runtimeConfig.public.qrCode?.waitForSecondUrl
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
})

const cameraConstraints = computed<MediaTrackConstraints>(() => selectedCameraId.value
  ? { deviceId: { exact: selectedCameraId.value } }
  : { facingMode: { ideal: 'environment' } })

const rearCameraIndex = computed(() => rearCameras.value.findIndex(camera => camera.deviceId === activeCameraId.value))

const qrcode = useQRCode(text, {
  errorCorrectionLevel: 'H',
  margin: 2,
  scale: 10,
  color: {
    dark: '#000000',
    light: '#FFFFFF',
  },
})

const scanStatus = computed(() => {
  if (props.loading)
    return '正在提交签到...'
  if (showScan.value && !cameraReady.value)
    return '正在启动摄像头...'
  if (showScan.value)
    return '正在实时检测签到二维码'
  if (scanLocked.value)
    return '已识别二维码，摄像头已停止'
  if (errorMessage.value)
    return errorMessage.value
  return '摄像头已停止'
})

function clearPendingDetectedLink() {
  if (pendingDetectedTimer !== undefined) {
    clearTimeout(pendingDetectedTimer)
    pendingDetectedTimer = undefined
  }
  pendingDetectedLink.value = null
}

function resetCameraSelection() {
  cameraListRequest++
  rearCameras.value = []
  selectedCameraId.value = null
  activeCameraId.value = null
}

function isRearCameraLabel(label: string): boolean {
  return /\b(back|rear|environment)\b|后置|後置|背面|背部|后摄|後鏡/i.test(label)
    && !/\b(front|user|facetime)\b|前置|前鏡|自拍/i.test(label)
}

async function refreshRearCameras(requestId: number) {
  if (!navigator.mediaDevices?.enumerateDevices)
    return

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    if (requestId !== cameraListRequest || !showScan.value)
      return

    const video = scannerContainer.value?.querySelector('video')
    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]
    const settings = track?.getSettings()
    const cameras = devices
      .filter(device => device.kind === 'videoinput' && device.deviceId && isRearCameraLabel(device.label))
      .map(device => ({ deviceId: device.deviceId, label: device.label }))

    // An active environment camera can have a generic label on some browsers.
    if (settings?.facingMode === 'environment' && settings.deviceId && !cameras.some(camera => camera.deviceId === settings.deviceId))
      cameras.unshift({ deviceId: settings.deviceId, label: '' })

    rearCameras.value = cameras
    activeCameraId.value = settings?.deviceId
      || cameras.find(camera => camera.label && camera.label === track?.label)?.deviceId
      || selectedCameraId.value
  }
  catch {
    if (requestId === cameraListRequest)
      rearCameras.value = []
  }
}

function acceptQrCode(value: string) {
  const link = value.trim()

  if (props.loading)
    return

  const result = submissionGuard.tryLock(link)
  if (result.status === 'locked')
    return

  if (result.status === 'invalid') {
    if (link && link !== lastInvalidCode.value) {
      lastInvalidCode.value = link
      ms.error('未识别到有效的签到链接，请重试')
    }
    return
  }

  lastInvalidCode.value = ''
  scanLocked.value = true
  showScan.value = false
  cameraReady.value = false
  resetCameraSelection()
  text.value = result.value.link
  emit('success', result.value.link)
}

function submitQrCode(value: string, waitForSecond = false) {
  const link = value.trim()

  if (props.loading)
    return

  if (waitForSecond && waitForSecondUrlSeconds.value > 0) {
    const parsed = parseQrCodeSignLink(link)
    if (!parsed) {
      if (link && link !== lastInvalidCode.value) {
        lastInvalidCode.value = link
        ms.error('未识别到有效的签到链接，请重试')
      }
      return
    }

    lastInvalidCode.value = ''
    if (!pendingDetectedLink.value) {
      pendingDetectedLink.value = parsed.link
      pendingDetectedTimer = setTimeout(() => {
        const firstLink = pendingDetectedLink.value
        clearPendingDetectedLink()
        if (firstLink)
          acceptQrCode(firstLink)
      }, waitForSecondUrlSeconds.value * 1000)
      return
    }

    if (parsed.link === pendingDetectedLink.value)
      return

    clearPendingDetectedLink()
  }
  else {
    clearPendingDetectedLink()
  }

  acceptQrCode(link)
}

function handleScan() {
  if (props.loading)
    return

  if (showScan.value) {
    showScan.value = false
    cameraReady.value = false
    resetCameraSelection()
    return
  }

  if (props.retryFailedAvailable)
    emit('retry-failed')

  text.value = ''
  errorMessage.value = ''
  lastInvalidCode.value = ''
  clearPendingDetectedLink()
  submissionGuard.reset()
  scanLocked.value = false
  cameraReady.value = false
  resetCameraSelection()
  showScan.value = true
}

function switchCamera() {
  if (!showScan.value || !cameraReady.value || props.loading || rearCameras.value.length < 2)
    return

  const nextIndex = (rearCameraIndex.value + 1) % rearCameras.value.length
  const nextCamera = rearCameras.value[nextIndex]
  if (!nextCamera)
    return

  cameraListRequest++
  clearPendingDetectedLink()
  lastInvalidCode.value = ''
  cameraReady.value = false
  selectedCameraId.value = nextCamera.deviceId
}

function onCameraOn() {
  cameraReady.value = true
  errorMessage.value = ''
  void refreshRearCameras(++cameraListRequest)
}

function onError(error: { name?: string }) {
  const errorMessages: Record<string, string> = {
    NotAllowedError: '您需要授予相机访问权限！',
    NotFoundError: '此设备上没有摄像头！',
    NotSupportedError: '需要安全上下文（HTTPS 或 localhost）！',
    NotReadableError: '摄像头可能正在被其他应用使用！',
    OverconstrainedError: '未找到符合要求的摄像头！',
    StreamApiNotSupportedError: '此浏览器不支持摄像头视频流！',
    StreamLoadTimeoutError: '摄像头启动超时，请重试！',
    InsecureContextError: '仅能在 HTTPS 或 localhost 中访问摄像头！',
  }

  errorMessage.value = errorMessages[error.name ?? ''] ?? `相机错误（${error.name ?? '未知错误'}）！`
  cameraReady.value = false
  showScan.value = false
  resetCameraSelection()
  ms.error(errorMessage.value)
}

function onDetect(detectedCodes: DetectedBarcode[]) {
  const rawValue = detectedCodes.find(code => code.rawValue.trim())?.rawValue

  if (rawValue)
    submitQrCode(rawValue, true)
}

function handleOpen() {
  void requestQrModalLocationOnce()
  text.value = ''
  errorMessage.value = ''
  lastInvalidCode.value = ''
  clearPendingDetectedLink()
  submissionGuard.reset()
  scanLocked.value = false
  cameraReady.value = false
  resetCameraSelection()
  showScan.value = true
}

function handleClose() {
  clearPendingDetectedLink()
  showScan.value = false
  cameraReady.value = false
  resetCameraSelection()
  scanLocked.value = false
  errorMessage.value = ''
  lastInvalidCode.value = ''
  submissionGuard.reset()
}

function handleUpload() {
  if (props.loading)
    return

  showScan.value = false
  cameraReady.value = false
  resetCameraSelection()
  scanLocked.value = false
  clearPendingDetectedLink()
  submissionGuard.reset()

  const fileInput = captureContainer.value?.querySelector<HTMLInputElement>('input[type="file"]')
  if (fileInput) {
    fileInput.value = ''
    fileInput.click()
  }
}
</script>

<template>
  <n-modal
    :mask-closable="false"
    preset="card"
    size="large"
    :title="title ?? '二维码签到'"
    :bordered="false"
    :closable="!loading"
    class="mobile-sheet qr-sheet"
    transform-origin="bottom"
    @after-enter="handleOpen"
    @after-leave="handleClose"
  >
    <n-space class="mb-2">
      <div class="scan-action">
        <n-button type="info" :disabled="loading" @click="handleScan">
          {{ showScan ? '关闭摄像头' : '重新扫描' }}
        </n-button>
        <span
          v-if="retryFailedAvailable && !showScan"
          class="retry-failed-hint"
        >
          重新扫描将自动选取失败账号
        </span>
      </div>
      <n-button v-if="showScan && rearCameras.length > 1" :disabled="loading || !cameraReady" @click="switchCamera">
        后置镜头切换{{ rearCameraIndex >= 0 ? ` (${rearCameraIndex + 1}/${rearCameras.length})` : '' }}
      </n-button>
      <n-button :disabled="loading" @click="handleUpload">
        选择图片
      </n-button>
      <n-button v-if="text" type="error" :disabled="loading" @click="text = ''">
        清除
      </n-button>
    </n-space>

    <n-text class="scan-status" :type="errorMessage ? 'error' : 'info'">
      {{ scanStatus }}
    </n-text>
    <n-text v-if="clientLocationStatus === 'unavailable'" class="scan-status" type="warning">
      定位不可用；扫码将使用默认坐标，要求位置的签到可能失败。
    </n-text>
    <n-text v-else-if="clientLocationStatus === 'loading'" class="scan-status" type="info">
      正在读取网页位置；扫码提交会等待定位结果。
    </n-text>
    <slot name="result" />

    <div ref="scannerContainer" class="w-full aspect-1 border-1 transition hover:(border-1 border-green border-dotted)">
      <QrcodeStream
        v-if="showScan"
        :constraints="cameraConstraints"
        class="bg-black/20"
        @camera-on="onCameraOn"
        @error="onError"
        @detect="onDetect"
      />

      <n-image v-else-if="qrcode && scanLocked" :src="qrcode" />

      <QrcodeDropZone
        v-else
        class="flex flex-col justify-center items-center h-full w-full cursor-pointer"
        @detect="onDetect"
        @click="handleUpload"
      >
        <div style="padding-top: 16px; margin-bottom: 12px">
          <Icon name="material-symbols:unarchive-outline-sharp" size="48" />
        </div>
        <n-text>
          点击选择图片，或将图片拖到此处识别
        </n-text>
      </QrcodeDropZone>

      <div ref="captureContainer" class="hidden">
        <QrcodeCapture :capture="null" :multiple="false" @detect="onDetect" />
      </div>
    </div>

    <span>若有签到链接，可直接在下方输入</span>
    <div class="qr-url-actions">
      <n-input class="qr-url-input" v-model:value="text" placeholder="签到链接" clearable :disabled="loading" />
      <n-button
        class="qr-url-submit"
        type="primary"
        :loading="loading"
        :disabled="!text.trim() || scanLocked"
        @click="submitQrCode(text)"
      >
        签到
      </n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.scan-status {
  display: block;
  margin-bottom: 10px;
}

.scan-action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.retry-failed-hint {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
}

.qr-url-actions {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  min-width: 0;
  margin-top: 10px;
}

:deep(.qr-url-actions > .qr-url-input) {
  flex: 1 1 auto;
  width: auto !important;
  min-width: 0;
  border-radius: 14px !important;
  margin-left: 0 !important;
}

:deep(.qr-url-actions > .qr-url-submit) {
  flex: 0 0 auto;
  margin-left: 0 !important;
  border-radius: 14px !important;
}

:deep(.qr-url-actions > .qr-url-input .n-input__border),
:deep(.qr-url-actions > .qr-url-input .n-input__state-border),
:deep(.qr-url-actions > .qr-url-submit .n-button__border),
:deep(.qr-url-actions > .qr-url-submit .n-button__state-border) {
  border-radius: 14px !important;
}
</style>
