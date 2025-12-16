-- Migration: Create drivers, vehicles, live_locations, driver_status, delivery_assignments, delivery_events, sms_confirmations

BEGIN;

-- Enable pgcrypto for gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drivers
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(100) UNIQUE,
  email varchar(255),
  phone varchar(32),
  full_name varchar(200),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Driver accounts (auth)
CREATE TABLE IF NOT EXISTS driver_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
  password_hash text,
  last_login timestamptz,
  two_factor_enabled boolean DEFAULT false,
  role varchar(50) DEFAULT 'driver',
  created_at timestamptz DEFAULT now()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number varchar(64) UNIQUE,
  model varchar(128),
  capacity integer,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Driver profile
CREATE TABLE IF NOT EXISTS driver_profiles (
  driver_id uuid PRIMARY KEY REFERENCES drivers(id),
  vehicle_id uuid REFERENCES vehicles(id),
  license_number varchar(64),
  photo_url text,
  working_hours jsonb,
  preferred_area text,
  notes text
);

-- Driver status
CREATE TABLE IF NOT EXISTS driver_status (
  driver_id uuid PRIMARY KEY REFERENCES drivers(id),
  status varchar(32) NOT NULL,
  updated_at timestamptz DEFAULT now(),
  current_assignment_id uuid
);

-- Live locations (append-only)
CREATE TABLE IF NOT EXISTS live_locations (
  id bigserial PRIMARY KEY,
  driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  heading double precision,
  speed double precision,
  accuracy double precision,
  recorded_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_locations_driver_time ON live_locations(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_locations_time ON live_locations(recorded_at);

-- Delivery assignments (assumes deliveries table exists)
CREATE TABLE IF NOT EXISTS delivery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id),
  assigned_at timestamptz DEFAULT now(),
  status varchar(32) DEFAULT 'assigned',
  eta timestamptz,
  route_chunk integer DEFAULT 0
);

-- Delivery events (audit log)
CREATE TABLE IF NOT EXISTS delivery_events (
  id bigserial PRIMARY KEY,
  delivery_id uuid REFERENCES deliveries(id),
  event_type varchar(64),
  payload jsonb,
  created_at timestamptz DEFAULT now(),
  actor_type varchar(32),
  actor_id uuid
);

-- SMS confirmations/audit
CREATE TABLE IF NOT EXISTS sms_confirmations (
  id bigserial PRIMARY KEY,
  delivery_id uuid REFERENCES deliveries(id),
  phone varchar(32),
  provider varchar(50),
  message_id varchar(128),
  status varchar(32),
  attempts integer DEFAULT 0,
  last_status_at timestamptz,
  created_at timestamptz DEFAULT now(),
  metadata jsonb
);

COMMIT;
