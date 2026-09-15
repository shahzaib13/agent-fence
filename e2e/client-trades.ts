import type { Page } from '@playwright/test'

export const CLIENT_TRADES = [
  { trade: 'fencing', label: 'fencing' },
  { trade: 'tiling', label: 'tiling' },
  { trade: 'kitchen', label: 'kitchen fitting' },
  { trade: 'retaining_wall', label: 'retaining wall' },
  { trade: 'decking', label: 'decking' },
  { trade: 'home_renovation', label: 'home renovation' },
]

/**
 * Optional stub for GET /client/trades. Homepage chips use the frontend
 * `PUBLISHED_CLIENT_TRADES` constant and do not need this route.
 */
export async function stubClientTrades(page: Page) {
  await page.route('**/api/v1/client/trades', async (route) => {
    await route.fulfill({ json: { ok: true, data: CLIENT_TRADES } })
  })
}
