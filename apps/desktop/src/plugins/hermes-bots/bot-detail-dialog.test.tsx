import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CronModule from './cron'
import type * as DataModule from './data'
import { translateBotsIn } from './i18n-test-helper'
import type { RoutineJob } from './types'

const { saveBotMeta } = vi.hoisted(() => ({
  saveBotMeta: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    usePluginI18n: () => translateBotsIn('en')
  }
})

vi.mock('./data', async importOriginal => {
  const data = await importOriginal<typeof DataModule>()

  return {
    ...data,
    saveBotMeta
  }
})

vi.mock('./avatar-picker', () => ({
  AvatarPicker: () => <div data-testid="avatar-picker" />
}))

vi.mock('./cron', async importOriginal => {
  const cron = await importOriginal<typeof CronModule>()

  return {
    ...cron,
    useRoutines: () => ({
      data: { jobs: [], scoped: 'research' },
      error: null,
      isLoading: false,
      refetch: vi.fn()
    })
  }
})

const { BotDetailDialog } = await import('./bot-detail-dialog')
const { RoutineRow } = await import('./cron')

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  saveBotMeta.mockResolvedValue({ serverOutcome: 'persisted' })
})

afterEach(() => {
  cleanup()
})

describe('bot details', () => {
  it('hides routine deletion on the details page row', () => {
    const job: RoutineJob = {
      enabled: true,
      job_id: 'daily-report',
      name: 'Daily report',
      schedule: 'every 1d',
      state: 'scheduled'
    }

    render(<RoutineRow allowRemove={false} job={job} owner={{ name: 'research' }} />)

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('saves an edited display name through saveBotMeta', async () => {
    const bot = { name: 'research', title: 'Research' }

    render(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Analyst' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(saveBotMeta).toHaveBeenCalledWith(bot, { title: 'Analyst' }))
  })
})
