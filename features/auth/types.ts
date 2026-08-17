export type UserRole = "user" | "admin";

export type AuthenticatedUser = {
  id: string;
  phone: string;
  displayName: string;
  role: UserRole;
};
