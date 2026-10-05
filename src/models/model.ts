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

    // Activity calendar (Team nav) adds two more activity types on top of the
    // original four - the inline CREATE TABLE's CHECK is a no-op once the
    // table already exists, so the constraint has to be dropped and
    // recreated explicitly, same retrofit shape as every other
    // already-existing-table change in this file.
    `ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check`,
    `ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (type IN ('call','email','teams_meeting','site_visit','whatsapp','internal'))`,
    `CREATE INDEX IF NOT EXISTS idx_activities_assigned_to_due_date ON activities(assigned_to, due_date)`,

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

    // One row per issued refresh token (its id doubles as the JWT's `jti`
    // claim) - the one piece of server-side state a stateless JWT refresh
    // token needs to be revocable at all. logoutUser marks a row revoked;
    // refreshAccessToken checks revoked_at IS NULL on every refresh, so a
    // revoked token stops minting new access tokens immediately instead of
    // silently working until its own 7-day expiry.
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Indexes - grouped together here rather than scattered between tables
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)`,
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

    // --- Sales Force Management rebuild: Permissions tab, "Field & feature
    // rules" ---
    // Configuration only, same honesty convention as approval_bands and
    // record_scope: nothing in FieldForce reads these 5 columns to actually
    // gate a credit/margin field, an export button, a call-recording player
    // or a PII-masking rule, because none of those features exist anywhere
    // in the product yet. They're stored per level so the Permissions
    // screen's toggles have somewhere real to write to and read back from,
    // clearly labeled as not-yet-enforced in the UI. "Bulk re-assign
    // records" is deliberately NOT one of these columns - that one mirrors
    // the real leads.update permission directly (see PermissionsCard.tsx)
    // rather than risking two disconnected toggles claiming to control the
    // same thing.
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS see_credit_fields BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS see_margin_fields BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS can_export BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS can_view_call_recordings BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE levels ADD COLUMN IF NOT EXISTS can_see_unmasked_pii BOOLEAN NOT NULL DEFAULT true`,

    // --- Create user wizard: Targets & incentives tab parity pass ---
    // Configuration only, same convention as everything else marked this
    // way: FieldForce has no payout engine, so rate/cap/pays-from are
    // stored and shown but nothing computes an actual incentive amount
    // from them.
    `ALTER TABLE user_incentive_plans ADD COLUMN IF NOT EXISTS rate VARCHAR(50)`,
    `ALTER TABLE user_incentive_plans ADD COLUMN IF NOT EXISTS cap_per_cycle NUMERIC`,
    `ALTER TABLE user_incentive_plans ADD COLUMN IF NOT EXISTS pays_from_attainment_percent NUMERIC`,

    // A per-employee commission arrangement - distinct from commission_rules
    // (Phase 3's shared catalog tied to an incentive_plan): this is what the
    // Create/Edit user wizard's own "Commissions" section configures for
    // one specific person. Configuration only, same as above - no payout
    // engine reads this either.
    `CREATE TABLE IF NOT EXISTS user_commissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      basis VARCHAR(30) NOT NULL CHECK (basis IN ('collected_revenue','invoiced_revenue','gross_margin','units_sold')),
      rate VARCHAR(50),
      applies_to VARCHAR(100),
      payout_cycle VARCHAR(20) NOT NULL CHECK (payout_cycle IN ('monthly','quarterly','half_yearly','annual')),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_commissions_user_id ON user_commissions(user_id)`,

    // New module, wired to requirePermission from day one per the
    // post-Phase-3 rule - same gate shape as user_incentive_plans (its
    // sibling in the same wizard tab): manager+ view their own subtree,
    // only admin assigns.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','user_commissions.view'), ('admin','user_commissions.create'), ('admin','user_commissions.delete')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','user_commissions.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Purely descriptive - "12 franchises" alongside a currency target,
    // never read by the achievement calculation (which stays exactly the
    // won-opportunity-value SUM it already was). Free text because a unit
    // target's unit varies by role (franchises, units, visits...).
    `ALTER TABLE targets ADD COLUMN IF NOT EXISTS unit_target VARCHAR(100)`,

    // --- FOFO onboarding handoff ---
    // A FOFO-category lead becomes a franchise store application, walked
    // through Applicant -> Store information -> Documents & KYC ->
    // Commercials -> Approval & push. Reuses the store_*/carpet_area/
    // frontage/ownership/gst_number/pan_number columns already on `leads`
    // (added earlier for the New Lead form's Store tab) - only genuinely
    // new fields are added below.
    `CREATE SEQUENCE IF NOT EXISTS lead_number_seq`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_number INTEGER`,
    `ALTER TABLE leads ALTER COLUMN lead_number SET DEFAULT nextval('lead_number_seq')`,
    // Backfills any lead created before this column existed - safe to run
    // every startup since the WHERE clause skips rows that already have one.
    `UPDATE leads SET lead_number = nextval('lead_number_seq') WHERE lead_number IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_lead_number ON leads(lead_number)`,

    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(20)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS nearest_coco_store VARCHAR(255)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS signage_status VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS security_deposit DECIMAL(12,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS opening_stock DECIMAL(12,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS margin_slab VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS credit_limit_requested DECIMAL(12,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS credit_category VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS target_go_live DATE`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS push_status VARCHAR(20) NOT NULL DEFAULT 'not_pushed' CHECK (push_status IN ('not_pushed','pushed'))`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS onboarding_app_id VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ`,

    // Sequential named-approver chain for one lead's handoff - deliberately
    // NOT built on approval_bands (that stays a flat, level-based config
    // table with no real request/workflow behind it). Approvers here are
    // derived from the real manager_id chain above the lead's owner at the
    // moment onboarding starts (reporting manager, then their manager, then
    // the topmost person in that line) - never a fabricated "Ops" role,
    // since FieldForce has no such role. The third step's status starts
    // 'not_applicable' unless the lead's real expected_value exceeds
    // 1,500,000 (matching the reference's "value > ₹15L" condition, applied
    // for real rather than shown as static text).
    `CREATE TABLE IF NOT EXISTS lead_approval_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      role_label VARCHAR(100) NOT NULL,
      approver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','not_applicable')),
      condition_note VARCHAR(255),
      decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (lead_id, step_order)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lead_approval_steps_lead_id ON lead_approval_steps(lead_id)`,

    // Real per-document status + file, replacing DocumentsTab.tsx's
    // component-state-only mock. One row per document type per lead,
    // created on first view (same lazy-create spirit as
    // scheduled-transfer-service's applyDueTransfers).
    `CREATE TABLE IF NOT EXISTS lead_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      doc_type VARCHAR(30) NOT NULL CHECK (doc_type IN ('pan_card','gst_certificate','shop_photos','rent_agreement','cancelled_cheque','consent_form')),
      status VARCHAR(20) NOT NULL DEFAULT 'not_uploaded' CHECK (status IN ('not_uploaded','in_review','verified','missing')),
      file_path VARCHAR(500),
      original_filename VARCHAR(255),
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ,
      notes VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (lead_id, doc_type)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lead_documents_lead_id ON lead_documents(lead_id)`,

    // New module, wired to requirePermission from day one per the
    // post-Phase-3 rule. Agents get view+upload_document (they're the ones
    // on the ground with the applicant's paperwork) but not manage
    // (approve/reject/push stays a manager+ decision, same split as the
    // rest of the app's approval-adjacent actions).
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','fofo_onboarding.view'), ('admin','fofo_onboarding.manage'), ('admin','fofo_onboarding.upload_document')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','fofo_onboarding.view'), ('manager','fofo_onboarding.manage'), ('manager','fofo_onboarding.upload_document')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','fofo_onboarding.view'), ('agent','fofo_onboarding.upload_document')
    ON CONFLICT (role, permission) DO NOTHING`,

    // --- Reports ---
    // A named filter preset a user saves for themselves - "Save view" in the
    // reference. Personal, not shared (no team-visibility model was asked
    // for), so it's just scoped to user_id with no sharing table.
    `CREATE TABLE IF NOT EXISTS saved_report_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_key VARCHAR(50) NOT NULL,
      name VARCHAR(150) NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_saved_report_views_user_id ON saved_report_views(user_id)`,

    // New module, wired to requirePermission from day one. Governance-style
    // screen like Approvals/Approval bands - admin+manager only, same as
    // those, not agent-visible.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','reports.view'), ('admin','reports.save_view')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','reports.view'), ('manager','reports.save_view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // --- WhatsApp messaging ---
    // Every inbound/outbound WhatsApp message against a lead, shown as a
    // chat thread on the lead's WhatsApp tab. direction distinguishes who
    // sent it; wa_message_id is the id the provider assigns to an outbound
    // send (returned in their API response) or an inbound message (present
    // in their webhook payload) - used to de-duplicate webhook retries and
    // to match delivery/read status updates back to the right row.
    `CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
      body TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read','failed','received')),
      wa_message_id VARCHAR(255) UNIQUE,
      sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id ON whatsapp_messages(lead_id)`,

    // New module, wired to requirePermission from day one. Agents get both
    // view and send - they're the ones messaging their own leads; manager
    // and admin inherit the same pair for now, no separate "manage" action
    // exists yet.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','whatsapp.view'), ('admin','whatsapp.send')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','whatsapp.view'), ('manager','whatsapp.send')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','whatsapp.view'), ('agent','whatsapp.send')
    ON CONFLICT (role, permission) DO NOTHING`,

    // --- Leave management ---
    // Four real, balance-tracked types (casual/sick/earned/comp_off) plus
    // two special request kinds handled only on leave_requests.kind
    // (half_day, wfh) that never draw from any entitlement - see
    // leave-service.ts's KIND_CONSUMES_ENTITLEMENT. Configurable, not
    // hardcoded - an admin can adjust the day counts/policy text later
    // without a code change, same spirit as levels.approval_ceiling.
    `CREATE TABLE IF NOT EXISTS leave_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(20) NOT NULL UNIQUE CHECK (key IN ('casual','sick','earned','comp_off')),
      label VARCHAR(50) NOT NULL,
      color VARCHAR(20) NOT NULL,
      annual_days NUMERIC(4,1),
      accrual_per_month NUMERIC(3,1),
      carry_forward_cap NUMERIC(4,1),
      max_consecutive_days INT,
      notice_days INT,
      medical_note_after_days INT,
      expires_after_days INT,
      requires_second_approver BOOLEAN NOT NULL DEFAULT false,
      policy_note VARCHAR(200) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO leave_types (key, label, color, annual_days, accrual_per_month, carry_forward_cap, max_consecutive_days, notice_days, medical_note_after_days, expires_after_days, requires_second_approver, policy_note, sort_order) VALUES
      ('casual', 'Casual leave', '#1354e0', 12, NULL, NULL, 3, 2, NULL, NULL, false, 'Max 3 at a stretch, 2 days notice', 1),
      ('sick', 'Sick leave', '#12a150', 8, NULL, NULL, NULL, NULL, 2, NULL, false, 'Medical note beyond 2 days', 2),
      ('earned', 'Earned leave', '#6d4ecf', 18, 1.5, 30, NULL, NULL, NULL, NULL, true, 'Accrues 1.5 per month, carry forward 30', 3),
      ('comp_off', 'Comp off', '#dc8a00', NULL, NULL, NULL, NULL, NULL, NULL, 60, false, 'From weekend field work, expires in 60 days', 4)
    ON CONFLICT (key) DO NOTHING`,

    // kind covers the 4 real types plus half_day/wfh, which carry no
    // leave_type row of their own. approver_id/second_approver_id are
    // snapshotted from the requester's manager_id/skip-level manager_id at
    // creation time (not re-resolved later) so a manager change mid-request
    // doesn't retroactively change who was responsible for the decision -
    // same snapshot convention scheduled_transfers already uses. Only
    // earned-leave requests populate second_approver_id; every other kind
    // resolves on the first decision alone.
    `CREATE TABLE IF NOT EXISTS leave_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('casual','sick','earned','comp_off','half_day','wfh')),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      days_count NUMERIC(4,1) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      cover_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
      approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
      approver_decision VARCHAR(20) CHECK (approver_decision IN ('approved','rejected')),
      approver_decided_at TIMESTAMPTZ,
      second_approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
      second_approver_decision VARCHAR(20) CHECK (second_approver_decision IN ('approved','rejected')),
      second_approver_decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id ON leave_requests(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leave_requests_approver_id ON leave_requests(approver_id)`,

    // A comp-off day is earned, not allotted - there's no fixed annual
    // number the way casual/sick/earned have one, so balance is computed
    // as unexpired credits minus approved comp_off requests rather than
    // read off leave_types.annual_days (which is NULL for this type).
    `CREATE TABLE IF NOT EXISTS comp_off_credits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      earned_date DATE NOT NULL,
      days NUMERIC(3,1) NOT NULL DEFAULT 1,
      granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
      reason VARCHAR(255),
      expires_at DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comp_off_credits_user_id ON comp_off_credits(user_id)`,

    // New module, wired to requirePermission from day one per the
    // post-Phase-3 rule. Everyone can view policy and their own
    // requests/apply; only a manager+ can approve a report's request or
    // grant them a comp-off day; only admin can edit the leave_types policy
    // itself.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','leave_types.view'), ('admin','leave_types.manage'),
      ('admin','leave_requests.view'), ('admin','leave_requests.create'), ('admin','leave_requests.update'), ('admin','leave_requests.approve'),
      ('admin','comp_off_credits.view'), ('admin','comp_off_credits.grant')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','leave_types.view'),
      ('manager','leave_requests.view'), ('manager','leave_requests.create'), ('manager','leave_requests.update'), ('manager','leave_requests.approve'),
      ('manager','comp_off_credits.view'), ('manager','comp_off_credits.grant')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','leave_types.view'),
      ('agent','leave_requests.view'), ('agent','leave_requests.create'), ('agent','leave_requests.update'),
      ('agent','comp_off_credits.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // --- Expense claims ---
    // Same configurable-catalog shape as leave_types - an admin can adjust
    // limits/policy text later without a code change. metro_limit_amount is
    // Lodging-only (a metro-city override on top of its base limit_amount);
    // every other type leaves it null.
    `CREATE TABLE IF NOT EXISTS expense_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(30) NOT NULL UNIQUE CHECK (key IN ('travel','fuel','lodging','meals','client_entertainment','telecom','marketing_collateral')),
      label VARCHAR(50) NOT NULL,
      color VARCHAR(20) NOT NULL,
      limit_amount NUMERIC(10,2) NOT NULL,
      limit_unit VARCHAR(20) NOT NULL CHECK (limit_unit IN ('trip','km','night','day','meeting','month')),
      metro_limit_amount NUMERIC(10,2),
      receipt_required BOOLEAN NOT NULL DEFAULT true,
      requires_linked_opportunity BOOLEAN NOT NULL DEFAULT false,
      policy_note VARCHAR(200) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO expense_types (key, label, color, limit_amount, limit_unit, metro_limit_amount, receipt_required, requires_linked_opportunity, policy_note, sort_order) VALUES
      ('travel', 'Travel', '#1354e0', 8000, 'trip', NULL, true, false, 'Air or rail, sleeper class and above', 1),
      ('fuel', 'Fuel', '#e0393e', 12, 'km', NULL, true, false, 'Own vehicle, GPS distance verified', 2),
      ('lodging', 'Lodging', '#6d4ecf', 3500, 'night', 5000, true, false, 'Metro cities up to ₹5,000', 3),
      ('meals', 'Meals', '#12a150', 600, 'day', NULL, false, false, 'Field days only', 4),
      ('client_entertainment', 'Client entertainment', '#0284c7', 2500, 'meeting', NULL, true, true, 'Needs the linked opportunity', 5),
      ('telecom', 'Telecom', '#6b7280', 500, 'month', NULL, true, false, 'Reimbursed with the bill', 6),
      ('marketing_collateral', 'Marketing collateral', '#dc8a00', 5000, 'month', NULL, true, false, 'Standees, brochures, QR print', 7)
    ON CONFLICT (key) DO NOTHING`,

    // is_policy_breach/policy_limit_at_submission are computed once at
    // filing time and stored, not recomputed live - a claim's breach status
    // reflects the policy that was actually in force when it was filed, so
    // an admin editing expense_types.limit_amount later doesn't silently
    // rewrite history. approver_id/second_approver_id follow the exact same
    // snapshot-at-creation and two-tier-decision shape leave_requests uses;
    // second_approver_id here is resolved from approval_bands
    // (request_type='expense_claim') when a configured band for this
    // amount calls for someone more senior than the direct manager -
    // approval_bands existed since Phase 8 but nothing ever actually read
    // it for a live decision until this table (see approval-band-service.ts).
    // A friendly, sequential "EXP-2618" style code - same sequence-backed
    // pattern leads.lead_number already uses, not a random/UUID-derived one.
    `CREATE SEQUENCE IF NOT EXISTS expense_claim_number_seq`,
    `CREATE TABLE IF NOT EXISTS expense_claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expense_type_key VARCHAR(30) NOT NULL REFERENCES expense_types(key),
      title VARCHAR(200) NOT NULL,
      expense_date DATE NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      quantity NUMERIC(10,2),
      linked_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      linked_opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
      receipt_file_path VARCHAR(500),
      receipt_original_filename VARCHAR(255),
      is_policy_breach BOOLEAN NOT NULL DEFAULT false,
      policy_limit_at_submission NUMERIC(10,2),
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
      approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
      approver_decision VARCHAR(20) CHECK (approver_decision IN ('approved','rejected')),
      approver_decided_at TIMESTAMPTZ,
      second_approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
      second_approver_decision VARCHAR(20) CHECK (second_approver_decision IN ('approved','rejected')),
      second_approver_decided_at TIMESTAMPTZ,
      decision_note VARCHAR(500),
      paid_by UUID REFERENCES users(id) ON DELETE SET NULL,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // Retrofit-safe the same way leads.lead_number is: CREATE TABLE IF NOT
    // EXISTS is a no-op once the table already exists from an earlier run,
    // so a column added to that definition later never actually appears
    // without an explicit ALTER TABLE alongside it.
    `ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS claim_number INTEGER`,
    `ALTER TABLE expense_claims ALTER COLUMN claim_number SET DEFAULT nextval('expense_claim_number_seq')`,
    `UPDATE expense_claims SET claim_number = nextval('expense_claim_number_seq') WHERE claim_number IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_claims_claim_number ON expense_claims(claim_number)`,
    `CREATE INDEX IF NOT EXISTS idx_expense_claims_user_id ON expense_claims(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_expense_claims_approver_id ON expense_claims(approver_id)`,

    // New module, wired to requirePermission from day one. mark_paid is its
    // own permission (not folded into approve) since finance-style payout
    // is a distinct action from a manager's approval decision - admin only
    // for now, the same way no separate "finance" role exists anywhere else
    // in FieldForce's 3-tier model.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','expense_types.view'), ('admin','expense_types.manage'),
      ('admin','expense_claims.view'), ('admin','expense_claims.create'), ('admin','expense_claims.update'), ('admin','expense_claims.approve'), ('admin','expense_claims.mark_paid')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','expense_types.view'),
      ('manager','expense_claims.view'), ('manager','expense_claims.create'), ('manager','expense_claims.update'), ('manager','expense_claims.approve')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','expense_types.view'),
      ('agent','expense_claims.view'), ('agent','expense_claims.create'), ('agent','expense_claims.update')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Settings > Templates - a real, admin-editable library backing the
    // Activity calendar's email compose drawer, which previously had these
    // same 4 templates hardcoded in frontend code. "Blank email" isn't a
    // stored row - it's just "no template selected" in that drawer.
    `CREATE TABLE IF NOT EXISTS message_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp')),
      trigger_note VARCHAR(200),
      subject VARCHAR(255),
      body TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft')),
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO message_templates (key, name, channel, trigger_note, subject, body, status, sort_order) VALUES
      ('fofo_intro', 'FOFO intro pack', 'email', 'Sent on lead qualification',
       'FOFO franchise — details and next steps',
       'Dear {{firstName}},

Thank you for your interest in a franchise with us. I''ve attached our FOFO franchise pack, which covers the investment range, margin slabs and the support we provide on interiors and signage.

{{storeLine}}

Let me know a good time for a call or site visit this week.

Regards,', 'active', 1),
      ('site_visit_confirmation', 'Site visit confirmation', 'email', 'Sent manually before a scheduled visit',
       'Site visit confirmed — {{storeAddress}}',
       'Dear {{firstName}},

Confirming our site visit at {{storeAddress}} on {{visitTime}}. Please keep the rent agreement and shop measurements handy.

Let me know if anything changes on your end.

Regards,', 'active', 2),
      ('commercial_proposal', 'Commercial proposal', 'email', 'Manual send by salesperson',
       'Commercial proposal — {{storeName}}',
       'Dear {{firstName}},

As discussed, here is our commercial proposal{{proposalDetails}}.

The proposal is valid for 30 days. Happy to walk through it on a call this week.

Regards,', 'active', 3),
      ('consent_dpdp', 'Consent request (DPDP)', 'email', 'Sent when consent is missing',
       'Your consent for communication',
       'Dear {{firstName}},

To keep you updated on your enquiry, we need your consent to contact you by phone, WhatsApp and email. You can withdraw it at any time by replying to this email.

Please reply "confirm" to this email to record your consent.

Regards,', 'active', 4)
    ON CONFLICT (key) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','message_templates.view'), ('admin','message_templates.manage')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','message_templates.view')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','message_templates.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Settings > Stages. leads.status and opportunities.stage were both
    // always plain free-text columns (no CHECK constraint ever existed
    // restricting them) - only the frontend's hardcoded LEAD_STATUS_VALUES
    // array enforced a fixed list, in the lead form and the status filter.
    // This table replaces that array as the real source of truth; the two
    // frontend spots that read it now fetch from here instead. Seeded with
    // the pipeline's real current 9 stages (not the reference mockup's
    // different 6-stage list, which drops several of these and adds a
    // stage - "Onboarding handoff" - with no automation behind it here).
    `CREATE TABLE IF NOT EXISTS pipeline_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(50) NOT NULL UNIQUE,
      label VARCHAR(100) NOT NULL,
      description VARCHAR(255),
      probability INT NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO pipeline_stages (key, label, description, probability, sort_order) VALUES
      ('New', 'New', 'Just captured, not yet worked', 5, 1),
      ('Open', 'Open', 'Being actively followed up', 15, 2),
      ('Qualified', 'Qualified', 'Investment capacity and category verified', 30, 3),
      ('Site visit', 'Site visit', 'Store or premises inspection scheduled or done', 45, 4),
      ('Proposal', 'Proposal', 'Commercial terms shared', 60, 5),
      ('Negotiation', 'Negotiation', 'Terms being worked out', 75, 6),
      ('Agreement', 'Agreement', 'Legal and deposit in progress', 90, 7),
      ('Converted', 'Converted', 'Won - became a customer', 100, 8),
      ('Closed Lost', 'Closed Lost', 'Did not convert', 0, 9)
    ON CONFLICT (key) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','pipeline_stages.view'), ('admin','pipeline_stages.manage')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','pipeline_stages.view')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','pipeline_stages.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Settings > Categories - same shape and same real reason as Stages:
    // leads.category was always plain free text, never a CHECK constraint,
    // only enforced by the frontend's hardcoded LEAD_CATEGORY_VALUES array.
    // Seeded with the real current 8 categories, not the reference mockup's
    // different 6 (which merges Ethical+PCD into one and drops Lifestyle).
    `CREATE TABLE IF NOT EXISTS lead_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(50) NOT NULL UNIQUE,
      label VARCHAR(100) NOT NULL,
      description VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO lead_categories (key, label, description, sort_order) VALUES
      ('COCO', 'COCO', 'Company owned, company operated', 1),
      ('FOFO', 'FOFO', 'Franchise owned, franchise operated', 2),
      ('Stockist', 'Stockist', 'Regional distribution partner', 3),
      ('B2B', 'B2B', 'Corporate and chain accounts', 4),
      ('Lifestyle', 'Lifestyle', 'Lifestyle retail accounts', 5),
      ('Institutes', 'Institutes', 'Hospitals, colleges, government', 6),
      ('PCD', 'PCD', 'Propaganda cum distribution channel', 7),
      ('Ethical', 'Ethical', 'Branded pharma trade channel', 8)
    ON CONFLICT (key) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','lead_categories.view'), ('admin','lead_categories.manage')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','lead_categories.view')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('agent','lead_categories.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Settings > Assignment rules - real admin CRUD on top of the
    // assignment_rules table lead-service.ts's resolveAutoAssignee has
    // already been reading for auto-assignment since before this Settings
    // page existed. No new matching logic here, only a way to see/edit
    // those same rules instead of only being able to set them by hand in
    // the database.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','assignment_rules.view'), ('admin','assignment_rules.manage')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','assignment_rules.view')
    ON CONFLICT (role, permission) DO NOTHING`,
    // Retrofit, same reason every other ALTER-after-the-fact in this file
    // exists: assignment_rules already existed from an earlier phase, so
    // this column has to be added explicitly rather than folded into its
    // original CREATE TABLE. Lets a rule be paused without deleting it -
    // resolveAutoAssignee (lead-service.ts) now skips inactive rules too.
    `ALTER TABLE assignment_rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`,

    // Settings > Approvals. A small generic key/value store, not a
    // dedicated table for this one threshold - the same shape can hold
    // whatever the next scalar setting turns out to be, instead of a new
    // single-purpose table every time. Seeded with the real value
    // fofo-onboarding-service.ts's HIGH_VALUE_THRESHOLD was hardcoded to;
    // that file now reads this row instead of the constant.
    `CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `INSERT INTO app_settings (key, value) VALUES ('high_value_deal_threshold', '1500000') ON CONFLICT (key) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','app_settings.view'), ('admin','app_settings.manage')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','app_settings.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Settings > QR lead capture. `campaigns` already existed (leads.campaign_id
    // has referenced it since the original schema) but had no service, controller
    // or route anywhere - nothing ever wrote a row to it. This is the first real
    // feature to use it, so it's extended in place with ALTER rather than
    // creating a second, competing "campaign" concept.
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS code VARCHAR(60)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_code ON campaigns(code) WHERE code IS NOT NULL`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS placement VARCHAR(255)`,
    // Fixed per-campaign, not visitor-chosen - a walk-in scanning a decal at
    // a specific store/booth shouldn't have to pick from FieldForce's
    // internal category taxonomy (COCO/FOFO/Stockist/...); the admin sets
    // what this code is for once, at creation.
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS default_category VARCHAR(100)`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS default_owner_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS utm_tags VARCHAR(255)`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS require_consent BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS capture_scan_location BOOLEAN NOT NULL DEFAULT true`,
    // Which of the non-baseline capture-form fields are shown to the visitor.
    // Full name / mobile / city-pincode / business category / DPDP consent are
    // always shown and required - not part of this config.
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS field_config JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`,
    `ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check`,
    `ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check CHECK (status IN ('active','paused'))`,
    // Real, incremented on every public scan (GET /public/qr/:code) before the
    // visitor even sees the form - lets "scans" and "leads captured" diverge
    // instead of always being equal, same as the reference's stat cards.
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scan_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','qr_campaigns.view'), ('admin','qr_campaigns.manage')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','qr_campaigns.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Audit & consent. manager_change_log already proved the "immutable log
    // of one specific field" pattern (real, but narrow - only ever
    // user.manager_id, and it turned out to have no frontend consumer at
    // all). This is the first genuinely generic version: one row per real
    // change to a real field on a real entity, across leads, approvals and
    // assignment rules. actor_name and entity_label are snapshotted at write
    // time - deliberately, since a later rename/deactivation of that user or
    // lead shouldn't rewrite what an old audit row appears to say.
    `CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type VARCHAR(50) NOT NULL,
      entity_id UUID NOT NULL,
      entity_label VARCHAR(255),
      action VARCHAR(50) NOT NULL,
      summary VARCHAR(500) NOT NULL,
      old_value VARCHAR(255),
      new_value VARCHAR(255),
      actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      actor_name VARCHAR(255),
      ip_address VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','audit_log.view')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','audit_log.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Team > Dashboard. Gated the same as Leave/Expense's team views -
    // admin+manager only, never agent, since it shows a manager's team's
    // leave and activity data.
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','team_dashboard.view')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','team_dashboard.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Website lead capture - a second real source type on the same
    // `campaigns` table QR lead capture already extended, discriminated by
    // source_type. A QR code is meant to be public (embedded in a printed
    // image), so it uses a short, friendly `code`; a website source's
    // credential instead has to stay secret (it's a bearer token an
    // external site's server/browser code holds), so it gets its own
    // longer `api_key` column rather than reusing `code` for both.
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) NOT NULL DEFAULT 'qr'`,
    `ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_source_type_check`,
    `ALTER TABLE campaigns ADD CONSTRAINT campaigns_source_type_check CHECK (source_type IN ('qr','website'))`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS api_key VARCHAR(64)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_api_key ON campaigns(api_key) WHERE api_key IS NOT NULL`,
    // Informational/defense-in-depth only - the real access control is
    // possession of api_key, same trust model QR's public code already
    // uses. Browsers enforce CORS from this value; a direct server-to-server
    // POST could still spoof an Origin header, so this is not relied on as
    // the sole guard.
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS allowed_origin VARCHAR(255)`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','website_lead_sources.view'), ('admin','website_lead_sources.manage')
    ON CONFLICT (role, permission) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('manager','website_lead_sources.view')
    ON CONFLICT (role, permission) DO NOTHING`,

    // Quotes module. A quote is never edited in place - every save inserts
    // a new quote_versions row (line_items as a JSONB snapshot, same
    // established pattern as audit_log's old_value/new_value) so "what did
    // we actually quote this customer on date X" is always answerable,
    // never silently overwritten. quotes.current_version is a plain pointer
    // kept in sync by quote-service, not a generated column, since each
    // version's totals are computed and validated server-side at write time
    // rather than re-derived by a trigger.
    `CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1`,
    `CREATE TABLE IF NOT EXISTS quotes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_number INTEGER NOT NULL DEFAULT nextval('quote_number_seq'),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected')),
      current_version INTEGER NOT NULL DEFAULT 1,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_quote_number ON quotes(quote_number)`,
    `CREATE INDEX IF NOT EXISTS idx_quotes_lead_id ON quotes(lead_id)`,
    `CREATE INDEX IF NOT EXISTS idx_quotes_opportunity_id ON quotes(opportunity_id)`,
    `CREATE TABLE IF NOT EXISTS quote_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      line_items JSONB NOT NULL,
      subtotal DECIMAL(14,2) NOT NULL,
      tax_total DECIMAL(14,2) NOT NULL,
      grand_total DECIMAL(14,2) NOT NULL,
      notes TEXT,
      change_summary TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (quote_id, version_number)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_quote_versions_quote_id ON quote_versions(quote_id)`,
    `INSERT INTO role_permissions (role, permission) VALUES
      ('admin','quotes.view'), ('admin','quotes.create'), ('admin','quotes.update'),
      ('manager','quotes.view'), ('manager','quotes.create'), ('manager','quotes.update'),
      ('agent','quotes.view'), ('agent','quotes.create'), ('agent','quotes.update')
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
