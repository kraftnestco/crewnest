export interface InviteTeamMemberState {
  error: string | null;
  success: boolean;
  alreadyRegistered: boolean;
  /** A stale, never-accepted invite was replaced with a fresh one (new code sent). */
  resent: boolean;
}

export const initialInviteTeamMemberState: InviteTeamMemberState = {
  error: null,
  success: false,
  alreadyRegistered: false,
  resent: false,
};

export interface TeamMemberActionState {
  error: string | null;
  success: boolean;
}

export const initialTeamMemberActionState: TeamMemberActionState = {
  error: null,
  success: false,
};
