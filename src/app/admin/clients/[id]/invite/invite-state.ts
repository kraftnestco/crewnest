export interface InviteClientState {
  error: string | null;
  success: boolean;
  resent: boolean;
}

export const initialInviteClientState: InviteClientState = { error: null, success: false, resent: false };
