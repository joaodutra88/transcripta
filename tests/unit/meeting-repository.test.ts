// @vitest-environment node
/**
 * Unit tests for PrismaMeetingRepository.
 *
 * Uses an in-memory SQLite database so tests are isolated, fast, and require no
 * external setup.  Each test suite resets the schema via `prisma.$executeRawUnsafe`
 * (DROP + CREATE) so every `beforeEach` starts from a clean slate.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaMeetingRepository } from '../../src/main/services/adapters/prisma-meeting.repository'
import { MeetingStatus } from '../../src/shared/types/meeting'
import type { CreateMeetingDto, UpdateMeetingDto } from '../../src/shared/types/meeting'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates an isolated PrismaClient pointing at an in-memory SQLite database.
 * Each test file gets its own URL so parallel runs never collide.
 */
function createTestClient(): InstanceType<typeof PrismaClient> {
  const adapter = new PrismaBetterSqlite3({ url: 'file::memory:' })
  return new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>
}

/**
 * Bootstraps the schema inside the in-memory database by running the raw DDL
 * that Prisma would generate.  We replicate the migration SQL so tests work
 * without needing `prisma migrate` to run at test time.
 */
async function applySchema(prisma: InstanceType<typeof PrismaClient>): Promise<void> {
  const p = prisma as any

  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Meeting" (
    "id"           TEXT     NOT NULL PRIMARY KEY,
    "title"        TEXT     NOT NULL,
    "audioPath"    TEXT     NOT NULL,
    "duration"     INTEGER,
    "status"       TEXT     NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)

  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Transcript" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "meetingId" TEXT     NOT NULL UNIQUE,
    "content"   TEXT     NOT NULL,
    "segments"  TEXT     NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE
  )`)

  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Summary" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "meetingId"   TEXT     NOT NULL UNIQUE,
    "content"     TEXT     NOT NULL,
    "keyTopics"   TEXT     NOT NULL DEFAULT '[]',
    "decisions"   TEXT     NOT NULL DEFAULT '[]',
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE
  )`)

  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ActionItem" (
    "id"        TEXT    NOT NULL PRIMARY KEY,
    "summaryId" TEXT    NOT NULL,
    "text"      TEXT    NOT NULL,
    "assignee"  TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY ("summaryId") REFERENCES "Summary"("id") ON DELETE CASCADE
  )`)
}

/**
 * Removes all rows from every table without dropping the schema.
 */
async function clearAllTables(prisma: InstanceType<typeof PrismaClient>): Promise<void> {
  const p = prisma as any
  // Order matters for FK constraints
  await p.$executeRawUnsafe('DELETE FROM "ActionItem"')
  await p.$executeRawUnsafe('DELETE FROM "Summary"')
  await p.$executeRawUnsafe('DELETE FROM "Transcript"')
  await p.$executeRawUnsafe('DELETE FROM "Meeting"')
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrismaMeetingRepository', () => {
  let prisma: InstanceType<typeof PrismaClient>
  let repo: PrismaMeetingRepository

  beforeAll(async () => {
    prisma = createTestClient()
    await applySchema(prisma)
    repo = new PrismaMeetingRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await clearAllTables(prisma)
  })

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a meeting and returns the persisted entity', async () => {
      const dto: CreateMeetingDto = {
        title: 'Q1 Planning',
        audioPath: '/recordings/q1.mp3',
      }

      const meeting = await repo.create(dto)

      expect(meeting.id).toBeDefined()
      expect(meeting.title).toBe('Q1 Planning')
      expect(meeting.audioPath).toBe('/recordings/q1.mp3')
      expect(meeting.status).toBe(MeetingStatus.PENDING)
      expect(meeting.duration).toBeNull()
      expect(meeting.errorMessage).toBeNull()
      expect(meeting.createdAt).toBeInstanceOf(Date)
      expect(meeting.updatedAt).toBeInstanceOf(Date)
    })

    it('assigns distinct ids to separate meetings', async () => {
      const a = await repo.create({ title: 'A', audioPath: '/a.mp3' })
      const b = await repo.create({ title: 'B', audioPath: '/b.mp3' })

      expect(a.id).not.toBe(b.id)
    })
  })

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns an empty array when no meetings exist', async () => {
      const meetings = await repo.findAll()
      expect(meetings).toEqual([])
    })

    it('returns all meetings', async () => {
      await repo.create({ title: 'First', audioPath: '/first.mp3' })
      await repo.create({ title: 'Second', audioPath: '/second.mp3' })

      const meetings = await repo.findAll()

      expect(meetings).toHaveLength(2)
      const titles = meetings.map((m) => m.title)
      expect(titles).toContain('First')
      expect(titles).toContain('Second')
    })
  })

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns null when meeting does not exist', async () => {
      const result = await repo.findById('nonexistent-id')
      expect(result).toBeNull()
    })

    it('returns the meeting when it exists', async () => {
      const created = await repo.create({ title: 'Sprint Review', audioPath: '/sprint.mp3' })

      const found = await repo.findById(created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.title).toBe('Sprint Review')
    })

    it('returns the meeting with related transcript and summary when present', async () => {
      const created = await repo.create({ title: 'With Relations', audioPath: '/rel.mp3' })

      // Insert related rows directly via raw SQL to avoid testing insert logic here

      const p = prisma as any
      const transcriptId = `tr-${Date.now()}`
      const summaryId = `sm-${Date.now()}`

      await p.$executeRawUnsafe(
        `INSERT INTO "Transcript" (id, meetingId, content, segments) VALUES (?, ?, ?, ?)`,
        transcriptId,
        created.id,
        'Hello world',
        '[]',
      )

      await p.$executeRawUnsafe(
        `INSERT INTO "Summary" (id, meetingId, content) VALUES (?, ?, ?)`,
        summaryId,
        created.id,
        'Summary content',
      )

      const found = await repo.findById(created.id)

      // The domain Meeting type does not include transcript/summary fields — the
      // adapter still includes the relations in the query for future extensibility,
      // but the returned value only exposes the domain shape.
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })
  })

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates individual fields while preserving others', async () => {
      const created = await repo.create({ title: 'Original', audioPath: '/orig.mp3' })

      const updateDto: UpdateMeetingDto = { title: 'Updated Title' }
      const updated = await repo.update(created.id, updateDto)

      expect(updated.id).toBe(created.id)
      expect(updated.title).toBe('Updated Title')
      expect(updated.audioPath).toBe('/orig.mp3') // unchanged
    })

    it('updates status and errorMessage together', async () => {
      const created = await repo.create({ title: 'Job', audioPath: '/job.mp3' })

      const updated = await repo.update(created.id, {
        status: MeetingStatus.FAILED,
        errorMessage: 'Python crashed',
      })

      expect(updated.status).toBe(MeetingStatus.FAILED)
      expect(updated.errorMessage).toBe('Python crashed')
    })

    it('updates duration to a numeric value', async () => {
      const created = await repo.create({ title: 'With Duration', audioPath: '/dur.mp3' })

      const updated = await repo.update(created.id, { duration: 3600 })

      expect(updated.duration).toBe(3600)
    })

    it('sets duration back to null', async () => {
      const created = await repo.create({ title: 'Null Duration', audioPath: '/null-dur.mp3' })
      await repo.update(created.id, { duration: 120 })

      const updated = await repo.update(created.id, { duration: null })

      expect(updated.duration).toBeNull()
    })

    it('throws when the meeting does not exist', async () => {
      await expect(repo.update('ghost-id', { title: 'X' })).rejects.toThrow()
    })
  })

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes the meeting so it no longer appears in findAll', async () => {
      const meeting = await repo.create({ title: 'To Delete', audioPath: '/del.mp3' })

      await repo.delete(meeting.id)

      const remaining = await repo.findAll()
      expect(remaining.find((m) => m.id === meeting.id)).toBeUndefined()
    })

    it('makes findById return null after deletion', async () => {
      const meeting = await repo.create({ title: 'Gone', audioPath: '/gone.mp3' })

      await repo.delete(meeting.id)

      expect(await repo.findById(meeting.id)).toBeNull()
    })

    it('throws when the meeting does not exist', async () => {
      await expect(repo.delete('no-such-id')).rejects.toThrow()
    })
  })
})
