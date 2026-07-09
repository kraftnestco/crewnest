/**
 * PLACEHOLDER — replace with generated types once the schema is applied:
 *
 *   npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts
 *
 * Until then this is a PERMISSIVE-but-valid schema shape: it satisfies
 * supabase-js's `GenericSchema` (so `.from(...).insert(...)` and `.rpc(...)`
 * type-check loosely) without asserting real column types. The generated file
 * will supersede everything below and give full type-safety. See docs/08 §2.4.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type GenericRow = Record<string, unknown>;

type GenericTable = {
  Row: GenericRow;
  Insert: GenericRow;
  Update: GenericRow;
  Relationships: [];
};

type GenericFunction = {
  Args: Record<string, unknown>;
  Returns: unknown;
};

export type Database = {
  public: {
    Tables: { [key: string]: GenericTable };
    Views: { [key: string]: GenericTable };
    Functions: { [key: string]: GenericFunction };
    Enums: {
      platform: 'whatsapp' | 'facebook' | 'instagram' | 'web' | 'voice';
      message_role: 'system' | 'user' | 'assistant' | 'tool';
      member_role: 'platform_admin' | 'tenant_admin' | 'tenant_agent';
    };
    CompositeTypes: { [key: string]: never };
  };
};
