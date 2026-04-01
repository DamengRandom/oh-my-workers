import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.COMPANY_DB_URL })

const table = process.env.COMPANY_CLEANUP_TABLE ?? 'mockTestUsers'

const FIRST_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fiona', 'George', 'Hannah', 'Ivan', 'Julia']
const LAST_NAMES = ['Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies', 'Evans', 'Wilson', 'Thomas', 'Roberts']
const GENDERS = ['male', 'female']
const STREETS = ['George St', 'Pitt St', 'Kent St', 'Park St', 'York St', 'King St', 'Queen St', 'Market St', 'Bridge St', 'Macquarie St']
const CITIES = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomPhone(): string {
  return `04${Math.floor(10000000 + Math.random() * 90000000)}` // Just for AUS phone for test only
}

function randomUser(index: number) {
  const first = pick(FIRST_NAMES)
  const last = pick(LAST_NAMES)
  const suffix = `${Date.now()}_${index}`
  const gender = pick(GENDERS)
  const phone = Math.random() > 0.2 ? randomPhone() : null
  const address = `${Math.floor(1 + Math.random() * 99)} ${pick(STREETS)}, ${pick(CITIES)}`

  return {
    username: `${first.toLowerCase()}_${last.toLowerCase()}_${suffix}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}.${suffix}@crontest.co`,
    phone,
    address,
    gender,
  }
}

async function seedMockUsers(): Promise<void> {
  const count = Math.floor(1 + Math.random() * 5) // 1–5 random users

  console.log(`🌱 Seeding ${count} expired mock user(s) into "${table}"...`)

  for (let i = 0; i < count; i++) {
    const user = randomUser(i)
    // Random age between 31–90 days so they are always past the 30-day cleanup threshold
    const daysAgo = Math.floor(31 + Math.random() * 60)
    const expiredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
    await pool.query(
      `INSERT INTO "${table}" (username, email, phone, address, gender, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username, user.email, user.phone, user.address, user.gender, expiredAt, expiredAt],
    )
    console.log(`  ✓ Inserted: ${user.username} (${user.email}) — expired ${daysAgo} days ago`)
  }

  console.log(`✅ Seeded ${count} mock user(s) successfully.`)
  await pool.end()
}

seedMockUsers().catch((err) => {
  console.error('Fatal error during seeding:', err)
  process.exit(1)
})
