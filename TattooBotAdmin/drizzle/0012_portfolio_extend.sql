-- Extend portfolio_items with relations & media type
ALTER TABLE portfolio_items
  ADD COLUMN IF NOT EXISTS master_id uuid NULL,
  ADD COLUMN IF NOT EXISTS style text NULL,
  ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'image' NOT NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() NOT NULL;

-- optional FK if masters table exists
DO $$ BEGIN
  ALTER TABLE portfolio_items
    ADD CONSTRAINT portfolio_items_master_id_fkey
    FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;