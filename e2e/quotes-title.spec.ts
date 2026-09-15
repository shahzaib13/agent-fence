import { expect, test } from '@playwright/test'
import { stubClientTrades } from './client-trades'

test('names a saved kitchen quote from the published kitchen fitting label', async ({ page }) => {
  await stubClientTrades(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'agent-fence.quotes',
      JSON.stringify({
        'kit-1': {
          sessionId: 'kit-1',
          status: 'complete',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [{ id: 'm1', role: 'user', text: 'I need a new kitchen' }],
          checklist: { suburb: 'Berwick', jobType: 'new' },
          place: null,
          comparison: null,
          trade: 'kitchen',
        },
      }),
    )
  })

  await page.goto('/quotes')

  await expect(page.getByRole('heading', { name: /kitchen fitting in berwick/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^kitchen in berwick$/i })).toHaveCount(0)
})
