import { z } from 'zod';
import { StoreIdSchema, UserIdSchema } from '../common/identifiers.js';

/**
 * Architecture-approved store roles.
 * A single user can hold different roles across different stores (e.g. OWNER in Store A, STAFF in Store B).
 */
export const StoreRoleSchema = z.enum(['OWNER', 'MANAGER', 'STAFF'], {
  errorMap: () => ({
    message: "Store role must be 'OWNER', 'MANAGER', or 'STAFF'",
  }),
});

export type StoreRole = z.infer<typeof StoreRoleSchema>;

/**
 * Store membership lifecycle status.
 */
export const MembershipStatusSchema = z.enum(['ACTIVE', 'INVITED', 'SUSPENDED'], {
  errorMap: () => ({
    message: "Membership status must be 'ACTIVE', 'INVITED', or 'SUSPENDED'",
  }),
});

export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

/**
 * Store membership schema establishing the (user, store, role) relationship.
 *
 * TENANCY INVARIANT:
 * Roles are strictly store-scoped, NEVER global. A user has no global permissions across the platform,
 * only permissions explicitly granted within each store's membership record.
 */
export const StoreMembershipSchema = z.object({
  id: z.string().uuid({ message: 'Membership ID must be a valid UUID' }),
  userId: UserIdSchema,
  storeId: StoreIdSchema,
  role: StoreRoleSchema,
  status: MembershipStatusSchema.default('ACTIVE'),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type StoreMembership = z.infer<typeof StoreMembershipSchema>;

/**
 * Request payload for assigning or updating a user's role in a store.
 */
export const AssignMembershipInputSchema = z.object({
  userId: UserIdSchema,
  storeId: StoreIdSchema,
  role: StoreRoleSchema,
});

export type AssignMembershipInput = z.infer<typeof AssignMembershipInputSchema>;
