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
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
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
          instagram_token_secret_id: string | null;
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
          voice_handling: string | null;
          csat_prompt_enabled: boolean;
          business_type: string;
          booking_link: string | null;
          booking_enabled: boolean;
          booking_mode: string | null;
          booking_own_link: string | null;
          booking_duration_minutes: number;
          booking_lead_time_minutes: number;
          booking_max_days_ahead: number;
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
          daily_cost_alert_usd: number | null;
          free_monthly_cap_usd: number | null;
          message_retention_days: number | null;
          created_at: string;
          updated_at: string;
          referred_by: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          billing_provider: string;
          billing_country: string | null;
          safepay_customer_id: string | null;
          safepay_subscription_id: string | null;
          safepay_amount_minor: number | null;
          safepay_currency: string | null;
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
          instagram_token_secret_id?: string | null;
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
          voice_handling?: string | null;
          csat_prompt_enabled?: boolean;
          business_type?: string;
          booking_link?: string | null;
          booking_enabled?: boolean;
          booking_mode?: string | null;
          booking_own_link?: string | null;
          booking_duration_minutes?: number;
          booking_lead_time_minutes?: number;
          booking_max_days_ahead?: number;
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
          daily_cost_alert_usd?: number | null;
          free_monthly_cap_usd?: number | null;
          message_retention_days?: number | null;
          created_at?: string;
          updated_at?: string;
          referred_by?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          billing_provider?: string;
          billing_country?: string | null;
          safepay_customer_id?: string | null;
          safepay_subscription_id?: string | null;
          safepay_amount_minor?: number | null;
          safepay_currency?: string | null;
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
          instagram_token_secret_id?: string | null;
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
          voice_handling?: string | null;
          business_type?: string;
          booking_link?: string | null;
          booking_enabled?: boolean;
          booking_mode?: string | null;
          booking_own_link?: string | null;
          booking_duration_minutes?: number;
          booking_lead_time_minutes?: number;
          booking_max_days_ahead?: number;
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
          daily_cost_alert_usd?: number | null;
          free_monthly_cap_usd?: number | null;
          message_retention_days?: number | null;
          created_at?: string;
          updated_at?: string;
          referred_by?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          billing_provider?: string;
          billing_country?: string | null;
          safepay_customer_id?: string | null;
          safepay_subscription_id?: string | null;
          safepay_amount_minor?: number | null;
          safepay_currency?: string | null;
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
          handoff_cause: string | null;
          length_limit_reset_at: string | null;
          last_message_at: string;
          unread_count: number;
          pending_review_order_id: string | null;
          pending_clarification: Json | null;
          summary: string | null;
          summary_through_message_at: string | null;
          customer_name: string | null;
          customer_avatar_url: string | null;
          delivery_blocked_reason: string | null;
          turn_lease_until: string | null;
          turn_lease_id: string | null;
          inbound_epoch: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          platform: Database['public']['Enums']['platform'];
          external_user_id: string;
          is_human_handoff?: boolean;
          alert_signal?: string | null;
          handoff_cause?: string | null;
          length_limit_reset_at?: string | null;
          last_message_at?: string;
          unread_count?: number;
          pending_review_order_id?: string | null;
          pending_clarification?: Json | null;
          summary?: string | null;
          summary_through_message_at?: string | null;
          customer_name?: string | null;
          customer_avatar_url?: string | null;
          delivery_blocked_reason?: string | null;
          turn_lease_until?: string | null;
          turn_lease_id?: string | null;
          inbound_epoch?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          platform?: Database['public']['Enums']['platform'];
          external_user_id?: string;
          is_human_handoff?: boolean;
          alert_signal?: string | null;
          handoff_cause?: string | null;
          length_limit_reset_at?: string | null;
          last_message_at?: string;
          unread_count?: number;
          pending_review_order_id?: string | null;
          pending_clarification?: Json | null;
          summary?: string | null;
          summary_through_message_at?: string | null;
          customer_name?: string | null;
          customer_avatar_url?: string | null;
          delivery_blocked_reason?: string | null;
          turn_lease_until?: string | null;
          turn_lease_id?: string | null;
          inbound_epoch?: number;
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
          authored_by: string;
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
          authored_by?: string;
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
          authored_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      conversation_usage: {
        Row: {
          id: string;
          tenant_id: string;
          session_id: string;
          billed_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          session_id: string;
          billed_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string;
          billed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_usage_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_usage_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'chat_sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      usage_logs: {
        Row: {
          id: string;
          tenant_id: string;
          session_id: string | null;
          provider: string;
          model: string;
          prompt_tokens: number;
          /** Null on a superseded (aborted mid-flight) call — genuinely unknown, not zero. docs/23 §5.4. */
          completion_tokens: number | null;
          total_tokens: number;
          estimated_cost_usd: number;
          used_byok: boolean;
          superseded: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          session_id?: string | null;
          provider: string;
          model: string;
          prompt_tokens?: number;
          completion_tokens?: number | null;
          total_tokens?: number;
          estimated_cost_usd?: number;
          used_byok?: boolean;
          superseded?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string | null;
          provider?: string;
          model?: string;
          prompt_tokens?: number;
          completion_tokens?: number | null;
          total_tokens?: number;
          estimated_cost_usd?: number;
          used_byok?: boolean;
          superseded?: boolean;
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
          /** Per-tenant sequential (#1, #2, ...) — customer-facing; `id` (uuid) never is. Null on the very rare crash-between-claim-and-insert race the atomic function's transaction otherwise prevents. */
          order_number: number | null;
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
          status_history: Json;
          review_rating: number | null;
          review_text: string | null;
          review_requested_at: string | null;
          review_submitted_at: string | null;
          pii_erased_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          session_id?: string | null;
          status?: Database['public']['Enums']['order_status'];
          order_number?: number | null;
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
          status_history?: Json;
          review_rating?: number | null;
          review_text?: string | null;
          review_requested_at?: string | null;
          review_submitted_at?: string | null;
          pii_erased_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string | null;
          status?: Database['public']['Enums']['order_status'];
          order_number?: number | null;
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
          status_history?: Json;
          review_rating?: number | null;
          review_text?: string | null;
          review_requested_at?: string | null;
          review_submitted_at?: string | null;
          pii_erased_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      business_expenses: {
        Row: {
          id: string;
          tenant_id: string;
          label: string;
          amount: number;
          category: string;
          expense_date: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          label: string;
          amount: number;
          category?: string;
          expense_date?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          label?: string;
          amount?: number;
          category?: string;
          expense_date?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      appointments: {
        Row: {
          id: string;
          tenant_id: string;
          session_id: string | null;
          /** Per-tenant sequential, customer-facing (docs/24 §2.1) — `id` never is. */
          appointment_number: number | null;
          starts_at: string;
          duration_minutes: number;
          status: string;
          customer_name: string | null;
          customer_phone: string | null;
          notes: string | null;
          service_name: string | null;
          /** Null is a real state: a Cal.com outage must not fail a promised booking (docs/24 §4.3). */
          meeting_url: string | null;
          location_text: string | null;
          calcom_booking_uid: string | null;
          platform: Database['public']['Enums']['platform'] | null;
          external_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          session_id?: string | null;
          appointment_number?: number | null;
          starts_at: string;
          duration_minutes: number;
          status?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          notes?: string | null;
          service_name?: string | null;
          meeting_url?: string | null;
          location_text?: string | null;
          calcom_booking_uid?: string | null;
          platform?: Database['public']['Enums']['platform'] | null;
          external_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string | null;
          appointment_number?: number | null;
          starts_at?: string;
          duration_minutes?: number;
          status?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          notes?: string | null;
          service_name?: string | null;
          meeting_url?: string | null;
          location_text?: string | null;
          calcom_booking_uid?: string | null;
          platform?: Database['public']['Enums']['platform'] | null;
          external_user_id?: string | null;
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
      meta_deletion_requests: {
        Row: {
          confirmation_code: string;
          facebook_user_id: string;
          status: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          confirmation_code: string;
          facebook_user_id: string;
          status?: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          confirmation_code?: string;
          facebook_user_id?: string;
          status?: string;
          created_at?: string;
          completed_at?: string | null;
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
      stripe_events: {
        Row: {
          id: string;
          type: string;
          processed_at: string;
        };
        Insert: {
          id: string;
          type: string;
          processed_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          processed_at?: string;
        };
        Relationships: [];
      };
      safepay_events: {
        Row: {
          id: string;
          type: string;
          processed_at: string;
        };
        Insert: {
          id: string;
          type: string;
          processed_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          processed_at?: string;
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
      erasure_events: {
        Row: {
          id: string;
          tenant_id: string;
          subject_platform: Database['public']['Enums']['platform'] | null;
          subject_external_user_id: string | null;
          scope: string;
          requested_by: string | null;
          storage_objects_deleted: number;
          completed_at: string;
          note: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          subject_platform?: Database['public']['Enums']['platform'] | null;
          subject_external_user_id?: string | null;
          scope: string;
          requested_by?: string | null;
          storage_objects_deleted?: number;
          completed_at?: string;
          note?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          subject_platform?: Database['public']['Enums']['platform'] | null;
          subject_external_user_id?: string | null;
          scope?: string;
          requested_by?: string | null;
          storage_objects_deleted?: number;
          completed_at?: string;
          note?: string | null;
        };
        Relationships: [];
      };
      demo_leads: {
        Row: {
          id: string;
          email: string;
          business_name: string;
          business_type: string;
          intake_snapshot: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          business_name: string;
          business_type: string;
          intake_snapshot: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          business_name?: string;
          business_type?: string;
          intake_snapshot?: Json;
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
      delete_tenant_secret: {
        Args: { p_secret_id: string };
        Returns: undefined;
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
      increment_rate_limit_bucket: {
        Args: { p_bucket_key: string; p_window_start: number };
        Returns: number;
      };
      // docs/23-MESSAGE-BATCHING.md §3.2 — the per-session turn lease. `claim`
      // returns null (not false) when the lease is already held: the UPDATE
      // matches no row, so there is nothing to return.
      claim_session_turn: {
        Args: { p_session_id: string; p_lease_id: string; p_ttl_seconds: number };
        Returns: boolean | null;
      };
      renew_session_turn: {
        Args: { p_session_id: string; p_lease_id: string; p_ttl_seconds: number };
        Returns: boolean | null;
      };
      release_session_turn: {
        Args: { p_session_id: string; p_lease_id: string };
        Returns: boolean | null;
      };
      bump_inbound_epoch: {
        Args: { p_session_id: string };
        Returns: number;
      };
      // docs/24-APPOINTMENTS.md §4.2 — claims the per-tenant number and inserts
      // in one transaction. Returns the row as jsonb, or NULL when the slot was
      // taken (a lost race on the partial unique index) — null is "offer
      // alternatives", not an error.
      book_appointment_atomic: {
        Args: {
          p_tenant_id: string;
          p_session_id: string | null;
          p_starts_at: string;
          p_duration_minutes: number;
          p_customer_name: string | null;
          p_customer_phone: string | null;
          p_service_name: string | null;
          p_notes: string | null;
          p_platform: Database['public']['Enums']['platform'] | null;
          p_external_user_id: string | null;
          p_meeting_url: string | null;
          p_location_text: string | null;
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
