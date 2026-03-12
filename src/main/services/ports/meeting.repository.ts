import type { Meeting, CreateMeetingDto, UpdateMeetingDto } from '../../../shared/types/meeting'

/**
 * Port (interface) for meeting persistence.
 *
 * Follows the Dependency Inversion Principle: the main process and IPC handlers
 * depend on this abstraction, not on a concrete Prisma or in-memory implementation.
 * Adapters live in `services/adapters/` and inject this interface at runtime.
 */
export interface MeetingRepository {
  /**
   * Returns all meetings ordered by creation date descending.
   */
  findAll(): Promise<Meeting[]>

  /**
   * Returns the meeting with the given id, or `null` if not found.
   */
  findById(id: string): Promise<Meeting | null>

  /**
   * Creates a new meeting record and returns the persisted entity.
   * The id and timestamps are assigned by the adapter.
   */
  create(data: CreateMeetingDto): Promise<Meeting>

  /**
   * Applies a partial update to an existing meeting and returns the updated entity.
   * Throws if no meeting with the given `id` exists.
   */
  update(id: string, data: UpdateMeetingDto): Promise<Meeting>

  /**
   * Permanently deletes the meeting and all related records (transcript, summary,
   * action items). Throws if no meeting with the given `id` exists.
   */
  delete(id: string): Promise<void>
}
