import { type MessageOptions, createDiscreteApi } from 'naive-ui'

export const useLogStore = defineStore('log', () => {
  const logList = useLocalStorage<string[]>('log', []) // reactive<string[]>([])
  const showLog = ref(true)
  let messageApi: ReturnType<typeof createDiscreteApi>['message'] | undefined

  function log(content: string, options: MessageOptions) {
    const formatted = useDateFormat(useNow(), 'HH:mm:ss').value

    const info = `${formatted} ${content}`
    console.log(`${formatted} ${info}`)

    logList.value.push(info)

    if (options && typeof window !== 'undefined') {
      try {
        // The store may first be created during SSR, when discrete UI is unavailable.
        messageApi ??= createDiscreteApi(['message']).message
        messageApi?.create(content, options)
      }
      catch {
        console.warn('[log] 消息提示不可用')
      }
    }
  }

  function cleanLog() {
    logList.value = []
    log('日志已清空', { type: 'success' })
  }

  return {
    logList,
    log,
    showLog,
    cleanLog,
  }
}, {
  persist: false,
})
