// Non-action exports for the intake Server Action. A `'use server'` file may only
// export async functions, so the useActionState initial-state object lives here in
// a sibling module with no `'use server'` directive. Mirrors invite-state.ts.

export interface UpdateIntakeState {
  error: string | null;
  success: boolean;
}

export const initialUpdateIntakeState: UpdateIntakeState = { error: null, success: false };
