import { pool } from "../config/db";
import { Role, ROLES } from "../utils/roles";

// Mirrors frontend/src/components/opportunities/stages.ts STAGE_DEFAULT_PROBABILITY -
// the weighted-forecast math here has to match exactly what the
// Opportunities page itself shows for the same deals, so this is a
// deliberate hand-kept copy, not an independent guess at stage weighting.
const STAGE_DEFAULT_PROBABILITY: Record<string, number> = {
  new: 10,
  qualified: 25,
  site_visit: 40,
  proposal: 60,
  negotiation: 75,
  agreement: 90,
  won: 100,
  lost: 0,
};

const BUSINESS_TIMEZONE = "Asia/Kolkata";

interface PersonRow {
  id: string;
  name: string;
  role: string;
  designation: string | null;
  territory: string | null;
  manager_id: string | null;
  sales_team_id: string | null;
}

interface SalesTeamRow {
  id: string;
  name: string;
  region: string | null;
}

interface OpportunityAggRow {
  owner_id: string;
  stage: string;
  value: string | null;
  probability: string | null;
}

interface TargetRow {
  user_id: string;
  target_amount: string;
  achieved_amount: string;
}

export interface TeamRollupPerson {
  id: string;
  name: string;
  role: string;
  designation: string | null;
  territory: string | null;
  openDeals: number;
  pipeline: number;
  wonMtd: number;
  /** null when this person has no monthly target configured yet - never fabricated as 0%. */
  quota: { targetAmount: number; achievedAmount: number; attainmentPercent: number } | null;
}

export interface TeamRollupGroup {
  managerId: string;
  managerName: string;
  teamName: string | null;
  region: string | null;
  territories: string[];
  openDeals: number;
  pipeline: number;
  weighted: number;
  wonMtd: number;
  people: TeamRollupPerson[];
}

function monthBoundaries(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

// Real quota-attainment-by-team view, built on the same `targets` table
// (and the same achieved-amount logic) the per-person Targets section
// already uses - not a second, parallel notion of "target" invented for
// this screen. A person with no monthly target row gets `quota: null`
// ("no target set"), never a fabricated 0%.
export async function getTeamRollup(requestingUserId: string, requestingRole: Role): Promise<TeamRollupGroup[]> {
  let managerIds: string[];
  if (requestingRole === ROLES.ADMIN) {
    const result = await pool.query<{ id: string }>("SELECT id FROM users WHERE role = $1 AND status = 'active'", [ROLES.MANAGER]);
    managerIds = result.rows.map((r) => r.id);
  } else if (requestingRole === ROLES.MANAGER) {
    managerIds = [requestingUserId];
  } else {
    // Agents have no direct reports - nothing to roll up for them.
    return [];
  }
  if (managerIds.length === 0) return [];

  const peopleResult = await pool.query<PersonRow>(
    `SELECT id, name, role, designation, territory, manager_id, sales_team_id
     FROM users
     WHERE status = 'active' AND (id = ANY($1) OR manager_id = ANY($1))
     ORDER BY (manager_id IS NULL) DESC, name ASC`,
    [managerIds]
  );
  if (peopleResult.rows.length === 0) return [];
  const personIds = peopleResult.rows.map((p) => p.id);

  const salesTeamIds = Array.from(new Set(peopleResult.rows.map((p) => p.sales_team_id).filter((id): id is string => Boolean(id))));
  const salesTeamsResult = salesTeamIds.length
    ? await pool.query<SalesTeamRow>("SELECT id, name, region FROM sales_teams WHERE id = ANY($1)", [salesTeamIds])
    : { rows: [] as SalesTeamRow[] };
  const salesTeamById = new Map(salesTeamsResult.rows.map((t) => [t.id, t]));

  const oppsResult = await pool.query<OpportunityAggRow>(
    `SELECT l.owner_id, o.stage, o.value, o.probability
     FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.is_deleted = false AND l.is_deleted = false AND l.owner_id = ANY($1) AND o.stage NOT IN ('won', 'lost')`,
    [personIds]
  );

  const { start, end } = monthBoundaries();
  const wonMtdResult = await pool.query<{ owner_id: string; total: string }>(
    `SELECT l.owner_id, COALESCE(SUM(o.value), 0) AS total
     FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.is_deleted = false AND l.is_deleted = false AND l.owner_id = ANY($1)
       AND o.stage = 'won'
       AND (o.won_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date BETWEEN $2 AND $3
     GROUP BY l.owner_id`,
    [personIds, start, end]
  );
  const wonMtdByOwner = new Map(wonMtdResult.rows.map((r) => [r.owner_id, Number(r.total)]));

  const targetsResult = await pool.query<TargetRow>(
    `SELECT t.user_id, t.target_amount,
       COALESCE((
         SELECT SUM(o.value) FROM opportunities o
         JOIN leads l ON l.id = o.lead_id
         WHERE l.owner_id = t.user_id AND o.stage = 'won' AND o.is_deleted = false
           AND (o.won_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date BETWEEN t.period_start AND t.period_end
       ), 0) AS achieved_amount
     FROM targets t
     WHERE t.user_id = ANY($1) AND t.period_type = 'monthly' AND t.period_start = $2`,
    [personIds, start]
  );
  const targetByUser = new Map(targetsResult.rows.map((r) => [r.user_id, r]));

  function personMetrics(personId: string) {
    const opps = oppsResult.rows.filter((o) => o.owner_id === personId);
    const pipeline = opps.reduce((sum, o) => sum + (o.value ? Number(o.value) : 0), 0);
    const weighted = opps.reduce((sum, o) => {
      const probability = o.probability !== null ? Number(o.probability) : (STAGE_DEFAULT_PROBABILITY[o.stage] ?? 0);
      return sum + (o.value ? Number(o.value) : 0) * (probability / 100);
    }, 0);
    const targetRow = targetByUser.get(personId);
    const quota = targetRow
      ? {
          targetAmount: Number(targetRow.target_amount),
          achievedAmount: Number(targetRow.achieved_amount),
          attainmentPercent: Number(targetRow.target_amount) > 0 ? Math.round((Number(targetRow.achieved_amount) / Number(targetRow.target_amount)) * 1000) / 10 : 0,
        }
      : null;
    return { openDeals: opps.length, pipeline, weighted, wonMtd: wonMtdByOwner.get(personId) ?? 0, quota };
  }

  const groups: TeamRollupGroup[] = [];
  for (const managerId of managerIds) {
    const manager = peopleResult.rows.find((p) => p.id === managerId);
    if (!manager) continue;
    const reports = peopleResult.rows.filter((p) => p.manager_id === managerId);
    const members = [manager, ...reports];

    const memberMetrics = members.map((m) => ({ person: m, metrics: personMetrics(m.id) }));
    const people: TeamRollupPerson[] = memberMetrics.map(({ person: m, metrics }) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      designation: m.designation,
      territory: m.territory,
      openDeals: metrics.openDeals,
      pipeline: metrics.pipeline,
      wonMtd: metrics.wonMtd,
      quota: metrics.quota,
    }));

    const team = manager.sales_team_id ? salesTeamById.get(manager.sales_team_id) : undefined;
    const territories = Array.from(new Set(members.map((m) => m.territory).filter((t): t is string => Boolean(t))));

    groups.push({
      managerId: manager.id,
      managerName: manager.name,
      teamName: team?.name ?? null,
      region: team?.region ?? null,
      territories,
      openDeals: people.reduce((sum, p) => sum + p.openDeals, 0),
      pipeline: people.reduce((sum, p) => sum + p.pipeline, 0),
      weighted: memberMetrics.reduce((sum, mm) => sum + mm.metrics.weighted, 0),
      wonMtd: people.reduce((sum, p) => sum + p.wonMtd, 0),
      people,
    });
  }

  return groups;
}
