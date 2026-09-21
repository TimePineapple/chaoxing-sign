<script setup lang="ts">
import { pick } from 'lodash'
import type { Account } from '~/types/account'
import { connectRecentSignEvents } from '~/utils/recentSignEvents.client'

const accountStore = useAccountStore()

const isSyncing = ref(false)
const showLoginModal = ref(false)

async function handleSync() {
  if (isSyncing.value)
    return

  isSyncing.value = true
  await accountStore.syncAccounts().finally(() => {
    isSyncing.value = false
  })
  void refreshRecentSignsQuietly(true)
}

let lastRecentSignRefresh = 0
async function refreshRecentSignsQuietly(force = false) {
  if (!force && Date.now() - lastRecentSignRefresh < 1000)
    return
  lastRecentSignRefresh = Date.now()
  try {
    await accountStore.refreshRecentSigns()
  }
  catch {
    // A display-only refresh must not interrupt account actions.
  }
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible')
    void refreshRecentSignsQuietly()
}

async function selectAccount(account: Account) {
  account.selected = !account.selected
}

let closeRecentSignEvents: (() => void) | undefined
tryOnMounted(() => {
  void accountStore.syncAccounts()
  void refreshRecentSignsQuietly()
  closeRecentSignEvents = connectRecentSignEvents(
    event => accountStore.applyRecentSign(event),
    refreshWhenVisible,
  )
  document.addEventListener('visibilitychange', refreshWhenVisible)
  window.addEventListener('focus', refreshWhenVisible)
})
onBeforeUnmount(() => {
  closeRecentSignEvents?.()
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  window.removeEventListener('focus', refreshWhenVisible)
})
</script>

<template>
  <section class="account-section">
    <div class="section-heading">
      <h2>我的账号 <span class="count">{{ accountStore.accounts.length }}</span></h2>
      <n-button secondary :loading="isSyncing" @click="handleSync()">
        <template #icon><Icon name="material-symbols:cloud-sync-outline-rounded" /></template>
        同步
      </n-button>
    </div>

    <ClientOnly>
      <template v-if=" accountStore.accounts?.length! > 0">
        <div class="account-stack">
          <AccountItem v-for="account in accountStore.accounts" v-bind="pick(account, ['uid', 'info', 'lastLoginTime', 'selected', 'setting'])" :key="account.uid" :recent-sign="accountStore.recentSigns[account.uid]" @click="selectAccount(account)" />
          <n-button class="add-account-button" block dashed @click="showLoginModal = true">
            <template #icon><Icon name="ic:outline-add-box" /></template>
            添加账号
          </n-button>
        </div>
      </template>
      <template v-else>
        <div class="empty-card">
          <n-empty description="暂无账号" size="small" />
          <n-button type="primary" block @click="showLoginModal = true">
            添加账号
          </n-button>
        </div>
      </template>
    </ClientOnly>
    <AccountLoginModal v-model:show="showLoginModal" @success="showLoginModal = false" />
  </section>
</template>
