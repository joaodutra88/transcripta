import path from 'node:path'
import { defineConfig } from 'prisma/config'

const dbPath = path.join(process.cwd(), 'prisma', 'dev.db')

export default defineConfig({
  earlyAccess: true,
  datasource: {
    url: `file:${dbPath}`,
  },
  migrate: {
    async url() {
      return `file:${dbPath}`
    },
  },
})
