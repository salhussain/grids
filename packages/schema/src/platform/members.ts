import { z } from 'zod';

export const MemberRole = z.enum(['org_admin', 'member']);
export type MemberRole = z.infer<typeof MemberRole>;
export const MemberStatus = z.enum(['active', 'suspended']);
export type MemberStatus = z.infer<typeof MemberStatus>;

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const MemberDto = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  role: MemberRole,
  status: MemberStatus,
  /** Second factors from the identity provider; null when it couldn't be checked. */
  mfa: z.object({ enrolled: z.boolean(), methods: z.array(z.string()) }).nullable(),
  /** Primary org unit (workspace structure). */
  orgUnit: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Workspace roles granted (and where). */
  grants: z.array(z.object({ roleName: z.string(), orgUnitName: z.string().nullable() })),
  joinedAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type MemberDto = z.infer<typeof MemberDto>;

export const InvitationDto = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  phone: z.string().nullable(),
  role: MemberRole,
  orgUnitId: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InvitationDto = z.infer<typeof InvitationDto>;

export const MembersDto = z.object({
  members: z.array(MemberDto),
  invitations: z.array(InvitationDto),
  mfaRequired: z.boolean(),
});
export type MembersDto = z.infer<typeof MembersDto>;

export const CreateInvitationInput = z.object({
  email: z.email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  jobTitle: opt(100),
  department: opt(100),
  phone: opt(40),
  role: MemberRole.default('member'),
  message: opt(1000),
  /** Place the person in this org unit when they accept. */
  orgUnitId: z.uuid().optional(),
});
export type CreateInvitationInput = z.input<typeof CreateInvitationInput>;

/** Returned once, at creation: the raw token is never stored or shown again. */
export const CreatedInvitation = z.object({
  invitation: InvitationDto,
  inviteUrl: z.string(),
  emailSent: z.boolean(),
});
export type CreatedInvitation = z.infer<typeof CreatedInvitation>;

export const UpdateMemberInput = z.object({
  role: MemberRole.optional(),
  status: MemberStatus.optional(),
  jobTitle: z.string().trim().max(100).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;

export const InvitationPreview = z.object({
  tenantName: z.string(),
  tenantSlug: z.string(),
  idpOrgId: z.string().nullable(),
  email: z.string(),
  firstName: z.string().nullable(),
  role: MemberRole,
  mfaRequired: z.boolean(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

export const COLOR_MODES = ['light', 'dark', 'system'] as const;

/** Personal preferences; they follow the person across organisations. */
export const PreferencesDto = z.object({
  colorMode: z.enum(COLOR_MODES),
  /** Preferred interface language; null = the organisation's default. */
  locale: z.string().nullable(),
});
export type PreferencesDto = z.infer<typeof PreferencesDto>;
export const PreferencesInput = z.object({
  colorMode: z.enum(COLOR_MODES).optional(),
  locale: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .nullable()
    .optional(),
});
export type PreferencesInput = z.infer<typeof PreferencesInput>;

export const MeDto = z.object({
  id: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  /** Active platform staff. */
  isPlatformAdmin: z.boolean(),
  /** Effective console permissions (empty for non-staff). */
  permissions: z.array(z.string()),
  memberships: z.array(
    z.object({
      tenantId: z.string(),
      tenantName: z.string(),
      tenantSlug: z.string(),
      role: MemberRole,
      status: MemberStatus,
    }),
  ),
  preferences: PreferencesDto,
});
export type MeDto = z.infer<typeof MeDto>;
