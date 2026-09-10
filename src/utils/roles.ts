export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  AGENT: "agent",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
