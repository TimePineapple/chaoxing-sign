<script setup lang="ts">
const { status, data } = useAuth()
</script>

<template>
  <div class="profile-card">
    <div v-if="status === 'authenticated'" class="flex flex-col justify-center items-center gap-4">
      <img
        v-if="data?.user?.image"
        class="w-12 h-12 rounded-full"
        :src="data.user.image"
        alt="User Avatar"
      >
      <h1 class="profile-name">
        {{ data?.user?.name }}
      </h1>
      <h2>
        {{ data?.user?.email }}
      </h2>
    </div>
    <h1 v-else>
      Not logged in
    </h1>
  </div>
</template>
