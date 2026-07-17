export interface InviteClientState {
  error: string | null;
  success: boolean;
}

export const initialInviteClientState: InviteClientState = { error: null, success: false };
