// Non-action exports for the dashboard Server Actions. A `'use server'` file may
// only export async functions (Next.js generates a client-callable reference for
// every export), so the useActionState initial-state object and the plain value
// constants live here, in a sibling module with no `'use server'` directive.
// Mirrors src/app/admin/clients/action-state.ts.

export interface RequestPlatformSetupState {
  error: string | null;
  success: boolean;
}

export const initialRequestPlatformSetupState: RequestPlatformSetupState = { error: null, success: false };

export interface EnableWidgetState {
  error: string | null;
  success: boolean;
}

export const initialEnableWidgetState: EnableWidgetState = { error: null, success: false };

export interface DisconnectChannelState {
  error: string | null;
}

/** Mirrors the `platform` DB enum (Database['public']['Enums']['platform'], minus 'voice') so the
 *  request UI can reuse the same labels/colors as the inbox. */
export const PLATFORM_CHANNEL_VALUES = ['whatsapp', 'facebook', 'instagram', 'web'] as const;
export type PlatformChannel = (typeof PLATFORM_CHANNEL_VALUES)[number];
