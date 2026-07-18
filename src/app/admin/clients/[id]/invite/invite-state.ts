export interface InviteClientState {
  error: string | null;
  success: boolean;
  alreadyRegistered: boolean;
}

export const initialInviteClientState: InviteClientState = { error: null, success: false, alreadyRegistered: false };
