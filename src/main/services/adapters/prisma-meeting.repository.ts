import type { PrismaClient } from '@prisma/client'
import { MeetingStatus } from '../../../shared/types/meeting'
import type { Meeting, CreateMeetingDto, UpdateMeetingDto } from '../../../shared/types/meeting'
import type { MeetingRepository } from '../ports/meeting.repository'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Maps the raw Prisma `Meeting` row to the domain `Meeting` type.
 *
 * Prisma stores `status` as a plain `String` in SQLite, and `duration` as an
 * optional `Int`. We cast both to the domain types here so callers never see
 * raw DB values.
 */
function toDomain(row: {
  id: string
  title: string
  audioPath: string
  duration: number | null
  status: string
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}): Meeting {
  return {
    id: row.id,
    title: row.title,
    audioPath: row.audioPath,
    duration: row.duration,
    status: row.status as MeetingStatus,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * Concrete implementation of {@link MeetingRepository} backed by Prisma/SQLite.
 *
 * The `PrismaClient` instance is injected via the constructor so the adapter
 * can be used both in production (singleton from `prisma-client.ts`) and in
 * unit tests (in-memory `:memory:` database).
 */
export class PrismaMeetingRepository implements MeetingRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly prisma: InstanceType<typeof PrismaClient> | any) {}

  // ── findAll ──────────────────────────────────────────────────────────────

  async findAll(): Promise<Meeting[]> {
    const rows = await this.prisma.meeting.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toDomain)
  }

  // ── findById ─────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Meeting | null> {
    const row = await this.prisma.meeting.findUnique({
      where: { id },
      include: {
        transcript: true,
        summary: {
          include: {
            actionItems: true,
          },
        },
      },
    })

    if (!row) return null
    return toDomain(row)
  }

  // ── create ───────────────────────────────────────────────────────────────

  async create(data: CreateMeetingDto): Promise<Meeting> {
    const row = await this.prisma.meeting.create({
      data: {
        title: data.title,
        audioPath: data.audioPath,
        status: MeetingStatus.PENDING,
      },
    })
    return toDomain(row)
  }

  // ── update ───────────────────────────────────────────────────────────────

  async update(id: string, data: UpdateMeetingDto): Promise<Meeting> {
    const row = await this.prisma.meeting.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.audioPath !== undefined && { audioPath: data.audioPath }),
        ...(data.duration !== undefined && { duration: data.duration }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.errorMessage !== undefined && { errorMessage: data.errorMessage }),
      },
    })
    return toDomain(row)
  }

  // ── delete ───────────────────────────────────────────────────────────────

  async delete(id: string): Promise<void> {
    await this.prisma.meeting.delete({ where: { id } })
  }
}
