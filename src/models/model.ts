import { pool } from "../config/db";

export async function createTables(): Promise<void> {
  const createTableQueries = [
    `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

    `CREATE TABLE IF NOT EXISTS zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (name, zone_id)
    )`,

    `CREATE TABLE IF NOT EXISTS districts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      state_id UUID NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (name, state_id)
    )`,

    `CREATE TABLE IF NOT EXISTS areas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      district_id UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (name, district_id)
    )`,

    `CREATE TABLE IF NOT EXISTS sales_teams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) NOT NULL,
      region VARCHAR(150),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin','manager','agent')),
      designation VARCHAR(100),
      manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
      sales_team_id UUID REFERENCES sales_teams(id) ON DELETE SET NULL,
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      state_id UUID REFERENCES states(id) ON DELETE SET NULL,
      district_id UUID REFERENCES districts(id) ON DELETE SET NULL,
      area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      phone VARCHAR(20),
      alt_phone VARCHAR(20),
      email VARCHAR(255),
      website VARCHAR(255),
      preferred_language VARCHAR(50),
      company_name VARCHAR(255),
      profession VARCHAR(150),
      category VARCHAR(100),
      source VARCHAR(100),
      inquiry_category VARCHAR(100),
      inquiry_source VARCHAR(100),
      capture_channel VARCHAR(50),
      utm_tags VARCHAR(255),
      campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
      expected_value DECIMAL(12,2),
      status VARCHAR(50) NOT NULL DEFAULT 'new',
      prospect_status VARCHAR(50),
      owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      sales_team_id UUID REFERENCES sales_teams(id) ON DELETE SET NULL,
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      state_id UUID REFERENCES states(id) ON DELETE SET NULL,
      district_id UUID REFERENCES districts(id) ON DELETE SET NULL,
      area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
      pincode VARCHAR(20),
      address_line1 VARCHAR(255),
      address_line2 VARCHAR(255),
      territory VARCHAR(150),
      internal_notes TEXT,
      rm_remark TEXT,
      lg_remark TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS assignment_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      state_id UUID REFERENCES states(id) ON DELETE CASCADE,
      category VARCHAR(100),
      assigned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS lead_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      shared_with_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shared_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (lead_id, shared_with_user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS opportunities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      name VARCHAR(255),
      value DECIMAL(12,2),
      stage VARCHAR(50) NOT NULL DEFAULT 'new',
      close_date DATE,
      probability DECIMAL(5,2),
      contact_name VARCHAR(255),
      notes TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(20) NOT NULL CHECK (type IN ('call','email','teams_meeting','site_visit')),
      lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
      opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
      assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
      subject VARCHAR(255),
      due_date TIMESTAMPTZ,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      latitude DECIMAL(9,6),
      longitude DECIMAL(9,6),
      external_ref_id VARCHAR(255),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (lead_id IS NOT NULL OR opportunity_id IS NOT NULL)
    )`,

    `CREATE TABLE IF NOT EXISTS activity_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS consents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      captured BOOLEAN NOT NULL DEFAULT false,
      method VARCHAR(50),
      purposes VARCHAR(255),
      evidence_ref VARCHAR(255),
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      captured_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS location_pings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      latitude DECIMAL(9,6) NOT NULL,
      longitude DECIMAL(9,6) NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS attendance (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      check_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      check_in_latitude DECIMAL(9,6),
      check_in_longitude DECIMAL(9,6),
      check_out_at TIMESTAMPTZ,
      check_out_latitude DECIMAL(9,6),
      check_out_longitude DECIMAL(9,6),
      status VARCHAR(20) NOT NULL DEFAULT 'checked_in' CHECK (status IN ('checked_in','checked_out')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Schema evolution - additional fields captured on the New Lead form
    // (Customer / Contact / Inquiry / Store tabs), added after the initial
    // leads table was already live, same pattern as the reference mobile app.
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS qualified_person VARCHAR(255)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS financial_status VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS welcome_message_sent BOOLEAN DEFAULT false`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_score DECIMAL(5,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_store_location BOOLEAN`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS store_name VARCHAR(255)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS store_address TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS store_pincode VARCHAR(20)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS store_city VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS store_state VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS carpet_area VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS frontage VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS ownership VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS investment_capacity DECIMAL(12,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS existing_business VARCHAR(255)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS expected_opening DATE`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS gst_number VARCHAR(20)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS drug_licence_number VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS fssai_number VARCHAR(50)`,
    `ALTER TABLE consents ADD COLUMN IF NOT EXISTS notes TEXT`,

    // Indexes - grouped together here rather than scattered between tables
    `CREATE INDEX IF NOT EXISTS idx_states_zone_id ON states(zone_id)`,
    `CREATE INDEX IF NOT EXISTS idx_districts_state_id ON districts(state_id)`,
    `CREATE INDEX IF NOT EXISTS idx_areas_district_id ON areas(district_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_owner_id ON leads(owner_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_zone_id ON leads(zone_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_state_id ON leads(state_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_district_id ON leads(district_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_area_id ON leads(area_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)`,
    `CREATE INDEX IF NOT EXISTS idx_assignment_rules_state_category ON assignment_rules(state_id, category)`,
    `CREATE INDEX IF NOT EXISTS idx_lead_shares_lead_id ON lead_shares(lead_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lead_shares_user_id ON lead_shares(shared_with_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_opportunities_lead_id ON opportunities(lead_id)`,
    `CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage)`,
    `CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON activities(lead_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activities_opportunity_id ON activities(opportunity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activities_assigned_to ON activities(assigned_to)`,
    `CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_comments_activity_id ON activity_comments(activity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_consents_lead_id ON consents(lead_id)`,
    `CREATE INDEX IF NOT EXISTS idx_location_pings_user_captured ON location_pings(user_id, captured_at)`,
    `CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON attendance(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_attendance_user_status ON attendance(user_id, status)`,
  ];

  try {
    for (const query of createTableQueries) {
      await pool.query(query);
    }
    console.log("Tables created successfully");
  } catch (error) {
    console.error("Error creating tables:", error);
    throw error;
  }
}
