export interface CreateTenantState {
  error: string | null;
  success: boolean;
  widgetPublicKey: string | null;
}

export const initialCreateTenantState: CreateTenantState = {
  error: null,
  success: false,
  widgetPublicKey: null,
};

export interface UpdateTenantState {
  error: string | null;
  success: boolean;
}

export const initialUpdateTenantState: UpdateTenantState = { error: null, success: false };

export interface OffboardTenantState {
  error: string | null;
  success: boolean;
}

export const initialOffboardTenantState: OffboardTenantState = { error: null, success: false };
