import { getPermissionsForRole } from "./permission-service";
import * as leaveService from "./leave-service";
import * as expenseService from "./expense-service";
import * as fofoOnboardingService from "./fofo-onboarding-service";

export type ApprovalItemType = "onboarding_push" | "leave" | "expense";

export interface ApprovalQueueItem {
  id: string;
  type: ApprovalItemType;
  typeLabel: string;
  title: string;
  subtitle: string;
  value: number | null;
  valueLabel: string;
  raisedByName: string | null;
  createdAt: string;
  waitingHours: number;
  isSlaBreach: boolean;
  stepLabel: string;
  isPolicyBreach: boolean;
  refId: string;
  /** Full underlying leave/expense record for the detail panel - FOFO detail
   *  instead fetches the real approval chain via GET /fofo-onboarding/:leadId,
   *  since a single pending step doesn't carry the other steps or documents. */
  raw: unknown;
}

// Synthesized, not a real configured setting - none of these three
// subsystems has an enforced SLA deadline anywhere in the schema
// (approval_bands.sla_hours exists but nothing reads it). 48h just mirrors
// the "over 2 days" framing consistently across every item type.
const SLA_BREACH_HOURS = 48;

function waitingHoursSince(createdAt: string): number {
  return (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
}

function formatMoney(value: number): string {
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  return `₹${value.toLocaleString("en-IN")}`;
}

async function buildLeaveItems(userId: string): Promise<ApprovalQueueItem[]> {
  const requests = await leaveService.listPendingApprovals(userId);
  return requests.map((r) => {
    const isSecondTier = r.secondApproverId === userId && r.approverDecision === "approved";
    return {
      id: `leave:${r.id}`,
      type: "leave",
      typeLabel: "Leave",
      title: `${r.userName ?? "Unknown"} — ${r.kind.replace("_", " ")} leave, ${r.daysCount} day${r.daysCount === 1 ? "" : "s"}`,
      subtitle: `Leave · raised by ${r.userName ?? "Unknown"}${isSecondTier ? " · 2nd approval" : ""}`,
      value: null,
      valueLabel: `${r.daysCount} day${r.daysCount === 1 ? "" : "s"}`,
      raisedByName: r.userName,
      createdAt: r.createdAt,
      waitingHours: waitingHoursSince(r.createdAt),
      isSlaBreach: waitingHoursSince(r.createdAt) > SLA_BREACH_HOURS,
      stepLabel: isSecondTier ? "2nd approval" : "1st approval",
      isPolicyBreach: false,
      refId: r.id,
      raw: r,
    };
  });
}

async function buildExpenseItems(userId: string): Promise<ApprovalQueueItem[]> {
  const claims = await expenseService.listPendingApprovals(userId);
  return claims.map((c) => {
    const isSecondTier = c.secondApproverId === userId && c.approverDecision === "approved";
    return {
      id: `expense:${c.id}`,
      type: "expense",
      typeLabel: "Expense",
      title: `${c.title} — ${c.claimNumber}`,
      subtitle: `Expense · raised by ${c.userName ?? "Unknown"}${isSecondTier ? " · 2nd approval" : ""}`,
      value: c.amount,
      valueLabel: formatMoney(c.amount),
      raisedByName: c.userName,
      createdAt: c.createdAt,
      waitingHours: waitingHoursSince(c.createdAt),
      isSlaBreach: waitingHoursSince(c.createdAt) > SLA_BREACH_HOURS,
      stepLabel: isSecondTier ? "2nd approval" : "1st approval",
      isPolicyBreach: c.isPolicyBreach,
      refId: c.id,
      raw: c,
    };
  });
}

async function buildFofoItems(userId: string): Promise<ApprovalQueueItem[]> {
  const steps = await fofoOnboardingService.listPendingApprovalStepsForUser(userId);
  return steps.map((s) => ({
    id: `onboarding_push:${s.stepId}`,
    type: "onboarding_push",
    typeLabel: "Onboarding push",
    title: s.storeName ? `${s.storeName}${s.storeCity ? ` — ${s.storeCity}` : ""}` : s.fullName,
    subtitle: `FOFO · Lead #${s.leadNumber ?? "—"} · raised by ${s.ownerName ?? "Unknown"}`,
    value: s.expectedValue,
    valueLabel: s.expectedValue !== null ? formatMoney(s.expectedValue) : "—",
    raisedByName: s.ownerName,
    createdAt: s.createdAt,
    waitingHours: waitingHoursSince(s.createdAt),
    isSlaBreach: waitingHoursSince(s.createdAt) > SLA_BREACH_HOURS,
    stepLabel: s.roleLabel,
    isPolicyBreach: false,
    refId: s.leadId,
    raw: s,
  }));
}

export interface ApprovalInboxStats {
  waitingOnYou: number;
  breachingSla: number;
  valueInQueue: number;
  valueInQueueCount: number;
  approvedThisWeek: number;
  avgDecisionHours: number | null;
}

export async function getApprovalInbox(userId: string, role: string): Promise<{ items: ApprovalQueueItem[]; stats: ApprovalInboxStats }> {
  const permissions = await getPermissionsForRole(role);
  const [leaveItems, expenseItems, fofoItems] = await Promise.all([
    permissions.includes("leave_requests.approve") ? buildLeaveItems(userId) : Promise.resolve([]),
    permissions.includes("expense_claims.approve") ? buildExpenseItems(userId) : Promise.resolve([]),
    permissions.includes("fofo_onboarding.manage") ? buildFofoItems(userId) : Promise.resolve([]),
  ]);

  const items = [...leaveItems, ...expenseItems, ...fofoItems].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const valueItems = items.filter((i) => i.value !== null);
  const decided = (
    await Promise.all([
      permissions.includes("leave_requests.approve") ? leaveService.listDecidedThisWeek(userId) : Promise.resolve([]),
      permissions.includes("expense_claims.approve") ? expenseService.listDecidedThisWeek(userId) : Promise.resolve([]),
      permissions.includes("fofo_onboarding.manage") ? fofoOnboardingService.listDecidedStepsThisWeek(userId) : Promise.resolve([]),
    ])
  ).flat();

  const decisionHours = decided.map((d) => (new Date(d.decided_at).getTime() - new Date(d.created_at).getTime()) / (1000 * 60 * 60));
  const avgDecisionHours = decisionHours.length > 0 ? decisionHours.reduce((a, b) => a + b, 0) / decisionHours.length : null;

  const stats: ApprovalInboxStats = {
    waitingOnYou: items.length,
    breachingSla: items.filter((i) => i.isSlaBreach).length,
    valueInQueue: valueItems.reduce((sum, i) => sum + (i.value ?? 0), 0),
    valueInQueueCount: valueItems.length,
    approvedThisWeek: decided.length,
    avgDecisionHours,
  };

  return { items, stats };
}
