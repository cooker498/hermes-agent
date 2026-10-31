import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CronModule from './cron'
import type * as DataModule from './data'
import { translateBotsIn } from './i18n-test-helper'
import type { RoutineJob } from './types'

const { locale, notify, notifyError, routinesState, saveBotMeta } = vi.hoisted(() => ({
  locale: { current: 'en' as 'en' | 'zh' },
  notify: vi.fn(),
  notifyError: vi.fn(),
  routinesState: {
    current: {
      data: { jobs: [], scoped: 'research' } as unknown,
      error: null as unknown,
      isLoading: false
    }
  },
  saveBotMeta: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, notify, notifyError },
    usePluginI18n: () => translateBotsIn(locale.current)
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
      ...routinesState.current,
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
  locale.current = 'en'
  saveBotMeta.mockResolvedValue({ serverOutcome: 'persisted' })
  routinesState.current = { data: { jobs: [], scoped: 'research' }, error: null, isLoading: false }
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

  it('trims the name it saves', async () => {
    const bot = { name: 'research', title: 'Research' }

    render(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: '  Analyst  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(saveBotMeta).toHaveBeenCalledWith(bot, { title: 'Analyst' }))
  })

  it('reports a failed remote name save with name copy and keeps the save retryable', async () => {
    saveBotMeta.mockResolvedValue({ serverOutcome: 'failed' })
    const bot = { name: 'research', title: 'Research' }

    render(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Analyst' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith({ kind: 'error', message: 'Saved name locally; remote persistence failed' })
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save name' })).toHaveProperty('disabled', false))
  })

  it('surfaces a thrown save instead of swallowing it', async () => {
    const failure = new Error('boom')
    saveBotMeta.mockRejectedValue(failure)
    const bot = { name: 'research', title: 'Research' }

    render(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Analyst' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(failure, 'Could not save'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save name' })).toHaveProperty('disabled', false))
  })

  it('keeps the last good task list when a refresh fails', () => {
    const job: RoutineJob = {
      enabled: true,
      job_id: 'daily-report',
      name: 'Daily report',
      schedule: 'every 1d',
      state: 'scheduled'
    }

    const bot = { name: 'research', title: 'Research' }
    routinesState.current = { data: { jobs: [job], scoped: 'research' }, error: null, isLoading: false }
    const view = render(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)

    expect(screen.getByText('Daily report')).toBeTruthy()

    routinesState.current = { data: undefined, error: new Error('offline'), isLoading: false }
    view.rerender(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)

    expect(screen.getByText('Daily report')).toBeTruthy()
  })

  it('renders an orphaned row (connection removed) read-only instead of throwing', () => {
    const orphan = { name: 'research', title: 'Research', sourceScoped: true }

    render(<BotDetailDialog bot={orphan} onClose={vi.fn()} open />)

    expect(screen.getByText('This bot’s connection was removed. Its details are read-only.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open chat' })).toHaveProperty('disabled', true)
  })
  it('shows the task list on open, above the name and avatar, with no interaction', () => {
    const job: RoutineJob = {
      enabled: true,
      job_id: 'daily-report',
      name: 'Daily report',
      schedule: '0 9 * * *',
      state: 'scheduled'
    }

    routinesState.current = { data: { jobs: [job], scoped: 'research' }, error: null, isLoading: false }
    render(<BotDetailDialog bot={{ name: 'research', title: 'Research' }} onClose={vi.fn()} open />)

    const tasks = screen.getByRole('heading', { name: 'Tasks' })
    const name = screen.getByRole('heading', { name: 'Name' })
    const avatar = screen.getByRole('heading', { name: 'Avatar' })

    expect(screen.getByText('Daily report')).toBeTruthy()
    expect(screen.getByText('Every day at 09:00')).toBeTruthy()
    expect(tasks.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tasks.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders Simplified Chinese copy under the zh locale', () => {
    locale.current = 'zh'
    render(<BotDetailDialog bot={{ name: 'research', title: 'Research' }} onClose={vi.fn()} open />)

    for (const text of ['Bot 详情', '打开对话', '名称', '头像', '任务', '保存名称']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    }

    expect(screen.queryByText('Bot 詳情')).toBeNull()
  })
})

describe('cronExprLabel', () => {
  it('spells out the common cron shapes with core copy', async () => {
    const { cronExprLabel } = await import('./cron')

    expect(cronExprLabel('0 9 * * *')).toBe('Every day at 09:00')
    expect(cronExprLabel('30 8 * * 1-5')).toBe('Weekdays at 08:30')
    expect(cronExprLabel('0 22 * * 1')).toMatch(/^Every .+ at 22:00$/)
    expect(cronExprLabel('5 7 15 * *')).toBe('Monthly on day 15 at 07:05')
    expect(cronExprLabel('0 * * * *')).toBe('At the top of every hour')
  })

  it('leaves anything else as the raw expression', async () => {
    const { cronExprLabel } = await import('./cron')

    expect(cronExprLabel('0 9 1 1 *')).toBeNull()
    expect(cronExprLabel('*/5 * * * *')).toBeNull()
    expect(cronExprLabel('every 30m')).toBeNull()
  })
})

describe('routinesQueryTarget', () => {
  it('resolves an orphaned owner passively and disables its query', async () => {
    const { routinesQueryTarget } = await import('./cron')
    const target = routinesQueryTarget({ name: 'research', sourceScoped: true })

    expect(target.orphaned).toBe(true)
    expect(target.enabled).toBe(false)
  })

  it('keys an unscoped owner by name, as before', async () => {
    const { routinesQueryTarget } = await import('./cron')

    expect(routinesQueryTarget('research')).toMatchObject({ enabled: true, key: 'research', orphaned: false })
  })
})
