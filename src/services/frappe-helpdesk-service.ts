import crypto from "crypto";
import { pool } from "../config/db";
import { ROLES } from "../utils/roles";
import { externalFetch } from "../utils/external-fetch";
import { recordAuditEvent } from "./audit-log-service";

// Keeps Frappe Helpdesk's people in step with FieldForce, so nobody ever
// has to be added to Helpdesk by hand:
//  - Employees: an Admin is a Helpdesk "Agent Manager" (all tickets, settings),
//    anyone else whose role holds support_tickets.view (Field Sales) is an
//    "Agent", and everyone else (Call Center, deactivated people) is not an
//    agent. Combined with SSO (sso-service.ts) they land straight on the
//    agent screen with no Frappe login.
//  - Customers: when a lead becomes a Customer with an email address, they
//    get a Helpdesk customer account (HD Customer + Contact + portal user) and
//    log in to the support portal by email link - no password, ever.
//
// Every call is idempotent (safe to repeat) and never blocks the CRM: a
// failure is logged, the last-synced marker isn't advanced, and the periodic
// reconcile (startHelpdeskSyncScheduler) simply tries again later.

type HelpdeskAccess = "agent_manager" | "agent" | "none";

const AGENT_ROLE = "Agent";
const AGENT_MANAGER_ROLE = "Agent Manager";
const CUSTOMER_ROLE = "HD Customer";

class FrappeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function frappeConfig(): { base: string; auth: string } | null {
  const base = process.env.FRAPPE_BASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.FRAPPE_API_KEY?.trim();
  const secret = process.env.FRAPPE_API_SECRET?.trim();
  if (!base || !key || !secret) return null;
  return { base, auth: `token ${key}:${secret}` };
}

// Deliberately opt-in per server: every environment (a developer's laptop,
// devcrm, skiacrm) can point at the same real Frappe site, and only the one
// that "owns" Helpdesk may push its people into it - otherwise starting a
// local backend would turn every local test account into a real Helpdesk
// agent. Set HELPDESK_SYNC_ENABLED=true only on that one server.
export function isHelpdeskSyncConfigured(): boolean {
  return process.env.HELPDESK_SYNC_ENABLED?.trim().toLowerCase() === "true" && frappeConfig() !== null;
}

async function frappe<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const config = frappeConfig();
  if (!config) throw new FrappeError("Frappe Helpdesk is not configured (FRAPPE_BASE_URL / FRAPPE_API_KEY / FRAPPE_API_SECRET)", 503);
  const send = () =>
    externalFetch(`${config.base}${path}`, {
      method,
      headers: { Authorization: config.auth, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  // Frappe Cloud occasionally drops a connection outright ("fetch failed").
  // A read is safe to repeat, so retry it a couple of times; writes are not
  // retried here (the caller's next sync/reconcile picks them up instead).
  let response: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await send();
      break;
    } catch (err) {
      if (method !== "GET" || attempt >= 3 || !(err instanceof TypeError)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  const json = (await response.json().catch(() => null)) as { data?: T; message?: T; exception?: string; _server_messages?: string } | null;
  if (!response.ok) {
    const detail = json?.exception ?? json?._server_messages ?? response.statusText;
    throw new FrappeError(`Frappe ${method} ${path.split("?")[0]} failed (${response.status}): ${String(detail).slice(0, 300)}`, response.status);
  }
  return (json?.data ?? json?.message) as T;
}

const resource = (doctype: string, name?: string) =>
  `/api/resource/${encodeURIComponent(doctype)}${name === undefined ? "" : `/${encodeURIComponent(name)}`}`;

async function getDoc<T>(doctype: string, name: string): Promise<T | null> {
  try {
    return await frappe<T>("GET", resource(doctype, name));
  } catch (err) {
    if (err instanceof FrappeError && err.status === 404) return null;
    throw err;
  }
}

async function findName(doctype: string, filters: unknown[][]): Promise<string | null> {
  const rows = await frappe<{ name: string }[]>(
    "GET",
    `${resource(doctype)}?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent('["name"]')}&limit_page_length=1`
  );
  return rows?.[0]?.name ?? null;
}

// The Frappe user the API key belongs to (the account FieldForce acts as).
// Its own Helpdesk access is never removed by a sync - otherwise one CRM
// change could lock the integration's own admin out of Helpdesk.
let apiUserCache: string | null = null;
async function apiUser(): Promise<string> {
  if (!apiUserCache) apiUserCache = (await frappe<string>("GET", "/api/method/frappe.auth.get_logged_user")).toLowerCase();
  return apiUserCache;
}

interface FrappeUser {
  name: string;
  enabled: number;
  user_type: string;
  roles?: { role: string }[];
}

// Adds/removes only the Helpdesk roles FieldForce manages - every other role
// a Frappe user has (System Manager, etc.) is left exactly as it was.
async function setManagedRoles(user: FrappeUser, wanted: string[], managed: string[]): Promise<void> {
  const current = (user.roles ?? []).map((r) => r.role);
  const next = [...current.filter((role) => !managed.includes(role)), ...wanted];
  const unchanged = next.length === current.length && next.every((role) => current.includes(role));
  if (!unchanged) {
    await frappe("PUT", resource("User", user.name), { roles: next.map((role) => ({ role })) });
  }
}

async function ensureFrappeUser(email: string, fullName: string, userType: "System User" | "Website User"): Promise<FrappeUser> {
  const existing = await getDoc<FrappeUser>("User", email);
  if (existing) {
    // An agent needs desk access; a customer stays a website user unless
    // they're also an agent (never downgrade someone FieldForce didn't create).
    const patch: Record<string, unknown> = {};
    if (!existing.enabled) patch.enabled = 1;
    if (userType === "System User" && existing.user_type !== "System User") patch.user_type = "System User";
    if (Object.keys(patch).length > 0) await frappe("PUT", resource("User", email), patch);
    return { ...existing, ...patch } as FrappeUser;
  }
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return frappe<FrappeUser>("POST", resource("User"), {
    email,
    first_name: firstName || email,
    last_name: rest.join(" ") || undefined,
    enabled: 1,
    user_type: userType,
    send_welcome_email: 0,
  });
}

// --- Employees ---------------------------------------------------------------

async function desiredAccess(userId: string): Promise<{ email: string; name: string; access: HelpdeskAccess } | null> {
  const result = await pool.query<{ email: string; name: string; role: string; is_active: boolean; has_access: boolean }>(
    `SELECT u.email, u.name, u.role, u.is_active,
       EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = u.role AND rp.permission = 'support_tickets.view') AS has_access
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const access: HelpdeskAccess = !row.is_active || !row.has_access ? "none" : row.role === ROLES.ADMIN ? "agent_manager" : "agent";
  return { email: row.email.trim().toLowerCase(), name: row.name, access };
}

async function applyAgentAccess(email: string, name: string, access: HelpdeskAccess): Promise<void> {
  if (access === "none") {
    if (email === (await apiUser())) return;
    const agent = await getDoc<{ is_active: number }>("HD Agent", email);
    if (agent?.is_active) await frappe("PUT", resource("HD Agent", email), { is_active: 0 });
    const user = await getDoc<FrappeUser>("User", email);
    if (user) await setManagedRoles(user, [], [AGENT_ROLE, AGENT_MANAGER_ROLE]);
    await setAdminTeamMember(email, false);
    return;
  }

  const user = await ensureFrappeUser(email, name, "System User");
  const wanted = access === "agent_manager" ? [AGENT_ROLE, AGENT_MANAGER_ROLE] : [AGENT_ROLE];
  // Never take Agent Manager away from the integration's own account.
  const managed = email === (await apiUser()) ? [AGENT_ROLE] : [AGENT_ROLE, AGENT_MANAGER_ROLE];
  const fresh = (await getDoc<FrappeUser>("User", email)) ?? user;
  await setManagedRoles(fresh, wanted.filter((r) => managed.includes(r)), managed);

  const agent = await getDoc<{ is_active: number; agent_name: string }>("HD Agent", email);
  if (!agent) {
    await frappe("POST", resource("HD Agent"), { user: email, agent_name: name, is_active: 1 });
  } else if (!agent.is_active || agent.agent_name !== name) {
    await frappe("PUT", resource("HD Agent", email), { is_active: 1, agent_name: name });
  }
  // Admins see every ticket through the unrestricted Admin team; Field Sales
  // only see what is assigned to them (see ensureHelpdeskVisibilityRules).
  await setAdminTeamMember(email, access === "agent_manager");
}

// Brings one employee's Helpdesk access in line with FieldForce. Called after
// a user is created/updated (fire-and-forget) and by the reconcile job.
export async function syncEmployeeHelpdeskAccess(userId: string): Promise<void> {
  if (!isHelpdeskSyncConfigured()) return;
  const want = await desiredAccess(userId);
  if (!want) return;
  await ensureHelpdeskVisibilityRules();
  const previous = await pool.query<{ helpdesk_access: string | null }>("SELECT helpdesk_access FROM users WHERE id = $1", [userId]);
  await applyAgentAccess(want.email, want.name, want.access);
  await pool.query("UPDATE users SET helpdesk_access = $1, helpdesk_synced_at = now() WHERE id = $2", [want.access, userId]);
  const before = previous.rows[0]?.helpdesk_access ?? null;
  if (before !== want.access) {
    const label = { agent_manager: "Agent Manager", agent: "Agent", none: "No access" } as const;
    await recordAuditEvent({
      entityType: "user",
      entityId: userId,
      entityLabel: want.name,
      action: "helpdesk_access_synced",
      summary: `Support helpdesk access: ${label[want.access]} - ${want.name}`,
      oldValue: before ? label[before as HelpdeskAccess] : null,
      newValue: label[want.access],
      actorId: null,
      actorName: "Helpdesk sync",
    }).catch(() => undefined);
  }
}

// Fire-and-forget wrapper for request handlers - a Helpdesk hiccup must never
// fail or slow down saving a user in the CRM.
export function queueEmployeeHelpdeskSync(userId: string): void {
  syncEmployeeHelpdeskAccess(userId).catch((err) =>
    console.error(`Helpdesk sync for user ${userId} failed (will retry on the next reconcile):`, err instanceof Error ? err.message : err)
  );
}

export function queueRoleHelpdeskSync(role: string): void {
  pool
    .query<{ id: string }>("SELECT id FROM users WHERE role = $1", [role])
    .then(async (result) => {
      for (const row of result.rows) await syncEmployeeHelpdeskAccess(row.id).catch(() => undefined);
    })
    .catch((err) => console.error(`Helpdesk sync for role ${role} failed:`, err instanceof Error ? err.message : err));
}

// --- Field Sales "own tickets only" ------------------------------------------
//
// Helpdesk on its own lets every Agent see every ticket. FieldForce's rule is
// the same one the CRM uses for customers: a Field Sales person works the
// tickets of the customers they own, and an Admin sees everything. This is
// built only from Helpdesk's own native features (the Frappe Cloud site has
// server scripts switched off, and a script would also only hide tickets from
// lists, not stop one being opened by its URL):
//  - HD Settings "restrict tickets by team" is ON: an agent then sees only
//    tickets assigned to them or belonging to one of their teams - enforced by
//    Helpdesk everywhere, lists and the ticket page alike.
//  - Every FieldForce Admin (Agent Manager) is a member of ADMIN_TEAM, a team
//    with "ignore restrictions", so Admins still see every ticket.
//  - Each HD Customer carries its FieldForce owner (OWNER_FIELD), and
//    syncTicketOwnerAssignments assigns each open ticket to that owner - so it
//    appears in their "My tickets", they get Helpdesk's assignment notification,
//    and nobody else in Field Sales can see it.
// All of it is created and kept up to date from here; nobody sets it up by hand.
const OWNER_FIELD = "fieldforce_owner";
const ADMIN_TEAM = "FieldForce Admins";
// An earlier attempt used a Permission Query server script; on a site with
// server scripts disabled its mere presence breaks every ticket list, so make
// sure it is gone.
const RETIRED_SERVER_SCRIPT = "FieldForce - Field Sales see own tickets";

let visibilityRulesReady = false;

interface HdTeam {
  users?: { user: string }[];
  ignore_restrictions?: number;
  disabled?: number;
}

async function setAdminTeamMember(email: string, member: boolean): Promise<void> {
  const team = await getDoc<HdTeam>("HD Team", ADMIN_TEAM);
  if (!team) return;
  const users = (team.users ?? []).map((u) => u.user.toLowerCase());
  const isMember = users.includes(email);
  if (member === isMember) return;
  // The integration's own account must never leave - it needs every ticket.
  if (!member && email === (await apiUser())) return;
  const next = member ? [...users, email] : users.filter((u) => u !== email);
  await frappe("PUT", resource("HD Team", ADMIN_TEAM), { users: next.map((user) => ({ user })) });
}

export async function ensureHelpdeskVisibilityRules(): Promise<void> {
  if (visibilityRulesReady) return;

  if (!(await findName("Custom Field", [["dt", "=", "HD Customer"], ["fieldname", "=", OWNER_FIELD]]))) {
    await frappe("POST", resource("Custom Field"), {
      dt: "HD Customer",
      fieldname: OWNER_FIELD,
      label: "FieldForce owner",
      fieldtype: "Data",
      options: "Email",
      read_only: 1,
      in_standard_filter: 1,
      insert_after: "mobile_no",
      description: "Set automatically by FieldForce - the Field Sales person who owns this customer.",
    });
  }

  if (await getDoc("Server Script", RETIRED_SERVER_SCRIPT)) {
    await frappe("DELETE", resource("Server Script", RETIRED_SERVER_SCRIPT));
  }

  // The Admin team must exist (with the integration's own account in it)
  // BEFORE restriction is switched on, or that account would lose sight of
  // the tickets it needs to assign.
  const self = await apiUser();
  const team = await getDoc<HdTeam>("HD Team", ADMIN_TEAM);
  if (!team) {
    await frappe("POST", resource("HD Team"), { team_name: ADMIN_TEAM, ignore_restrictions: 1, users: [{ user: self }] });
  } else {
    if (!team.ignore_restrictions || team.disabled) await frappe("PUT", resource("HD Team", ADMIN_TEAM), { ignore_restrictions: 1, disabled: 0 });
    await setAdminTeamMember(self, true);
  }

  const settings = await frappe<{ restrict_tickets_by_agent_group?: number; do_not_restrict_tickets_without_an_agent_group?: number }>(
    "GET",
    resource("HD Settings", "HD Settings")
  );
  if (!settings.restrict_tickets_by_agent_group || settings.do_not_restrict_tickets_without_an_agent_group) {
    await frappe("PUT", resource("HD Settings", "HD Settings"), {
      restrict_tickets_by_agent_group: 1,
      do_not_restrict_tickets_without_an_agent_group: 0,
    });
  }
  visibilityRulesReady = true;
}

// Assigns every open ticket to its customer's FieldForce owner, and takes
// back an assignment FieldForce itself made when the customer has since moved
// to someone else. Assignments people make by hand in Helpdesk are never
// touched - only the ones recorded in helpdesk_ticket_assignments.
export async function syncTicketOwnerAssignments(): Promise<{ assigned: number; unassigned: number }> {
  if (!isHelpdeskSyncConfigured()) return { assigned: 0, unassigned: 0 };
  await ensureHelpdeskVisibilityRules();

  const [tickets, accounts, agents, ours] = await Promise.all([
    frappe<{ name: string; customer: string | null; _assign: string | null }[]>(
      "GET",
      `${resource("HD Ticket")}?filters=${encodeURIComponent(JSON.stringify([["status_category", "in", ["Open", "Paused"]], ["customer", "is", "set"]]))}` +
        `&fields=${encodeURIComponent('["name","customer","_assign"]')}&limit_page_length=0`
    ),
    frappe<{ name: string; [OWNER_FIELD]: string | null }[]>(
      "GET",
      `${resource("HD Customer")}?filters=${encodeURIComponent(JSON.stringify([[OWNER_FIELD, "is", "set"]]))}` +
        `&fields=${encodeURIComponent(JSON.stringify(["name", OWNER_FIELD]))}&limit_page_length=0`
    ),
    frappe<{ name: string }[]>("GET", `${resource("HD Agent")}?filters=${encodeURIComponent('[["is_active","=",1]]')}&fields=${encodeURIComponent('["name"]')}&limit_page_length=0`),
    pool.query<{ ticket: string; assignee: string }>("SELECT ticket, assignee FROM helpdesk_ticket_assignments"),
  ]);
  const ownerOf = new Map(accounts.map((a) => [a.name, (a[OWNER_FIELD] ?? "").toLowerCase()]));
  const activeAgents = new Set(agents.map((a) => a.name.toLowerCase()));
  const ourAssignee = new Map(ours.rows.map((r) => [r.ticket, r.assignee]));

  let assigned = 0;
  let unassigned = 0;
  for (const ticket of tickets) {
    try {
      const current = ((): string[] => {
        try {
          return (JSON.parse(ticket._assign || "[]") as string[]).map((e) => e.toLowerCase());
        } catch {
          return [];
        }
      })();
      const owner = ticket.customer ? ownerOf.get(ticket.customer) ?? "" : "";
      const previous = ourAssignee.get(ticket.name);

      if (previous && previous !== owner) {
        if (current.includes(previous)) {
          await frappe("POST", "/api/method/frappe.desk.form.assign_to.remove", { doctype: "HD Ticket", name: ticket.name, assign_to: previous });
          unassigned++;
        }
        await pool.query("DELETE FROM helpdesk_ticket_assignments WHERE ticket = $1", [ticket.name]);
      }
      if (owner && activeAgents.has(owner) && !current.includes(owner)) {
        await frappe("POST", "/api/method/frappe.desk.form.assign_to.add", { doctype: "HD Ticket", name: ticket.name, assign_to: [owner] });
        await pool.query(
          `INSERT INTO helpdesk_ticket_assignments (ticket, assignee) VALUES ($1, $2)
           ON CONFLICT (ticket) DO UPDATE SET assignee = EXCLUDED.assignee, assigned_at = now()`,
          [ticket.name, owner]
        );
        assigned++;
      }
    } catch (err) {
      console.error(`Helpdesk ticket ${ticket.name} owner assignment failed -`, err instanceof Error ? err.message : err);
    }
  }
  if (assigned || unassigned) console.log(`Helpdesk tickets: ${assigned} assigned to their customer's owner, ${unassigned} handed back`);
  return { assigned, unassigned };
}

// --- Customers ---------------------------------------------------------------
//
// A customer gets a support-portal account only once they've actually taken
// an outlet/franchise - i.e. one of their deals (opportunities) is Won - or
// when an Admin grants it by hand for an exception. Being a "Customer" record
// alone isn't enough: the CRM creates that as soon as a lead becomes an
// opportunity, long before anything is signed.
//
// The account is an HD Customer (the company), a Contact linked to it, and a
// portal user with the HD Customer role. Customers never get a password: the
// invite email carries a one-click link (customer-invite in sso-controller.ts,
// valid INVITE_TTL_DAYS) and after that they sign in with Frappe's emailed
// one-time link.

// Same "C-00012" label customer-service.ts shows (kept local - importing it
// from there would make the two services import each other).
const customerLabel = (customerNumber: number) => `C-${String(customerNumber).padStart(5, "0")}`;

// SQL (over `customers c`) for "should this customer have portal access".
export const CUSTOMER_PORTAL_QUALIFIES_SQL = `(c.helpdesk_access_manual OR EXISTS (
  SELECT 1 FROM opportunities o WHERE o.lead_id = c.lead_id AND o.stage = 'won' AND o.is_deleted = false))`;

// Bump when the Helpdesk account setup changes so the reconcile redoes every
// already-synced customer once (2 = contact added to the account member list).
const CUSTOMER_SYNC_VERSION = 2;

export const INVITE_TTL_DAYS = 7;
const PORTAL_PATH = "/helpdesk/my-tickets";

interface CustomerSyncRow {
  customer_number: number;
  full_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  is_deleted: boolean;
  owner_email: string | null;
  qualifies: boolean;
  helpdesk_synced_email: string | null;
  helpdesk_invite_pending: boolean;
  helpdesk_invited_email: string | null;
}

// Takes portal access away again (deal no longer Won, customer deleted, email
// removed). Only a portal user FieldForce itself created is disabled - never
// a staff account or someone who signed up on the portal on their own - and
// never while another customer that still qualifies uses the same email (one
// person can hold several outlets/franchises on one address; they share a
// single portal login).
async function revokeCustomerPortal(email: string, customerId: string): Promise<void> {
  const stillUsed = await pool.query(
    `SELECT 1 FROM customers c
     WHERE c.id <> $1 AND c.is_deleted = false AND lower(trim(c.email)) = lower(trim($2))
       AND ${CUSTOMER_PORTAL_QUALIFIES_SQL}
     LIMIT 1`,
    [customerId, email]
  );
  if ((stillUsed.rowCount ?? 0) > 0) return;
  const user = await getDoc<FrappeUser & { owner?: string }>("User", email);
  if (user && user.enabled && user.user_type === "Website User" && user.owner?.toLowerCase() === (await apiUser())) {
    await frappe("PUT", resource("User", email), { enabled: 0 });
  }
}

// Helpdesk 16 decides which customer account a new ticket belongs to from the
// account's own member list (HD Customer -> contacts, "HD Customer Member"),
// NOT from the Contact's links - a contact that is only linked lands its
// tickets on no account (or some other account it's a member of), so the
// Field Sales owner never gets them. Only FieldForce's own contact is added
// or removed; members staff added by hand are kept.
interface AccountMemberRow {
  name?: string;
  contact_name: string;
  is_manager?: number;
}

async function setAccountMember(accountName: string, contactName: string, member: boolean): Promise<void> {
  const account = await getDoc<{ contacts?: AccountMemberRow[] }>("HD Customer", accountName);
  if (!account) return;
  const rows = account.contacts ?? [];
  const has = rows.some((r) => r.contact_name === contactName);
  if (has === member) return;
  const kept = rows
    .filter((r) => r.contact_name !== contactName)
    .map((r) => ({ name: r.name, contact_name: r.contact_name, is_manager: r.is_manager ?? 0 }));
  await frappe("PUT", resource("HD Customer", accountName), {
    contacts: member ? [...kept, { contact_name: contactName, is_manager: 1 }] : kept,
  });
}

async function removeAccountMemberByEmail(accountName: string, email: string): Promise<void> {
  const contactName = await findName("Contact", [["email_id", "=", email]]);
  if (contactName) await setAccountMember(accountName, contactName, false);
}

let brandNameCache: string | null = null;
async function brandName(): Promise<string> {
  if (!brandNameCache) {
    const settings = await frappe<{ brand_name?: string }>("GET", resource("HD Settings", "HD Settings")).catch(() => null);
    brandNameCache = settings?.brand_name?.trim() || "Support";
  }
  return brandNameCache;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

// Creates a fresh one-click link (any older link for this customer stops
// working) and emails it from Helpdesk's own outgoing "Support" mailbox.
async function sendCustomerInvite(customerId: string, email: string, fullName: string): Promise<void> {
  const config = frappeConfig();
  const backend = process.env.PUBLIC_BACKEND_BASE_URL?.trim().replace(/\/+$/, "");
  if (!config || !backend) throw new FrappeError("PUBLIC_BACKEND_BASE_URL is not set - can't build the invite link", 503);

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const link = `${backend}/api/sso/customer-invite?t=${token}`;
  const portal = `${config.base}${PORTAL_PATH}`;
  const brand = await brandName();
  const firstName = fullName.trim().split(/\s+/)[0] || "there";

  const content =
    `<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:520px">` +
    `<p>Hi ${escapeHtml(firstName)},</p>` +
    `<p>Welcome to ${escapeHtml(brand)}! You now have your own support portal. Whenever you have a question or an issue, raise it there and follow every reply from our team in one place.</p>` +
    `<p style="margin:24px 0"><a href="${link}" style="background:#1354e0;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Open my support portal</a></p>` +
    `<p style="color:#4b5563;font-size:13px">This button signs you in directly - no password needed. It works for ${INVITE_TTL_DAYS} days. ` +
    `After that, go to <a href="${portal}">${escapeHtml(portal.replace(/^https?:\/\//, ""))}</a> and sign in with this email address (${escapeHtml(email)}); we'll email you a one-time sign-in link.</p>` +
    `<p>- ${escapeHtml(brand)} Support</p></div>`;

  await pool.query("DELETE FROM helpdesk_customer_invites WHERE customer_id = $1", [customerId]);
  await pool.query(
    `INSERT INTO helpdesk_customer_invites (customer_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [customerId, email, tokenHash, INVITE_TTL_DAYS]
  );
  await frappe("POST", "/api/method/frappe.core.doctype.communication.email.make", {
    recipients: email,
    subject: `Your ${brand} support portal`,
    content,
    send_email: 1,
  });
}

// Brings one customer's portal access in line with FieldForce. `sendInvite`
// forces a (new) invite email - the "Send / Resend invite" button.
// One customer is never synced twice at the same moment (a deal being Won
// and the customer being created can both queue a sync) - the second run
// waits and then sees the first one's result, so no duplicate account or
// invite email.
const customerSyncs = new Map<string, Promise<void>>();

export async function syncCustomerHelpdeskAccount(customerId: string, options: { sendInvite?: boolean } = {}): Promise<void> {
  if (!isHelpdeskSyncConfigured()) return;
  const run = (customerSyncs.get(customerId) ?? Promise.resolve()).catch(() => undefined).then(() => syncCustomerNow(customerId, options));
  customerSyncs.set(customerId, run);
  try {
    await run;
  } finally {
    if (customerSyncs.get(customerId) === run) customerSyncs.delete(customerId);
  }
}

async function syncCustomerNow(customerId: string, options: { sendInvite?: boolean }): Promise<void> {
  const result = await pool.query<CustomerSyncRow>(
    `SELECT c.customer_number, c.full_name, c.company_name, c.email, c.phone, c.is_deleted,
            lower(trim(u.email)) AS owner_email, ${CUSTOMER_PORTAL_QUALIFIES_SQL} AS qualifies,
            c.helpdesk_synced_email, c.helpdesk_invite_pending, c.helpdesk_invited_email
     FROM customers c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = $1`,
    [customerId]
  );
  const customer = result.rows[0];
  if (!customer) return;
  const email = customer.email?.trim().toLowerCase() || null;

  const accountName = `${(customer.company_name || customer.full_name).trim()} (${customerLabel(customer.customer_number)})`;

  if (customer.is_deleted || !email || !customer.qualifies) {
    if (customer.helpdesk_synced_email) {
      await removeAccountMemberByEmail(accountName, customer.helpdesk_synced_email);
      await revokeCustomerPortal(customer.helpdesk_synced_email, customerId);
    }
    await pool.query("DELETE FROM helpdesk_customer_invites WHERE customer_id = $1", [customerId]);
    await pool.query(
      "UPDATE customers SET helpdesk_synced_email = NULL, helpdesk_synced_owner = NULL, helpdesk_invite_pending = false WHERE id = $1",
      [customerId]
    );
    return;
  }

  await ensureHelpdeskVisibilityRules();
  const ownerEmail = customer.owner_email ?? "";
  // The email changed: the old address's portal login goes away.
  if (customer.helpdesk_synced_email && customer.helpdesk_synced_email !== email) {
    await removeAccountMemberByEmail(accountName, customer.helpdesk_synced_email);
    await revokeCustomerPortal(customer.helpdesk_synced_email, customerId);
  }

  // Account name (built above) carries the FieldForce customer number, so two
  // customers with the same name never collide in Helpdesk. The owner field
  // decides which Field Sales person gets this account's tickets.
  const account = await getDoc<Record<string, unknown>>("HD Customer", accountName);
  if (!account) {
    await frappe("POST", resource("HD Customer"), { customer_name: accountName, [OWNER_FIELD]: ownerEmail || undefined });
  } else if ((account[OWNER_FIELD] ?? "") !== ownerEmail) {
    await frappe("PUT", resource("HD Customer", accountName), { [OWNER_FIELD]: ownerEmail || null });
  }

  // Portal user (website user, HD Customer role, no password) - re-enabled
  // if access had been taken away before.
  const user = await ensureFrappeUser(email, customer.full_name, "Website User");
  const fresh = (await getDoc<FrappeUser>("User", email)) ?? user;
  if (!(fresh.roles ?? []).some((r) => r.role === CUSTOMER_ROLE)) {
    await frappe("PUT", resource("User", email), { roles: [...(fresh.roles ?? []).map((r) => ({ role: r.role })), { role: CUSTOMER_ROLE }] });
  }

  // Contact for this email, linked to the account and the portal user.
  let contactName = await findName("Contact", [["email_id", "=", email]]);
  if (!contactName) {
    const [firstName, ...rest] = customer.full_name.trim().split(/\s+/);
    contactName = (await frappe<{ name: string }>("POST", resource("Contact"), {
      first_name: firstName || email,
      last_name: rest.join(" ") || undefined,
      email_ids: [{ email_id: email, is_primary: 1 }],
      phone_nos: customer.phone ? [{ phone: customer.phone, is_primary_mobile_no: 1 }] : [],
      user: email,
      links: [{ link_doctype: "HD Customer", link_name: accountName }],
    })).name;
  } else {
    const contact = await getDoc<{ user?: string; links?: { link_doctype: string; link_name: string }[] }>("Contact", contactName);
    const links = contact?.links ?? [];
    const linked = links.some((l) => l.link_doctype === "HD Customer" && l.link_name === accountName);
    const patch: Record<string, unknown> = {};
    if (!linked) patch.links = [...links.map((l) => ({ link_doctype: l.link_doctype, link_name: l.link_name })), { link_doctype: "HD Customer", link_name: accountName }];
    if (!contact?.user) patch.user = email;
    if (Object.keys(patch).length > 0) await frappe("PUT", resource("Contact", contactName), patch);
  }
  // What Helpdesk actually reads to put a ticket on this account (and so to
  // its Field Sales owner) - see setAccountMember.
  await setAccountMember(accountName, contactName, true);

  await pool.query(
    "UPDATE customers SET helpdesk_synced_email = $1, helpdesk_synced_owner = $2, helpdesk_sync_version = $3 WHERE id = $4",
    [email, ownerEmail, CUSTOMER_SYNC_VERSION, customerId]
  );

  // Invite: when the deal was just Won / an Admin asked for it, or when an
  // already-invited customer's email address changed.
  const emailChangedSinceInvite = customer.helpdesk_invited_email !== null && customer.helpdesk_invited_email !== email;
  if (options.sendInvite || customer.helpdesk_invite_pending || emailChangedSinceInvite) {
    await sendCustomerInvite(customerId, email, customer.full_name);
    await pool.query(
      "UPDATE customers SET helpdesk_invite_pending = false, helpdesk_invited_at = now(), helpdesk_invited_email = $1 WHERE id = $2",
      [email, customerId]
    );
  }
}

export function queueCustomerHelpdeskSync(customerId: string): void {
  syncCustomerHelpdeskAccount(customerId).catch((err) =>
    console.error(`Helpdesk sync for customer ${customerId} failed (will retry on the next reconcile):`, err instanceof Error ? err.message : err)
  );
}

// Called when one of a lead's deals changes stage (opportunity-service.ts).
// The first time a deal is Won, the customer's invite is queued - once
// invited, winning another deal never re-sends it.
export function queueCustomerHelpdeskSyncForLead(leadId: string, dealWon: boolean): void {
  if (!isHelpdeskSyncConfigured()) return;
  pool
    .query<{ id: string }>(
      `UPDATE customers SET helpdesk_invite_pending = (helpdesk_invite_pending OR ($2 AND helpdesk_invited_at IS NULL))
       WHERE lead_id = $1 AND is_deleted = false RETURNING id`,
      [leadId, dealWon]
    )
    .then((result) => result.rows.forEach((row) => queueCustomerHelpdeskSync(row.id)))
    .catch((err) => console.error(`Helpdesk sync for lead ${leadId} failed:`, err instanceof Error ? err.message : err));
}

export interface CustomerPortalStatus {
  enabled: boolean; // Helpdesk sync is switched on for this server at all
  qualifies: boolean;
  manual: boolean;
  active: boolean;
  invitedAt: string | null;
  invitedEmail: string | null;
}

export async function getCustomerPortalStatus(customerId: string): Promise<CustomerPortalStatus> {
  const result = await pool.query<{ qualifies: boolean; manual: boolean; synced: string | null; invited_at: string | null; invited_email: string | null }>(
    `SELECT ${CUSTOMER_PORTAL_QUALIFIES_SQL} AS qualifies, c.helpdesk_access_manual AS manual, c.helpdesk_synced_email AS synced,
            c.helpdesk_invited_at AS invited_at, c.helpdesk_invited_email AS invited_email
     FROM customers c WHERE c.id = $1`,
    [customerId]
  );
  const row = result.rows[0];
  return {
    enabled: isHelpdeskSyncConfigured(),
    qualifies: Boolean(row?.qualifies),
    manual: Boolean(row?.manual),
    active: Boolean(row?.synced),
    invitedAt: row?.invited_at ?? null,
    invitedEmail: row?.invited_email ?? null,
  };
}

// The "Give portal access & send invite" / "Resend invite" button. Waits for
// Frappe so the person clicking sees whether it really worked. `grant` (Admin
// only, checked by the caller) gives access to a customer with no Won deal.
export async function inviteCustomerToPortal(customerId: string, grant: boolean): Promise<CustomerPortalStatus> {
  if (!isHelpdeskSyncConfigured()) throw new FrappeError("The support portal isn't switched on for this server", 503);
  if (grant) await pool.query("UPDATE customers SET helpdesk_access_manual = true WHERE id = $1", [customerId]);
  const status = await getCustomerPortalStatus(customerId);
  if (!status.qualifies) throw new FrappeError("This customer has no Won deal yet - only an Admin can give portal access early", 403);
  await syncCustomerHelpdeskAccount(customerId, { sendInvite: true });
  return getCustomerPortalStatus(customerId);
}

export { FrappeError as HelpdeskError };

// --- Reconcile -----------------------------------------------------------------

// Catches up anything a fire-and-forget sync missed (Frappe briefly down, a
// permission changed in bulk, people who existed before this feature). Only
// touches rows whose last-synced state differs from what it should be, so a
// normal run makes no Frappe calls at all.
export async function reconcileHelpdesk(): Promise<{ employees: number; customers: number; failures: number }> {
  if (!isHelpdeskSyncConfigured()) return { employees: 0, customers: 0, failures: 0 };
  let employees = 0;
  let customers = 0;
  let failures = 0;
  await ensureHelpdeskVisibilityRules();

  const staff = await pool.query<{ id: string }>(
    `SELECT u.id FROM users u
     WHERE COALESCE(u.helpdesk_access, '') <> CASE
       WHEN NOT u.is_active OR NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = u.role AND rp.permission = 'support_tickets.view') THEN 'none'
       WHEN u.role = 'admin' THEN 'agent_manager'
       ELSE 'agent' END
       -- never-synced people who have no access need no Frappe call at all
       AND NOT (u.helpdesk_access IS NULL AND (NOT u.is_active OR NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = u.role AND rp.permission = 'support_tickets.view')))`
  );
  for (const row of staff.rows) {
    try {
      await syncEmployeeHelpdeskAccess(row.id);
      employees++;
    } catch (err) {
      failures++;
      console.error(`Helpdesk reconcile: user ${row.id} failed -`, err instanceof Error ? err.message : err);
    }
  }

  const accounts = await pool.query<{ id: string }>(
    // New email, or a new owner (reassigned by an Admin, a lead's owner
    // changing, or a departing rep's book being transferred) - all of them
    // only ever write customers.owner_id, so this one check covers every path.
    // Also: a deal Won/un-Won since, an invite still waiting to go out, or
    // access to take away (deal no longer Won, customer deleted, no email).
    `SELECT c.id FROM customers c LEFT JOIN users u ON u.id = c.owner_id
     WHERE (c.is_deleted = false AND c.email IS NOT NULL AND trim(c.email) <> '' AND ${CUSTOMER_PORTAL_QUALIFIES_SQL}
            AND (c.helpdesk_synced_email IS DISTINCT FROM lower(trim(c.email))
                 OR c.helpdesk_synced_owner IS DISTINCT FROM COALESCE(lower(trim(u.email)), '')
                 OR c.helpdesk_invite_pending
                 OR c.helpdesk_sync_version < ${CUSTOMER_SYNC_VERSION}
                 OR (c.helpdesk_invited_email IS NOT NULL AND c.helpdesk_invited_email <> lower(trim(c.email)))))
        OR (c.helpdesk_synced_email IS NOT NULL
            AND NOT (c.is_deleted = false AND c.email IS NOT NULL AND trim(c.email) <> '' AND ${CUSTOMER_PORTAL_QUALIFIES_SQL}))`
  );
  for (const row of accounts.rows) {
    try {
      await syncCustomerHelpdeskAccount(row.id);
      customers++;
    } catch (err) {
      failures++;
      console.error(`Helpdesk reconcile: customer ${row.id} failed -`, err instanceof Error ? err.message : err);
    }
  }

  if (employees || customers || failures) {
    console.log(`Helpdesk reconcile: ${employees} employee(s), ${customers} customer(s) synced, ${failures} failed`);
  }
  return { employees, customers, failures };
}

let reconcileRunning = false;
const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
// New tickets reach their owner within a couple of minutes.
const TICKET_ASSIGN_INTERVAL_MS = 2 * 60 * 1000;
let ticketAssignRunning = false;

async function runTicketAssignment(): Promise<void> {
  if (ticketAssignRunning) return;
  ticketAssignRunning = true;
  try {
    await syncTicketOwnerAssignments();
  } catch (err) {
    console.error("Helpdesk ticket owner assignment failed:", err instanceof Error ? err.message : err);
  } finally {
    ticketAssignRunning = false;
  }
}

async function runReconcile(label: string): Promise<void> {
  if (reconcileRunning) return;
  reconcileRunning = true;
  try {
    await reconcileHelpdesk();
  } catch (err) {
    console.error(`${label} Helpdesk reconcile failed:`, err instanceof Error ? err.message : err);
  } finally {
    reconcileRunning = false;
  }
}

export function startHelpdeskSyncScheduler(): void {
  if (!isHelpdeskSyncConfigured()) return;
  void runReconcile("Initial").then(() => runTicketAssignment());
  setInterval(() => void runReconcile("Scheduled"), RECONCILE_INTERVAL_MS);
  setInterval(() => void runTicketAssignment(), TICKET_ASSIGN_INTERVAL_MS);
}

// For the admin "Sync now" action - waits for the result instead of running
// in the background.
export async function reconcileHelpdeskNow(): Promise<{ employees: number; customers: number; failures: number }> {
  if (reconcileRunning) return { employees: 0, customers: 0, failures: 0 };
  reconcileRunning = true;
  try {
    return await reconcileHelpdesk();
  } finally {
    reconcileRunning = false;
  }
}
