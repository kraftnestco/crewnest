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
          notification_prefs: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          is_platform_admin?: boolean;
          notification_prefs?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          is_platform_admin?: boolean;
          notification_prefs?: Json;
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
          catalog_freeform_text: string | null;
          llm_provider: string;
          llm_model: string;
          openai_key_secret_id: string | null;
          meta_token_secret_id: string | null;
          whatsapp_token_secret_id: string | null;
          widget_public_key: string | null;
          widget_allowed_origins: string[];
          is_active: boolean;
          orders_enabled: boolean;
          owner_notify_whatsapp: string | null;
          owner_notify_template: string | null;
          custom_orders_enabled: boolean;
          custom_orders_require_approval: boolean;
          custom_order_instructions: string | null;
          media_handling: string | null;
          business_type: string;
          booking_link: string | null;
          knowledge_base: Json | null;
          business_hours: Json | null;
          timezone: string | null;
          payments_enabled: boolean;
          payment_methods: string[];
          payment_instructions: string | null;
          payment_provider: string | null;
          payment_key_secret_id: string | null;
          default_currency: string;
          prepaid_required: boolean;
          requested_platforms: string[];
          platform_setup_notes: string | null;
          platform_setup_requested_at: string | null;
          intake_completed_at: string | null;
          plan: string;
          plan_status: string | null;
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
          catalog_freeform_text?: string | null;
          llm_provider?: string;
          llm_model?: string;
          openai_key_secret_id?: string | null;
          meta_token_secret_id?: string | null;
          whatsapp_token_secret_id?: string | null;
          widget_public_key?: string | null;
          widget_allowed_origins?: string[];
          is_active?: boolean;
          orders_enabled?: boolean;
          owner_notify_whatsapp?: string | null;
          owner_notify_template?: string | null;
          custom_orders_enabled?: boolean;
          custom_orders_require_approval?: boolean;
          custom_order_instructions?: string | null;
          media_handling?: string | null;
          business_type?: string;
          booking_link?: string | null;
          knowledge_base?: Json | null;
          business_hours?: Json | null;
          timezone?: string | null;
          payments_enabled?: boolean;
          payment_methods?: string[];
          payment_instructions?: string | null;
          payment_provider?: string | null;
          payment_key_secret_id?: string | null;
          default_currency?: string;
          prepaid_required?: boolean;
          requested_platforms?: string[];
          platform_setup_notes?: string | null;
          platform_setup_requested_at?: string | null;
          intake_completed_at?: string | null;
          plan?: string;
          plan_status?: string | null;
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
          catalog_freeform_text?: string | null;
          llm_provider?: string;
          llm_model?: string;
          openai_key_secret_id?: string | null;
          meta_token_secret_id?: string | null;
          whatsapp_token_secret_id?: string | null;
          widget_public_key?: string | null;
          widget_allowed_origins?: string[];
          is_active?: boolean;
          orders_enabled?: boolean;
          owner_notify_whatsapp?: string | null;
          owner_notify_template?: string | null;
          custom_orders_enabled?: boolean;
          custom_orders_require_approval?: boolean;
          custom_order_instructions?: string | null;
          media_handling?: string | null;
          business_type?: string;
          booking_link?: string | null;
          knowledge_base?: Json | null;
          business_hours?: Json | null;
          timezone?: string | null;
          payments_enabled?: boolean;
          payment_methods?: string[];
          payment_instructions?: string | null;
          payment_provider?: string | null;
          payment_key_secret_id?: string | null;
          default_currency?: string;
          prepaid_required?: boolean;
          requested_platforms?: string[];
          platform_setup_notes?: string | null;
          platform_setup_requested_at?: string | null;
          intake_completed_at?: string | null;
          plan?: string;
          plan_status?: string | null;
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
          alert_signal: string | null;
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
          alert_signal?: string | null;
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
          alert_signal?: string | null;
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
          attachments: Json | null;
          delivery_failed: boolean;
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
          attachments?: Json | null;
          delivery_failed?: boolean;
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
          attachments?: Json | null;
          delivery_failed?: boolean;
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
      orders: {
        Row: {
          id: string;
          tenant_id: string;
          session_id: string | null;
          status: Database['public']['Enums']['order_status'];
          customer_name: string | null;
          customer_phone: string | null;
          customer_address: string | null;
          items: Json;
          notes: string | null;
          platform: Database['public']['Enums']['platform'] | null;
          external_user_id: string | null;
          owner_notified_at: string | null;
          attachments: Json | null;
          payment_status: Database['public']['Enums']['payment_status'];
          payment_method: string | null;
          payment_provider: string | null;
          payment_reference: string | null;
          amount_total: number | null;
          currency: string | null;
          paid_at: string | null;
          payment_proof: Json | null;
          dedupe_fingerprint: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          session_id?: string | null;
          status?: Database['public']['Enums']['order_status'];
          customer_name?: string | null;
          customer_phone?: string | null;
          customer_address?: string | null;
          items?: Json;
          notes?: string | null;
          platform?: Database['public']['Enums']['platform'] | null;
          external_user_id?: string | null;
          owner_notified_at?: string | null;
          attachments?: Json | null;
          payment_status?: Database['public']['Enums']['payment_status'];
          payment_method?: string | null;
          payment_provider?: string | null;
          payment_reference?: string | null;
          amount_total?: number | null;
          currency?: string | null;
          paid_at?: string | null;
          payment_proof?: Json | null;
          dedupe_fingerprint?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string | null;
          status?: Database['public']['Enums']['order_status'];
          customer_name?: string | null;
          customer_phone?: string | null;
          customer_address?: string | null;
          items?: Json;
          notes?: string | null;
          platform?: Database['public']['Enums']['platform'] | null;
          external_user_id?: string | null;
          owner_notified_at?: string | null;
          attachments?: Json | null;
          payment_status?: Database['public']['Enums']['payment_status'];
          payment_method?: string | null;
          payment_provider?: string | null;
          payment_reference?: string | null;
          amount_total?: number | null;
          currency?: string | null;
          paid_at?: string | null;
          payment_proof?: Json | null;
          dedupe_fingerprint?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_chunks: {
        Row: {
          id: string;
          tenant_id: string;
          source: string;
          source_ref: string | null;
          content: string;
          embedding: string | null;
          token_count: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          source: string;
          source_ref?: string | null;
          content: string;
          embedding?: string | null;
          token_count?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          source?: string;
          source_ref?: string | null;
          content?: string;
          embedding?: string | null;
          token_count?: number | null;
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
      notifications: {
        Row: {
          id: string;
          scope: string;
          tenant_id: string | null;
          type: string;
          title: string;
          body: string | null;
          entity_type: string | null;
          entity_id: string | null;
          link: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          scope: string;
          tenant_id?: string | null;
          type: string;
          title: string;
          body?: string | null;
          entity_type?: string | null;
          entity_id?: string | null;
          link: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          scope?: string;
          tenant_id?: string | null;
          type?: string;
          title?: string;
          body?: string | null;
          entity_type?: string | null;
          entity_id?: string | null;
          link?: string;
          is_read?: boolean;
          created_at?: string;
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
      match_knowledge_chunks: {
        Args: { p_tenant: string; p_query: string; p_k: number };
        Returns: { id: string; source: string; source_ref: string | null; content: string; distance: number }[];
      };
      create_order_atomic: {
        Args: {
          p_tenant_id: string;
          p_session_id: string | null;
          p_platform: Database['public']['Enums']['platform'] | null;
          p_external_user_id: string | null;
          p_items: Json;
          p_customer_name: string | null;
          p_customer_phone: string | null;
          p_customer_address: string | null;
          p_notes: string | null;
          p_status: Database['public']['Enums']['order_status'];
          p_attachments: Json | null;
          p_payment_method: string | null;
          p_amount_total: number | null;
          p_currency: string | null;
          p_fingerprint: string;
          p_dedupe_window_minutes: number;
        };
        Returns: Json;
      };
    };
    Enums: {
      platform: 'whatsapp' | 'facebook' | 'instagram' | 'web' | 'voice';
      message_role: 'system' | 'user' | 'assistant' | 'tool';
      member_role: 'platform_admin' | 'tenant_admin' | 'tenant_agent';
      order_status: 'pending' | 'confirmed' | 'cancelled' | 'fulfilled';
      payment_status: 'unpaid' | 'awaiting_verification' | 'paid' | 'refunded' | 'failed';
    };
    CompositeTypes: Record<string, never>;
  };
};
