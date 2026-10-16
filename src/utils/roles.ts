export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  AGENT: "agent",
  CALL_CENTER: "call_center",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
