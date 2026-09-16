<template>
  <div class="home-page">
    <Suspense>
      <template #fallback>
        <div class="op50 italic">
          <span class="animate-pulse">Loading...</span>
        </div>
      </template>
      <div>
        <div class="home-content">
          <Hero />
          <AccountList />
          <Operation />
        </div>
      </div>
    </Suspense>
  </div>
</template>
