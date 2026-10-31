import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  GlyphSpinner,
  host,
  Input,
  queryClient,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { AvatarPicker } from './avatar-picker'
import { RoutineDetailDialog, RoutineRow, routinesQueryTarget, selectRoutineJobs, useRoutines } from './cron'
import { $botMeta, botSelectionKey, ROSTER_KEY, saveBotMeta } from './data'
import { editedLook, type EditProfileLook } from './edit-profile-look'
import { useBots } from './i18n'
import { displayName } from './labels'
import { openRosterBot } from './roster-actions'
import { botRosterMeta } from './routing'
import type { RosterRow, RoutineJob } from './types'

interface BotDetailDialogProps {
  bot: null | RosterRow
  onClose: () => void
  open: boolean
}

export function BotDetailDialog({ bot, open, onClose }: BotDetailDialogProps) {
  const { t } = useI18n()
  const b = useBots()
  const metaAll = useValue($botMeta)
  const meta = bot ? botRosterMeta(bot, metaAll) : null
  const appearance = botAppearance(bot?.name || 'agent', meta)
  const openingTitle = meta?.title || bot?.title || ''

  const opening: EditProfileLook = {
    shape: appearance.shape,
    color: appearance.color,
    image: appearance.image ?? null,
    title: openingTitle
  }

  const [shape, setShape] = useState(appearance.shape)
  const [color, setColor] = useState<null | string>(opening.color)
  const [image, setImage] = useState<null | string>(opening.image)
  const [title, setTitle] = useState(opening.title)
  const [opened, setOpened] = useState(opening)
  const [saving, setSaving] = useState<'avatar' | 'name' | null>(null)
  const [detailJobId, setDetailJobId] = useState<null | string>(null)
  const [seedKey, setSeedKey] = useState<null | string>(null)
  // Passive owner resolution: an orphaned row (its connection was deleted)
  // renders read-only instead of throwing from the dispatch-only route lookup.
  const routines = useRoutines(bot)
  const orphaned = bot ? routinesQueryTarget(bot).orphaned : false
  // A failed refresh keeps the last good list for THIS bot (cron.tsx selectRoutineJobs).
  const lastJobs = useRef<{ jobs: RoutineJob[]; key: null | string }>({ jobs: [], key: null })
  const currentKey = bot ? `${botSelectionKey(bot)}:${open}` : null

  if (currentKey !== seedKey) {
    setSeedKey(currentKey)

    if (bot && open) {
      setShape(appearance.shape)
      setColor(opening.color)
      setImage(opening.image)
      setTitle(opening.title)
      setOpened(opening)
      setSaving(null)
      setDetailJobId(null)
    }
  }

  if (!bot) {
    return null
  }

  // Keep this bot's last good (already owner-filtered) list: a failed refresh has no
  // `scoped` answer to filter by, so re-filtering the raw fallback would drop it.
  const lastKey = botSelectionKey(bot)
  const lastGood = lastJobs.current.key === lastKey ? lastJobs.current.jobs : []
  const routineView = selectRoutineJobs(routines.data, routines.error, [], bot.name)

  if (routineView.live) {
    lastJobs.current = { jobs: routineView.jobs, key: lastKey }
  }

  const jobs = routineView.live || !routines.error ? routineView.jobs : lastGood
  const knownJobIds = jobs.map(job => job.job_id)
  const detailJob = detailJobId ? jobs.find(job => job.job_id === detailJobId) || null : null

  const persistLook = async (kind: 'avatar' | 'name', next: EditProfileLook) => {
    if (saving) {
      return
    }

    const look = editedLook(opened, next)

    if (!look) {
      return
    }

    setSaving(kind)

    try {
      const persistence = await saveBotMeta(bot, look)

      // Only an explicit remote failure is an error -- 'unsupported' is the
      // older-gateway local fallback (see edit-profile-dialog.tsx). A failed
      // save keeps the button enabled so the user can retry.
      if (persistence.serverOutcome === 'failed') {
        host.notify({
          kind: 'error',
          message: kind === 'name' ? b.details.nameSavedLocally : b.avatar.savedLocally
        })

        return
      }

      if (persistence.serverOutcome === 'persisted') {
        queryClient.invalidateQueries({
          queryKey: ROSTER_KEY
        })
      }

      if (kind === 'name') {
        setTitle(next.title.trim())
      }

      setOpened(next)
    } catch (err) {
      host.notifyError(err, b.details.saveFailed)
    } finally {
      setSaving(null)
    }
  }

  const display = displayName(bot, meta)

  return (
    <Dialog onOpenChange={value => !value && !saving && onClose()} open={open}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{b.details.dialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">{`${display} (${bot.name})`}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6">
          {saving ? (
            <p className="text-sm text-(--ui-text-secondary)" role="status">
              {b.details.saving}
            </p>
          ) : null}
          {orphaned ? (
            <p className="text-sm text-(--ui-text-secondary)" role="note">
              {b.details.ownerRemoved}
            </p>
          ) : null}
          <div className="flex items-center gap-4">
            <BotFace color={avatarColor(color, bot.name)} image={image} name={bot.name} shape={shape} size={80} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-semibold">{display}</div>
              <div className="truncate font-mono text-xs text-(--ui-text-tertiary)">{bot.name}</div>
              {bot.description ? (
                <p className="mt-2 text-sm leading-5 text-(--ui-text-secondary)">{bot.description}</p>
              ) : null}
            </div>
            <Button
              disabled={orphaned}
              onClick={() => {
                void openRosterBot(bot)
                onClose()
              }}
            >
              {b.details.openChat}
            </Button>
          </div>

          {/* Tasks sit right under the header: below the tall avatar picker they
              were off-screen in the 90vh dialog until the picker shrank. */}
          <section className="grid gap-3 border-t border-(--ui-stroke-tertiary) pt-4">
            <h3 className="text-sm font-semibold">{b.details.tasks}</h3>
            {routines.isLoading && !jobs.length ? (
              <div className="flex min-h-20 items-center justify-center">
                <GlyphSpinner ariaLabel={t.common.loading} className="text-(--ui-text-tertiary)" spinner="breathe" />
              </div>
            ) : routines.error && !jobs.length ? (
              <div className="grid min-h-20 place-items-center gap-2 text-center text-sm text-(--ui-text-secondary)">
                <span>{b.cron.readFailure}</span>
                <Button onClick={() => void routines.refetch()} size="sm" variant="secondary">
                  {t.common.retry}
                </Button>
              </div>
            ) : jobs.length === 0 ? (
              <div className="py-6 text-center text-sm text-(--ui-text-tertiary)">{b.details.noTasks}</div>
            ) : (
              <div className="grid gap-1.5">
                {jobs.map(job => (
                  <RoutineRow
                    allowRemove={false}
                    expectedProfile={bot.name}
                    job={job}
                    key={`${bot.name}:${job.job_id}`}
                    knownJobIds={knownJobIds}
                    onOpen={selected => setDetailJobId(selected.job_id)}
                    owner={bot}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-3 border-t border-(--ui-stroke-tertiary) pt-4">
            <h3 className="text-sm font-semibold">{b.details.name}</h3>
            <div className="flex items-center gap-2">
              <Input
                aria-label={b.details.name}
                onChange={event => setTitle(event.target.value)}
                placeholder={displayName(bot, null)}
                value={title}
              />
              <Button
                disabled={saving !== null || title.trim() === opened.title.trim()}
                loading={saving === 'name'}
                onClick={() => void persistLook('name', { ...opened, title: title.trim() })}
                variant="secondary"
              >
                {b.details.saveName}
              </Button>
            </div>
          </section>

          <section className="grid gap-3 border-t border-(--ui-stroke-tertiary) pt-4">
            <h3 className="text-sm font-semibold">{b.details.avatar}</h3>
            <div className="flex justify-center py-1">
              <BotFace color={avatarColor(color, bot.name)} image={image} name={bot.name} shape={shape} size={64} />
            </div>
            <AvatarPicker
              color={color}
              generateSeed={{
                name: bot.name,
                title,
                description: bot.description || ''
              }}
              image={image}
              onColor={setColor}
              onImage={setImage}
              onShape={setShape}
              shape={shape}
            />
            <div className="flex justify-end">
              <Button
                disabled={
                  saving !== null || (shape === opened.shape && color === opened.color && image === opened.image)
                }
                loading={saving === 'avatar'}
                onClick={() => void persistLook('avatar', { ...opened, shape, color, image })}
                variant="secondary"
              >
                {b.details.saveAvatar}
              </Button>
            </div>
          </section>
        </div>

        <RoutineDetailDialog job={detailJob} onClose={() => setDetailJobId(null)} open={Boolean(detailJob)} />
      </DialogContent>
    </Dialog>
  )
}
