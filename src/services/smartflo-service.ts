import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { SMARTFLO_BASE_URL, isSmartfloConfigured } from "../config/smartflo";
import { env } from "../config/env";
import { createActivityForLead } from "./activity-service";
import { getLeadById } from "./lead-service";

interface ClickToCallResponse {
  success: boolean;
  message: string;
  ref_id?: string;
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
    throw new ApiError(409, "Add your Smartflo agent number under Sales force management first");
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
