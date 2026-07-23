export interface QuickProvisionState {
  error: string | null;
  success: boolean;
  /** The new tenant's website-widget public key, shown once for copy-out. */
  widgetPublicKey: string | null;
  /** Human summary of what got imported/invited, shown on the success screen. */
  summary: string | null;
  /** Non-fatal issues (import/invite failed) — the client was still created. */
  warnings: string[];
}

export const initialQuickProvisionState: QuickProvisionState = {
  error: null,
  success: false,
  widgetPublicKey: null,
  summary: null,
  warnings: [],
};
