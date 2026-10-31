import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CronModule from './cron'
import type * as DataModule from './data'
import { translateBotsIn } from './i18n-test-helper'
import type { RoutineJob } from './types'

const { locale, notify, notifyError, request, routinesState, saveBotMeta } = vi.hoisted(() => ({
  locale: { current: 'en' as 'en' | 'zh' },
  notify: vi.fn(),
  notifyError: vi.fn(),
  request: vi.fn(async () => ({})),
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
    host: { ...sdk.host, notify, notifyError, request },
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
  request.mockResolvedValue({})
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

  it('refuses a row whose owner is not the profile the UI claims to show', async () => {
    const job: RoutineJob = {
      enabled: true,
      job_id: 'job-1',
      name: 'Daily report',
      schedule: 'every 1d',
      state: 'scheduled'
    }

    render(<RoutineRow expectedProfile="botdetail-test" job={job} owner={{ name: 'ops' }} />)
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(notifyError).toHaveBeenCalled())

    const [error, copy] = notifyError.mock.calls[0]

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('routine job-1 does not belong to botdetail-test')
    expect(copy).toBeTruthy()
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses a row whose job id was not in the listed set', async () => {
    const job: RoutineJob = {
      enabled: true,
      job_id: 'job-1',
      name: 'Daily report',
      schedule: 'every 1d',
      state: 'scheduled'
    }

    render(<RoutineRow expectedProfile="ops" job={job} knownJobIds={['job-2']} owner={{ name: 'ops' }} />)
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(notifyError).toHaveBeenCalled())
    expect(request).not.toHaveBeenCalled()
  })

  it('acts when the owner, expected profile and listed job id all agree', async () => {
    const job: RoutineJob = {
      enabled: true,
      job_id: 'job-1',
      name: 'Daily report',
      schedule: 'every 1d',
      state: 'scheduled'
    }

    render(<RoutineRow expectedProfile="ops" job={job} knownJobIds={['job-1']} owner={{ name: 'ops' }} />)

    const toggle = screen.getByRole('switch')

    expect(toggle.getAttribute('data-profile')).toBe('ops')
    expect(toggle.getAttribute('data-job-id')).toBe('job-1')

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('cron.manage', {
        action: 'pause',
        name: 'job-1',
        profile: 'ops'
      })
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(notifyError).not.toHaveBeenCalled()
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

  it('shows the trimmed saved name and stays dirty-free on whitespace-only edits', async () => {
    const bot = { name: 'research', title: 'Research' }

    render(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: '  New Name  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(input.value).toBe('New Name'))

    fireEvent.change(input, { target: { value: 'New Name  ' } })

    expect(screen.getByRole('button', { name: 'Save name' })).toHaveProperty('disabled', true)
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

  it('keeps bot identity through a name save and roster refresh, then targets the saved profile', async () => {
    const job: RoutineJob = {
      enabled: true,
      job_id: 'job-1',
      name: 'Daily report',
      schedule: 'every 1d',
      state: 'scheduled'
    }

    const bot = { name: 'botdetail-test', title: 'Bot Detail Test' }

    routinesState.current = { data: { jobs: [job], scoped: 'botdetail-test' }, error: null, isLoading: false }
    const view = render(<BotDetailDialog bot={bot} onClose={vi.fn()} open />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'New Name' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(saveBotMeta).toHaveBeenCalledWith(bot, { title: 'New Name' }))

    // The dialog takes one row, not the roster list, so there is no list order
    // to permute here; a refresh is a NEW RosterRow object for the same bot.
    view.rerender(<BotDetailDialog bot={{ name: 'botdetail-test', title: 'Refreshed' }} onClose={vi.fn()} open />)

    expect(screen.getByText('botdetail-test')).toBeTruthy()

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('cron.manage', {
        action: 'pause',
        name: 'job-1',
        profile: 'botdetail-test'
      })
    )
    expect(request).toHaveBeenCalledTimes(1)
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
