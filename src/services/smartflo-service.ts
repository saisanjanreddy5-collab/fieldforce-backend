import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { SMARTFLO_BASE_URL, isSmartfloConfigured } from "../config/smartflo";
import { env } from "../config/env";
import { createActivityForLead, mergeActivityDetailsByExternalRefId } from "./activity-service";
import { getLeadById } from "./lead-service";

interface ClickToCallResponse {
  success: boolean;
  message: string;
  ref_id?: string;
}

// Shape of the payload Smartflo posts to our webhook when a call hangs up
// (configured in their dashboard as "Call hangup (Missed or Answered)").
// Only ref_id is guaranteed - it is the same value returned as ref_id from
// click_to_call, which is how we match the callback back to our Activity.
export interface SmartfloWebhookPayload {
  ref_id?: string;
  recording_url?: string;
  duration?: string | number;
  billsec?: string | number;
  call_status?: string;
  call_connected?: boolean | string;
  hangup_cause?: string;
}

function assertConfigured(): void {
  if (!isSmartfloConfigured()) {
    throw new ApiError(503, "Smartflo (calling) integration is not configured yet");
  }
}

async function getAgentNumber(userId: string): Promise<string | null> {
  const result = await pool.query<{ smartflo_agent_number: string | null }>(
    "SELECT smartflo_agent_number FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0]?.smartflo_agent_number ?? null;
}

export async function initiateCallForLead(leadId: string, requestingUserId: string): Promise<{ refId: string }> {
  assertConfigured();

  const agentNumber = await getAgentNumber(requestingUserId);
  if (!agentNumber) {
    throw new ApiError(409, "Set your calling number from your profile (top right) first");
  }

  const lead = await getLeadById(leadId, requestingUserId);
  if (!lead.phone) {
    throw new ApiError(422, "This lead has no phone number on file");
  }

  const response = await fetch(`${SMARTFLO_BASE_URL}/click_to_call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SMARTFLO_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_number: agentNumber,
      destination_number: lead.phone,
      async: 1,
    }),
  });

  const body = (await response.json()) as ClickToCallResponse;

  if (!response.ok || !body.success) {
    throw new ApiError(502, `Smartflo rejected the call: ${body.message}`);
  }

  await createActivityForLead(
    leadId,
    {
      type: "call",
      subject: "Click-to-call",
      status: "completed",
      externalRefId: body.ref_id,
    },
    requestingUserId
  );

  return { refId: body.ref_id ?? "" };
}

export function isWebhookSecretValid(providedSecret: string | undefined): boolean {
  if (!env.SMARTFLO_WEBHOOK_SECRET) return true;
  return providedSecret === env.SMARTFLO_WEBHOOK_SECRET;
}

function parseSeconds(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export async function handleWebhookEvent(payload: SmartfloWebhookPayload): Promise<void> {
  if (!payload.ref_id) return;

  const durationSeconds = parseSeconds(payload.billsec) ?? parseSeconds(payload.duration);
  const connected =
    payload.call_connected === true ||
    payload.call_connected === "true" ||
    payload.call_status?.toLowerCase() === "answered";

  const patch: Record<string, unknown> = {
    outcome:
      connected && durationSeconds !== undefined
        ? `Connected · ${formatDuration(durationSeconds)}`
        : connected
          ? "Connected"
          : `Not answered${payload.hangup_cause ? ` (${payload.hangup_cause})` : ""}`,
  };
  if (payload.recording_url) patch.recordingUrl = payload.recording_url;
  if (durationSeconds !== undefined) patch.durationSeconds = durationSeconds;

  await mergeActivityDetailsByExternalRefId(payload.ref_id, patch);
}
