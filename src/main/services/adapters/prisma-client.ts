import { join } from 'path'
import { app } from 'electron'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import log from 'electron-log'

// ─── Singleton instance ───────────────────────────────────────────────────────

let _prismaClient: InstanceType<typeof PrismaClient> | null = null

/**
 * Returns the singleton PrismaClient connected to the user's data directory.
 *
 * The database file lives at `<userData>/transcripta.db` so it persists across
 * app updates and is never bundled with the ASAR archive.
 *
 * Uses Prisma 7 driver adapter pattern with better-sqlite3.
 * Call after `app.whenReady()` so that `app.getPath('userData')` is available.
 */
export function getPrismaClient(): InstanceType<typeof PrismaClient> {
  if (_prismaClient) return _prismaClient

  const dbPath = join(app.getPath('userData'), 'transcripta.db')
  log.debug('Initialising PrismaClient', { dbPath })

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
  _prismaClient = new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>

  return _prismaClient
}

/**
 * Gracefully closes the database connection.
 * Should be called inside the `app.on('before-quit')` handler.
 */
export async function disconnectPrisma(): Promise<void> {
  if (!_prismaClient) return

  try {
    await _prismaClient.$disconnect()
    log.debug('PrismaClient disconnected')
  } finally {
    _prismaClient = null
  }
}

/**
 * Resets the singleton — intended for tests only.
 * @internal
 */
export function _resetPrismaClient(client?: InstanceType<typeof PrismaClient>): void {
  _prismaClient = client ?? null
}
