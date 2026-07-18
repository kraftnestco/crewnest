export interface InviteClientState {
  error: string | null;
  success: boolean;
  alreadyRegistered: boolean;
  /** A stale, never-accepted invite was replaced with a fresh one (new code sent). */
  resent: boolean;
}

export const initialInviteClientState: InviteClientState = {
  error: null,
  success: false,
  alreadyRegistered: false,
  resent: false,
};
