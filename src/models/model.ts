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

    // Each salesperson's own Smartflo agent identifier (their real phone
    // number, agent ID, or extension as registered in Smartflo) - click-to-call
    // rings this number first, then connects it to the lead.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS smartflo_agent_number VARCHAR(50)`,

    // A salesperson's own territory - free text, same column shape as the
    // existing leads.territory - so a new lead can be auto-assigned to
    // whichever salesperson's territory matches it exactly. Unique (when
    // set) because a territory belongs to exactly one salesperson.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS territory VARCHAR(150)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_territory_unique ON users(territory) WHERE territory IS NOT NULL`,

    // The 4 fixed regions leads/salespeople roll up to - a short, essentially
    // static list, so it's seeded here rather than needing its own admin UI.
    `INSERT INTO zones (name) VALUES ('West'), ('North'), ('South'), ('East') ON CONFLICT (name) DO NOTHING`,

    // --- Sales Force Management: Phase 0 (DB foundation) ---
    // roles/levels/offices are deliberately minimal here - each grows its
    // own columns in the phase that actually uses them (roles gets wired to
    // auth in the Permissions phase, levels gets approval-ceiling fields in
    // the Levels & axes phase, offices gets address/GST/location-pin fields
    // in the Offices phase). Not linked to users.role or auth yet.
    `CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO roles (name) VALUES ('admin'), ('manager'), ('agent') ON CONFLICT (name) DO NOTHING`,

    `CREATE TABLE IF NOT EXISTS levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS offices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) NOT NULL UNIQUE,
      region VARCHAR(150),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // --- Sales Force Management: Phase 1A (People core) ---
    // All nullable/additive. `status` is a display/filter label only (it
    // does not gate login - is_active still does that); employee_code is
    // free text the admin types, no auto-numbering scheme exists yet.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_code_unique ON users(employee_code) WHERE employee_code IS NOT NULL`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining DATE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','onboarding'))`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES levels(id) ON DELETE SET NULL`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS office_id UUID REFERENCES offices(id) ON DELETE SET NULL`,

    // Foundation for Phase 1B (Targets): the moment an opportunity actually
    // transitions into 'won', not a user-editable expected/target close
    // date. Nullable and additive - existing opportunities already sitting
    // in 'won' have no way to know when that happened, so they stay NULL
    // rather than being backfilled with a guess.
    `ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ`,

    // Phase 1B: a person's target for one specific period. period_start/end
    // are plain calendar DATEs (not derived on the fly) so the achievement
    // query has a fixed, explicit range to compare won_at against - see
    // target-service.ts for the IST-based boundary math. The unique
    // constraint blocks a second target for the exact same person+period.
    `CREATE TABLE IF NOT EXISTS targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('monthly','quarterly','annual')),
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      target_amount DECIMAL(14,2) NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, period_type, period_start)
    )`,

    // Phase 1C: configuration only - no formula, no calculation reads these
    // tables anywhere yet. Deliberately separate from targets (no FK
    // between them) per the approved architecture: a target is what someone
    // is expected to achieve, an incentive plan is a future payout program,
    // and nothing here computes one from the other.
    `CREATE TABLE IF NOT EXISTS incentive_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) NOT NULL UNIQUE,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      effective_start_date DATE NOT NULL,
      effective_end_date DATE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (effective_end_date IS NULL OR effective_end_date >= effective_start_date)
    )`,

    // rule_type is a free-text label the admin types (e.g. "Percentage of
    // value") - never parsed or enforced. config is an empty-by-default
    // JSONB bucket for whatever a future formula needs (percentage, slab
    // boundaries, thresholds, etc.) - same "don't know the shape yet, don't
    // invent it" idea already used for activities.details elsewhere in this
    // schema. Nothing reads config today.
    `CREATE TABLE IF NOT EXISTS commission_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      incentive_plan_id UUID NOT NULL REFERENCES incentive_plans(id) ON DELETE CASCADE,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      rule_type VARCHAR(100),
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (incentive_plan_id, name)
    )`,

    // Foundation only, per the approved scope - a simple explicit
    // assignment (no overlap/uniqueness rules invented, since whether a
    // person can hold the same plan twice with a gap isn't a defined
    // business rule). No UI reads this table yet in this phase.
    `CREATE TABLE IF NOT EXISTS user_incentive_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      incentive_plan_id UUID NOT NULL REFERENCES incentive_plans(id) ON DELETE CASCADE,
      effective_start_date DATE NOT NULL,
      effective_end_date DATE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (effective_end_date IS NULL OR effective_end_date >= effective_start_date)
    )`,

    // --- Phase 2: Offices (standalone master data only - no Attendance,
    // Expenses, Leave, or any other module reads office_id yet). All
    // additive; the original `region` free-text column stays as-is for
    // backward compatibility with existing rows - it is not migrated into
    // zone_id automatically, since guess-matching text to a zone would be
    // inventing data. zone_id is the proper go-forward field, reusing the
    // real zones table rather than duplicating the region concept.
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS code VARCHAR(50)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_offices_code_unique ON offices(code) WHERE code IS NOT NULL`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS address TEXT`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES zones(id) ON DELETE SET NULL`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,

    // --- Phase 3A: permission foundation (role -> permission only) ---
    // Nothing reads this table yet - no middleware, no route, no service
    // enforces it. users.role stays the live field everything still checks;
    // this is purely additive groundwork for a later phase. Deliberately
    // NOT encoding record-level scope here (own/subtree/peer/etc.) - for
    // leads/opportunities/activities/attendance/dashboard, which have no
    // route-level role gate today, every role is granted the action
    // permission below, exactly matching current effective behavior; the
    // untouched subtree/lead_shares logic elsewhere is still what decides
    // which actual records someone can reach.
    `CREATE TABLE IF NOT EXISTS role_permissions (
      role VARCHAR(100) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
      permission VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role, permission)
    )`,

    // Seeded to reproduce the pre-Phase-3 authorization audit's documented
    // matrix exactly - not an "improved" or "sensible default" set.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','users.view'), ('admin','users.create'), ('admin','users.update'),
      ('admin','leads.view'), ('admin','leads.create'), ('admin','leads.update'), ('admin','leads.delete'), ('admin','leads.share'),
      ('admin','opportunities.view'), ('admin','opportunities.create'), ('admin','opportunities.update'), ('admin','opportunities.delete'),
      ('admin','activities.view'), ('admin','activities.create'), ('admin','activities.update'), ('admin','activities.delete'),
      ('admin','attendance.view_own'), ('admin','attendance.view_team'),
      ('admin','dashboard.view'),
      ('admin','offices.view'), ('admin','offices.create'), ('admin','offices.update'),
      ('admin','levels.view'), ('admin','levels.create'),
      ('admin','sales_teams.view'), ('admin','sales_teams.create'),
      ('admin','targets.view'), ('admin','targets.create'), ('admin','targets.update'), ('admin','targets.delete'),
      ('admin','incentive_plans.view'), ('admin','incentive_plans.create'), ('admin','incentive_plans.update'), ('admin','incentive_plans.delete'),
      ('admin','commission_rules.view'), ('admin','commission_rules.create'), ('admin','commission_rules.update'), ('admin','commission_rules.delete')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Manager: MANAGER_AND_ABOVE-gated actions (users.view, offices/levels/
    // sales_teams write, targets/incentive_plans/commission_rules view), plus
    // every leads/opportunities/activities/attendance/dashboard action since
    // those routes have no gate today for any authenticated role.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','users.view'),
      ('manager','leads.view'), ('manager','leads.create'), ('manager','leads.update'), ('manager','leads.delete'), ('manager','leads.share'),
      ('manager','opportunities.view'), ('manager','opportunities.create'), ('manager','opportunities.update'), ('manager','opportunities.delete'),
      ('manager','activities.view'), ('manager','activities.create'), ('manager','activities.update'), ('manager','activities.delete'),
      ('manager','attendance.view_own'), ('manager','attendance.view_team'),
      ('manager','dashboard.view'),
      ('manager','offices.view'), ('manager','offices.create'), ('manager','offices.update'),
      ('manager','levels.view'), ('manager','levels.create'),
      ('manager','sales_teams.view'), ('manager','sales_teams.create'),
      ('manager','targets.view'),
      ('manager','incentive_plans.view'),
      ('manager','commission_rules.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Agent: blocked today from users/targets/incentive_plans/commission_rules
    // (all MANAGER_AND_ABOVE or ADMIN_ONLY) and from write actions on offices/
    // levels/sales_teams (MANAGER_AND_ABOVE) - view-only on those three. Full
    // leads/opportunities/activities/attendance/dashboard access, matching
    // the same "no route gate today" reasoning as Manager above.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','leads.view'), ('agent','leads.create'), ('agent','leads.update'), ('agent','leads.delete'), ('agent','leads.share'),
      ('agent','opportunities.view'), ('agent','opportunities.create'), ('agent','opportunities.update'), ('agent','opportunities.delete'),
      ('agent','activities.view'), ('agent','activities.create'), ('agent','activities.update'), ('agent','activities.delete'),
      ('agent','attendance.view_own'), ('agent','attendance.view_team'),
      ('agent','dashboard.view'),
      ('agent','offices.view'),
      ('agent','levels.view'),
      ('agent','sales_teams.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // One row per salesperson who has connected their own Microsoft 365
    // account (Outlook + Teams) - each person authorizes individually via
    // delegated OAuth, so emails/meetings are sent as themselves, not a
    // shared system identity.
    `CREATE TABLE IF NOT EXISTS microsoft_connections (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ms_account_email VARCHAR(255) NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at TIMESTAMPTZ NOT NULL,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Indexes - grouped together here rather than scattered between tables
    `CREATE INDEX IF NOT EXISTS idx_states_zone_id ON states(zone_id)`,
    `CREATE INDEX IF NOT EXISTS idx_districts_state_id ON districts(state_id)`,
    `CREATE INDEX IF NOT EXISTS idx_areas_district_id ON areas(district_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
    `CREATE INDEX IF NOT EXISTS idx_users_level_id ON users(level_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_office_id ON users(office_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`,
    `CREATE INDEX IF NOT EXISTS idx_targets_user_id ON targets(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_commission_rules_plan_id ON commission_rules(incentive_plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_user_incentive_plans_user_id ON user_incentive_plans(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_user_incentive_plans_plan_id ON user_incentive_plans(incentive_plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_offices_zone_id ON offices(zone_id)`,
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

    // --- Sales Force Management rebuild, Phase 1 (People wizard + geography) ---
    // `mobile` is a general contact number - distinct from
    // smartflo_agent_number, which is specifically the telephony number used
    // for the Call button.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile VARCHAR(20)`,
    // Secondary, matrix-style reporting line (e.g. a dotted-line to a
    // functional head) alongside the primary manager_id. Nullable and
    // unused by any authorization/subtree logic - display and org-chart
    // only, same as designation/level_id.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS dotted_line_manager_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    // Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so the existing
    // status check (inline on the original ADD COLUMN) is dropped and
    // recreated with 'exited' added - safe to re-run since DROP IF EXISTS
    // never fails, and CHECK constraints don't need unique names guarded
    // separately.
    `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check`,
    `ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','on_leave','onboarding','exited'))`,

    // `states` already existed (for lead geography) but was never seeded or
    // exposed via an API - only `zones` was. Seeding a standard India
    // zone/state grouping here (not the specific, somewhat inconsistent
    // grouping shown in the reference mockup) so the Region -> State
    // drill-down in the People wizard has real options to pick from.
    // districts/areas remain untouched and unseeded - "Territory" in the
    // wizard maps to the existing free-text users.territory column, not to
    // this deeper hierarchy.
    `INSERT INTO states (name, zone_id)
     SELECT v.name, z.id FROM zones z
     JOIN (VALUES
       ('Maharashtra','West'), ('Gujarat','West'), ('Goa','West'), ('Madhya Pradesh','West'),
       ('Delhi','North'), ('Uttar Pradesh','North'), ('Punjab','North'), ('Haryana','North'),
       ('Rajasthan','North'), ('Uttarakhand','North'), ('Himachal Pradesh','North'), ('Jammu and Kashmir','North'), ('Chandigarh','North'),
       ('Karnataka','South'), ('Tamil Nadu','South'), ('Andhra Pradesh','South'), ('Telangana','South'), ('Kerala','South'), ('Puducherry','South'),
       ('West Bengal','East'), ('Odisha','East'), ('Bihar','East'), ('Jharkhand','East'), ('Assam','East')
     ) AS v(name, zone)
     ON z.name = v.zone
     ON CONFLICT (name, zone_id) DO NOTHING`,

    // --- Sales Force Management rebuild, Phase 2 (Offices enrichment) ---
    // India's official GST state codes are a fixed, published government
    // numbering (e.g. Maharashtra = 27) - real data, not invented, matching
    // the reference mockup's "Maharashtra . 27" display exactly.
    `ALTER TABLE states ADD COLUMN IF NOT EXISTS gst_code VARCHAR(2)`,
    `UPDATE states SET gst_code = v.code FROM (VALUES
       ('Jammu and Kashmir','01'), ('Himachal Pradesh','02'), ('Punjab','03'), ('Chandigarh','04'),
       ('Uttarakhand','05'), ('Haryana','06'), ('Delhi','07'), ('Rajasthan','08'), ('Uttar Pradesh','09'),
       ('Bihar','10'), ('West Bengal','19'), ('Jharkhand','20'), ('Odisha','21'), ('Assam','18'),
       ('Madhya Pradesh','23'), ('Gujarat','24'), ('Goa','30'), ('Kerala','32'), ('Tamil Nadu','33'),
       ('Puducherry','34'), ('Karnataka','29'), ('Andhra Pradesh','37'), ('Telangana','36'), ('Maharashtra','27')
     ) AS v(name, code) WHERE states.name = v.name AND states.gst_code IS NULL`,

    // office type/GST state/address breakdown/location tag - all nullable,
    // no backfill invented for offices created before this phase (same
    // "don't guess-match existing rows" rule already applied to zone_id).
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS type VARCHAR(30) CHECK (type IN ('head_office','regional_office','branch'))`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS state_id UUID REFERENCES states(id) ON DELETE SET NULL`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS address_line_2 VARCHAR(255)`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS city VARCHAR(100)`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS pincode VARCHAR(10)`,
    // Same DECIMAL(9,6) precision already used for activities/attendance
    // coordinates - the "location tag" field in the reference mockup is a
    // single lat,lng pair for field check-ins / distance-based expense
    // claims (per its own helper text), stored as two columns for real
    // distance math rather than one opaque string.
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6)`,
    `ALTER TABLE offices ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6)`,

    // --- Sales Force Management rebuild, Phase 3 (Levels & axes) ---
    // approval_ceiling is configuration only, same "foundation, not
    // enforcement" idea as incentive_plans/commission_rules - nothing reads
    // it to actually gate an approval yet (that's the later Approval bands
    // phase). headcount_limit NULL means unlimited, matching the reference
    // mockup's "1 person - unlimited" wording; current headcount itself is
    // computed from users.level_id (like offices.employeeCount), not stored.
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS headcount_limit INTEGER`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS approval_ceiling NUMERIC`,

    // Structure axes: per the approved Phase 3 scope, this is a toggle UI
    // only - Geography is the one axis with a real hierarchy behind it
    // (zones/states from Phase 1); product_division/customer_category/
    // channel are seeded as inert toggles with no lookup tables or pickers
    // anywhere else, since building those out was explicitly deferred when
    // Phase 1 scoped out Division/channel and Customer categories.
    `CREATE TABLE IF NOT EXISTS structure_axes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(50) NOT NULL UNIQUE,
      label VARCHAR(100) NOT NULL,
      description VARCHAR(255),
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO structure_axes (key, label, description, sort_order) VALUES
      ('geography', 'Geography', 'Zone -> State -> Territory', 0),
      ('product_division', 'Product division', 'No lookup data yet - toggle only', 1),
      ('customer_category', 'Customer category', 'No lookup data yet - toggle only', 2),
      ('channel', 'Channel', 'No lookup data yet - toggle only', 3)
    ON CONFLICT (key) DO NOTHING`,

    // --- Sales Force Management rebuild, Phase 4 (Permissions v2) ---
    // Per-employee grants/revokes on top of the Phase 3A role baseline.
    // Foundation only, same as role_permissions was in Phase 3A itself -
    // nothing in requirePermission consults this table yet, so an override
    // here changes what the Permissions screen SHOWS as this person's
    // effective access, not what the backend actually enforces. Rows are
    // never hard-deleted on "clear" (cleared_at/cleared_by instead) so the
    // full grant/revoke history stays queryable for the override log.
    `CREATE TABLE IF NOT EXISTS user_permission_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission VARCHAR(100) NOT NULL,
      grant_type VARCHAR(10) NOT NULL CHECK (grant_type IN ('grant','revoke')),
      reason VARCHAR(255),
      expires_at TIMESTAMPTZ,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      cleared_by UUID REFERENCES users(id) ON DELETE SET NULL,
      cleared_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user_id ON user_permission_overrides(user_id)`,

    // --- Sales Force Management rebuild, Phase 7 (Reporting lines) ---
    // Pure audit trail of manager_id changes - a row is written whenever
    // user-service.ts's updateUser actually changes someone's manager,
    // nothing more. Deliberately not an effective-dated scheduling system:
    // manager changes still take effect immediately, same as today: this
    // just remembers that they happened, for the "Transfers & history" list.
    `CREATE TABLE IF NOT EXISTS manager_change_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      old_manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
      new_manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
      changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_manager_change_log_user_id ON manager_change_log(user_id)`,

    // --- Sales Force Management rebuild, Phase 8 (Approval bands) ---
    // Configuration only, same spirit as levels.approval_ceiling (Phase 3):
    // an escalation ladder per request type, editable and visible, but not
    // consulted by any enforcement code, because FieldForce has no
    // request/workflow system anywhere today to plug it into. The UI must
    // label this "configuration only" rather than implying it's live.
    `CREATE TABLE IF NOT EXISTS approval_bands (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_type VARCHAR(30) NOT NULL CHECK (request_type IN ('discount','customer_creation','credit_limit','expense_claim')),
      band_name VARCHAR(100) NOT NULL,
      range_from NUMERIC NOT NULL DEFAULT 0,
      range_to NUMERIC,
      approver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      sla_hours INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_approval_bands_request_type ON approval_bands(request_type)`,

    // --- Sales Force Management rebuild: permission catalog retrofit ---
    // Phase 3's closeout set a standing rule for everything built afterward:
    // any new backend module wires to requirePermission from day one instead
    // of requireRole, so it actually participates in this table rather than
    // just being decoration next to routes the catalog can't influence.
    // Phases 4, 7 and 8 (role_permissions/user_permission_overrides,
    // manager_change_log, approval_bands) missed that and shipped on
    // requireRole - these rows are the retrofit, seeded to reproduce exactly
    // what those requireRole gates already allowed (see each route file for
    // the mapping) so this is a mechanism change, not a behavior change.
    // role_permissions.update and user_permission_overrides.create/.delete
    // stay admin-only in role_permissions purely for this screen's own
    // display purposes - the routes that mutate authorization data itself
    // deliberately keep requireRole(ADMIN_ONLY) as their real gate (see
    // role-permission-routes.ts / user-permission-override-routes.ts), so a
    // misconfigured grant here can never lock every admin out of fixing it.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','role_permissions.view'), ('admin','role_permissions.update'),
      ('admin','user_permission_overrides.view'), ('admin','user_permission_overrides.create'), ('admin','user_permission_overrides.delete'),
      ('admin','manager_change_log.view'),
      ('admin','approval_bands.view'), ('admin','approval_bands.create'), ('admin','approval_bands.update'), ('admin','approval_bands.delete')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','role_permissions.view'),
      ('manager','manager_change_log.view'),
      ('manager','approval_bands.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // --- Sales Force Management rebuild v2 (mockup parity pass) ---
    // levels becomes the single source for both the designation ladder AND
    // the richer "Role" concept the mockup shows (Administrator, Finance
    // and the 6 hierarchy levels all live here now). Per the user's
    // explicit decision: keep the real 3-tier security model
    // (admin/manager/agent, unchanged everywhere in the backend) and treat
    // these as display-only labels layered on top, rather than building a
    // fully dynamic custom-role system. security_tier is which of the 3
    // real tiers a level's people actually get at login. record_scope is
    // foundation-only (stored + shown on the Permissions screen, not yet
    // consulted by the real leads/opportunities/activities visibility
    // queries, which keep using the existing subtree logic) - same
    // "foundation only" pattern already used for approval_ceiling.
    // sees_label_override/approval_label_override/can_edit_label are narrow
    // free-text escape hatches for the handful of rows (Administrator,
    // Finance) whose real behavior doesn't reduce to a clean function of
    // record_scope/approval_ceiling - everywhere else those columns stay
    // NULL and the Roles & access screen derives the display text from the
    // real data instead of duplicating it.
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS security_tier VARCHAR(10) NOT NULL DEFAULT 'manager' CHECK (security_tier IN ('admin','manager','agent'))`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS is_cross_cutting BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS record_scope VARCHAR(30) NOT NULL DEFAULT 'own_and_below' CHECK (record_scope IN ('own_only','own_and_below','own_below_peers_readonly','whole_region','everything'))`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS sees_label_override VARCHAR(60)`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS approval_label_override VARCHAR(50)`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS can_edit_label VARCHAR(60)`,
    `INSERT INTO levels (name, sort_order, description, headcount_limit, approval_ceiling, security_tier, is_cross_cutting, record_scope, sees_label_override, approval_label_override, can_edit_label) VALUES
      ('Administrator', -1, 'System', NULL, NULL, 'admin', true, 'everything', NULL, 'Config only', 'All records + config'),
      ('Chief Executive Officer', 1, 'Top of the tree - sees everything', NULL, NULL, 'manager', false, 'own_and_below', NULL, NULL, 'Read-only'),
      ('Business Head', 2, 'Division owner - sets targets', 2, 10000000, 'manager', false, 'own_and_below', NULL, NULL, 'Own division'),
      ('National Sales Head', 3, 'All zones for a division', 2, 5000000, 'manager', false, 'own_and_below', NULL, NULL, 'Own tree'),
      ('Regional Sales Manager', 4, 'Zone owner - approves for the region', 4, 2500000, 'manager', false, 'own_and_below', NULL, NULL, 'Own tree'),
      ('Area Sales Manager', 5, 'Area owner - first-line approver', 4, 1000000, 'manager', false, 'own_and_below', NULL, NULL, 'Own tree'),
      ('Sales Officer', 6, 'Owns leads and customers', 4, NULL, 'agent', false, 'own_only', NULL, 'raises only', 'Own records'),
      ('Finance', 99, 'Cross-cutting', NULL, NULL, 'manager', true, 'own_and_below', 'Credit and billing', 'credit only', 'Credit fields')
    ON CONFLICT (name) DO NOTHING`,

    // Real lookup data for the Product division / Customer category axes
    // (Phase 3 left these as toggle-only with nothing behind them). The
    // wizard's single "Division / channel" field stores one combined value
    // (e.g. "Pharma - Retail") rather than two independently-picked axes,
    // matching how the reference UI actually presents that one field.
    `CREATE TABLE IF NOT EXISTS division_channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label VARCHAR(100) NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO division_channels (label, sort_order) VALUES
      ('Pharma - Retail', 0), ('Pharma - FOFO', 1), ('Pharma - PCD', 2), ('Pharma - Institutional', 3),
      ('Wellness - Retail', 4), ('Ayurvedic - Retail', 5)
    ON CONFLICT (label) DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS customer_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label VARCHAR(100) NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO customer_categories (label, sort_order) VALUES
      ('FOFO', 0), ('COCO', 1), ('Stockist', 2), ('B2B', 3), ('Institutes', 4), ('PCD', 5), ('Ethical', 6), ('Lifestyle', 7)
    ON CONFLICT (label) DO NOTHING`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS division_channel_id UUID REFERENCES division_channels(id) ON DELETE SET NULL`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_category_id UUID REFERENCES customer_categories(id) ON DELETE SET NULL`,
    `UPDATE structure_axes SET description = 'Pharma / Wellness / Ayurvedic, each with its own channel mix' WHERE key = 'product_division' AND description = 'No lookup data yet - toggle only'`,
    `UPDATE structure_axes SET description = 'FOFO / COCO / Stockist / B2B / Institutes / PCD / Ethical / Lifestyle' WHERE key = 'customer_category' AND description = 'No lookup data yet - toggle only'`,

    // Approval bands' approver moves from a specific person to a role/level
    // name, matching the reference UI - an escalation ladder names WHO
    // (by position) a request goes to, not a specific individual who might
    // leave the role. Safe to alter directly: this table only ever held
    // test data, deleted before this migration.
    `ALTER TABLE approval_bands DROP COLUMN IF EXISTS approver_user_id`,
    `ALTER TABLE approval_bands ADD COLUMN IF NOT EXISTS approver_level_id UUID REFERENCES levels(id) ON DELETE SET NULL`,
    `ALTER TABLE approval_bands ADD COLUMN IF NOT EXISTS countersigned_by_level_id UUID REFERENCES levels(id) ON DELETE SET NULL`,

    // Backs both "Transfers & history" (territory reassignment) and the
    // richer bulk re-assign modal's record-count preview. Per the user's
    // explicit decision: no new job-scheduler infrastructure - a transfer
    // is written as 'scheduled' with its effective_date, and applied
    // lazily (status flips to 'completed', the actual territory/owner
    // change is made) the next time anything reads this table, the same
    // compute-on-read spirit already used elsewhere in this rebuild.
    `CREATE TABLE IF NOT EXISTS scheduled_transfers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transfer_type VARCHAR(20) NOT NULL CHECK (transfer_type IN ('territory','bulk_reassign','exit')),
      from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      old_territory VARCHAR(150),
      new_territory VARCHAR(150),
      effective_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed')),
      lead_count INTEGER NOT NULL DEFAULT 0,
      opportunity_count INTEGER NOT NULL DEFAULT 0,
      note VARCHAR(255),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_status_date ON scheduled_transfers(status, effective_date)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_from_user ON scheduled_transfers(from_user_id)`,

    // Foundation only, same as approval_bands: FieldForce has no live
    // approval-request flow anywhere for a delegate to actually receive,
    // so this just records who covers for whom and when - configuration,
    // not enforcement.
    `CREATE TABLE IF NOT EXISTS delegations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delegate_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_delegations_user_id ON delegations(user_id)`,

    // New modules, wired to requirePermission from day one per the
    // post-Phase-3 rule. division_channels/customer_categories are plain
    // reference-data lookups with no permission gate, same precedent as
    // geography's states/zones (open read for any authenticated user).
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','territory_transfers.view'), ('admin','territory_transfers.create'),
      ('admin','delegations.view'), ('admin','delegations.create'), ('admin','delegations.delete')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','territory_transfers.view'), ('manager','territory_transfers.create'),
      ('manager','delegations.view'), ('manager','delegations.create'), ('manager','delegations.delete')
    ON CONFLICT (role, permission) DO NOTHING`,
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
