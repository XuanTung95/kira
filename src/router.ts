import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import WatchPage from './pages/WatchPage.vue';
import PlayerPage from './pages/PlayerPage.vue';
import ReelsPage from './pages/ReelsPage.vue';

export const router = createRouter({
  // history: createWebHistory(),
  history: createWebHashHistory(), // 👈 dùng hash mode
  routes: [
    {
      path: '/',
      component: HomePage
    },
    {
      path: '/watch/:id',
      component: WatchPage
    },
    {
      path: '/player/:id?',
      component: PlayerPage
    },
    {
      path: '/reels',
      component: ReelsPage
    },
  ]
});
