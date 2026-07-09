/**
 * Hand-written to exactly match supabase/migrations/0001-0007 (applied to the real project).
 * `supabase gen types` normally generates this, but the CLI's --db-url path requires
 * Docker/Podman to run a metadata container, which isn't available in this environment.
 * If Docker becomes available later, regenerate with:
 *   npx supabase gen types typescript --db-url "<connection-string>" --schema public > src/types/database.ts
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          is_platform_admin: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          is_platform_admin?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          is_platform_admin?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          business_name: string;
          slug: string | null;
          meta_page_id: string | null;
          instagram_id: string | null;
          whatsapp_phone_number_id: string | null;
          sip_trunk_id: string | null;
          shopify_store_url: string | null;
          system_prompt: string;
          catalog_data: Json;
          llm_provider: string;
          llm_model: string;
          openai_key_secret_id: string | null;
          meta_token_secret_id: string | null;
          whatsapp_token_secret_id: string | null;
          widget_public_key: string | null;
          widget_allowed_origins: string[];
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_name: string;
          slug?: string | null;
          meta_page_id?: string | null;
          instagram_id?: string | null;
          whatsapp_phone_number_id?: string | null;
          sip_trunk_id?: string | null;
          shopify_store_url?: string | null;
          system_prompt?: string;
          catalog_data?: Json;
          llm_provider?: string;
          llm_model?: string;
          openai_key_secret_id?: string | null;
          meta_token_secret_id?: string | null;
          whatsapp_token_secret_id?: string | null;
          widget_public_key?: string | null;
          widget_allowed_origins?: string[];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_name?: string;
          slug?: string | null;
          meta_page_id?: string | null;
          instagram_id?: string | null;
          whatsapp_phone_number_id?: string | null;
          sip_trunk_id?: string | null;
          shopify_store_url?: string | null;
          system_prompt?: string;
          catalog_data?: Json;
          llm_provider?: string;
          llm_model?: string;
          openai_key_secret_id?: string | null;
          meta_token_secret_id?: string | null;
          whatsapp_token_secret_id?: string | null;
          widget_public_key?: string | null;
          widget_allowed_origins?: string[];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_tenants: {
        Row: {
          user_id: string;
          tenant_id: string;
          role: Database['public']['Enums']['member_role'];
          created_at: string;
        };
        Insert: {
          user_id: string;
          tenant_id: string;
          role?: Database['public']['Enums']['member_role'];
          created_at?: string;
        };
        Update: {
          user_id?: string;
          tenant_id?: string;
          role?: Database['public']['Enums']['member_role'];
          created_at?: string;
        };
        Relationships: [];
      };
      chat_sessions: {
        Row: {
          id: string;
          tenant_id: string;
          platform: Database['public']['Enums']['platform'];
          external_user_id: string;
          is_human_handoff: boolean;
          last_message_at: string;
          unread_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          platform: Database['public']['Enums']['platform'];
          external_user_id: string;
          is_human_handoff?: boolean;
          last_message_at?: string;
          unread_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          platform?: Database['public']['Enums']['platform'];
          external_user_id?: string;
          is_human_handoff?: boolean;
          last_message_at?: string;
          unread_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          session_id: string;
          tenant_id: string;
          role: Database['public']['Enums']['message_role'];
          content: string;
          provider_msg_id: string | null;
          token_count: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          tenant_id: string;
          role: Database['public']['Enums']['message_role'];
          content: string;
          provider_msg_id?: string | null;
          token_count?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          tenant_id?: string;
          role?: Database['public']['Enums']['message_role'];
          content?: string;
          provider_msg_id?: string | null;
          token_count?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      usage_logs: {
        Row: {
          id: string;
          tenant_id: string;
          session_id: string | null;
          provider: string;
          model: string;
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          estimated_cost_usd: number;
          used_byok: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          session_id?: string | null;
          provider: string;
          model: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          estimated_cost_usd?: number;
          used_byok?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string | null;
          provider?: string;
          model?: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          estimated_cost_usd?: number;
          used_byok?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          id: string;
          provider: string;
          provider_msg_id: string;
          tenant_id: string | null;
          received_at: string;
        };
        Insert: {
          id?: string;
          provider: string;
          provider_msg_id: string;
          tenant_id?: string | null;
          received_at?: string;
        };
        Update: {
          id?: string;
          provider?: string;
          provider_msg_id?: string;
          tenant_id?: string | null;
          received_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      user_can_access_tenant: {
        Args: { t: string };
        Returns: boolean;
      };
      set_tenant_secret: {
        Args: { p_name: string; p_value: string };
        Returns: string;
      };
      get_tenant_secret: {
        Args: { p_secret_id: string };
        Returns: string;
      };
    };
    Enums: {
      platform: 'whatsapp' | 'facebook' | 'instagram' | 'web' | 'voice';
      message_role: 'system' | 'user' | 'assistant' | 'tool';
      member_role: 'platform_admin' | 'tenant_admin' | 'tenant_agent';
    };
    CompositeTypes: Record<string, never>;
  };
};
