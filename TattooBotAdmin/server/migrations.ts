// server/migrations.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export async function runMigrations(db: NodePgDatabase<any>): Promise<void> {
  try { await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`); } catch {}

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS masters (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      name text NOT NULL,
      nickname text NOT NULL,
      telegram text,
      specialization text NOT NULL,
      avatar text,
      is_active boolean NOT NULL DEFAULT true
    );
  `);

  await db.execute(sql`
    ALTER TABLE masters
      ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS services (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      name text NOT NULL,
      duration integer NOT NULL,
      price integer NOT NULL,
      description text NOT NULL
    );
  `);

  await db.execute(sql`
    ALTER TABLE services
      ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bot_messages (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      key text NOT NULL UNIQUE,
      label text NOT NULL,
      value text NOT NULL,
      type text NOT NULL CHECK (type IN ('text','textarea'))
    );
  `);

  await db.execute(sql`
    ALTER TABLE bot_messages
      ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portfolio_items (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      url text NOT NULL,
      title text NOT NULL,
      master_id uuid REFERENCES masters(id) ON DELETE SET NULL,
      style text,
      thumbnail text,
      media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE portfolio_items
      ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `);

  await db.execute(sql`
    ALTER TABLE portfolio_items
      ADD COLUMN IF NOT EXISTS master_id uuid;
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'portfolio_items_master_id_fkey'
          AND table_name = 'portfolio_items'
          AND table_schema = 'public'
      ) THEN
        ALTER TABLE portfolio_items
          ADD CONSTRAINT portfolio_items_master_id_fkey
          FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE SET NULL;
      END IF;
    END;
    $$;
  `);
  await db.execute(sql`
    ALTER TABLE portfolio_items
      ADD COLUMN IF NOT EXISTS style text;
  `);
  await db.execute(sql`
    ALTER TABLE portfolio_items
      ADD COLUMN IF NOT EXISTS thumbnail text;
  `);
  await db.execute(sql`
    ALTER TABLE portfolio_items
      ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image';
  `);
  await db.execute(sql`
    ALTER TABLE portfolio_items
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.portfolio_items'::regclass
          AND contype = 'c'
          AND conname = 'portfolio_items_media_type_check'
      ) THEN
        ALTER TABLE portfolio_items
          ADD CONSTRAINT portfolio_items_media_type_check
          CHECK (media_type IN ('image','video'));
      END IF;
    END;
    $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settings (
      id text PRIMARY KEY,
      bot_token text NOT NULL DEFAULT '',
      studio_name text NOT NULL,
      address text NOT NULL,
      yandex_map_url text,
      latitude text,
      longitude text,
      payment_methods text NOT NULL DEFAULT '',
      working_hours text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bookings (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_name text NOT NULL,
      client_phone text NOT NULL,
      client_telegram text,
      master_id uuid NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
      service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      date date NOT NULL,
      time time NOT NULL,
      duration integer NOT NULL,
      status text NOT NULL CHECK (status IN ('pending','confirmed','cancelled')),
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE bookings
      ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `);

  await db.execute(sql`ALTER TABLE masters ADD COLUMN IF NOT EXISTS telegram text;`);
  await db.execute(sql`ALTER TABLE masters ADD COLUMN IF NOT EXISTS avatar text;`);
  await db.execute(sql`ALTER TABLE masters ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;`);

  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS yandex_map_url text;`);
  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS latitude text;`);
  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS longitude text;`);
  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS payment_methods text NOT NULL DEFAULT '';`);
  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS working_hours text NOT NULL DEFAULT '';`);
  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`);
}
