export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ab_assignments: {
        Row: {
          ab_test: string
          ab_var: string
          ab_vid: string
          assigned_at: string
          browser: string | null
          browser_version: string | null
          device_type: string | null
          fbclid: string | null
          gclid: string | null
          id: string
          landing_url: string | null
          language: string | null
          metadata: Json | null
          msclkid: string | null
          os: string | null
          raw_query: string | null
          referrer: string | null
          ttclid: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ab_test: string
          ab_var: string
          ab_vid: string
          assigned_at?: string
          browser?: string | null
          browser_version?: string | null
          device_type?: string | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          landing_url?: string | null
          language?: string | null
          metadata?: Json | null
          msclkid?: string | null
          os?: string | null
          raw_query?: string | null
          referrer?: string | null
          ttclid?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ab_test?: string
          ab_var?: string
          ab_vid?: string
          assigned_at?: string
          browser?: string | null
          browser_version?: string | null
          device_type?: string | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          landing_url?: string | null
          language?: string | null
          metadata?: Json | null
          msclkid?: string | null
          os?: string | null
          raw_query?: string | null
          referrer?: string | null
          ttclid?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      ab_config: {
        Row: {
          id: string
          production_domain: string
          updated_at: string
        }
        Insert: {
          id?: string
          production_domain?: string
          updated_at?: string
        }
        Update: {
          id?: string
          production_domain?: string
          updated_at?: string
        }
        Relationships: []
      }
      ab_events: {
        Row: {
          ab_test: string
          ab_var: string | null
          ab_vid: string
          browser: string | null
          browser_version: string | null
          created_at: string
          dedupe_key: string | null
          device_type: string | null
          dnia_id: string | null
          event_name: string | null
          event_type: string
          fbclid: string | null
          gclid: string | null
          id: string
          language: string | null
          lead_id: string | null
          metadata: Json | null
          msclkid: string | null
          occurred_at: string
          os: string | null
          page_slug: string | null
          raw_query: string | null
          referrer: string | null
          screen_resolution: string | null
          ttclid: string | null
          url: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ab_test: string
          ab_var?: string | null
          ab_vid: string
          browser?: string | null
          browser_version?: string | null
          created_at?: string
          dedupe_key?: string | null
          device_type?: string | null
          dnia_id?: string | null
          event_name?: string | null
          event_type: string
          fbclid?: string | null
          gclid?: string | null
          id?: string
          language?: string | null
          lead_id?: string | null
          metadata?: Json | null
          msclkid?: string | null
          occurred_at?: string
          os?: string | null
          page_slug?: string | null
          raw_query?: string | null
          referrer?: string | null
          screen_resolution?: string | null
          ttclid?: string | null
          url?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ab_test?: string
          ab_var?: string | null
          ab_vid?: string
          browser?: string | null
          browser_version?: string | null
          created_at?: string
          dedupe_key?: string | null
          device_type?: string | null
          dnia_id?: string | null
          event_name?: string | null
          event_type?: string
          fbclid?: string | null
          gclid?: string | null
          id?: string
          language?: string | null
          lead_id?: string | null
          metadata?: Json | null
          msclkid?: string | null
          occurred_at?: string
          os?: string | null
          page_slug?: string | null
          raw_query?: string | null
          referrer?: string | null
          screen_resolution?: string | null
          ttclid?: string | null
          url?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      ab_identities: {
        Row: {
          ab_vid: string
          dnia_id: string | null
          email: string | null
          id: string
          lead_id: string | null
          linked_at: string
          metadata: Json | null
          nexus_contact_id: string | null
          phone: string | null
          phone_normalized: string | null
          source_app: string | null
        }
        Insert: {
          ab_vid: string
          dnia_id?: string | null
          email?: string | null
          id?: string
          lead_id?: string | null
          linked_at?: string
          metadata?: Json | null
          nexus_contact_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          source_app?: string | null
        }
        Update: {
          ab_vid?: string
          dnia_id?: string | null
          email?: string | null
          id?: string
          lead_id?: string | null
          linked_at?: string
          metadata?: Json | null
          nexus_contact_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          source_app?: string | null
        }
        Relationships: []
      }
      ab_tests: {
        Row: {
          control_variant: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          guardrail_metric: string | null
          hypothesis: string | null
          id: string
          name: string
          primary_metric: string
          public_slug: string
          slug: string
          starts_at: string | null
          status: string
          target_sample_per_variant: number | null
          updated_at: string
          variants: Json
          winner_variant: string | null
        }
        Insert: {
          control_variant?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          guardrail_metric?: string | null
          hypothesis?: string | null
          id?: string
          name: string
          primary_metric?: string
          public_slug: string
          slug: string
          starts_at?: string | null
          status?: string
          target_sample_per_variant?: number | null
          updated_at?: string
          variants?: Json
          winner_variant?: string | null
        }
        Update: {
          control_variant?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          guardrail_metric?: string | null
          hypothesis?: string | null
          id?: string
          name?: string
          primary_metric?: string
          public_slug?: string
          slug?: string
          starts_at?: string | null
          status?: string
          target_sample_per_variant?: number | null
          updated_at?: string
          variants?: Json
          winner_variant?: string | null
        }
        Relationships: []
      }
      ai_chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          permissions: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          permissions?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          permissions?: string | null
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          action_metadata: Json | null
          action_type: string
          action_value: string | null
          condition_logic: string | null
          condition_operator: string
          condition_type: string
          condition_value: string
          conditions: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          updated_at: string | null
        }
        Insert: {
          action_metadata?: Json | null
          action_type: string
          action_value?: string | null
          condition_logic?: string | null
          condition_operator: string
          condition_type: string
          condition_value: string
          conditions?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          updated_at?: string | null
        }
        Update: {
          action_metadata?: Json | null
          action_type?: string
          action_value?: string | null
          condition_logic?: string | null
          condition_operator?: string
          condition_type?: string
          condition_value?: string
          conditions?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      campaign_sends: {
        Row: {
          campaign_id: string | null
          channel: string
          clicked_at: string | null
          created_at: string
          dnia_id: string | null
          error: string | null
          id: string
          journey_node_id: string | null
          journey_run_id: string | null
          lead_id: string | null
          opened_at: string | null
          recovery_count: number
          resend_email_id: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          campaign_id?: string | null
          channel: string
          clicked_at?: string | null
          created_at?: string
          dnia_id?: string | null
          error?: string | null
          id?: string
          journey_node_id?: string | null
          journey_run_id?: string | null
          lead_id?: string | null
          opened_at?: string | null
          recovery_count?: number
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          campaign_id?: string | null
          channel?: string
          clicked_at?: string | null
          created_at?: string
          dnia_id?: string | null
          error?: string | null
          id?: string
          journey_node_id?: string | null
          journey_run_id?: string | null
          lead_id?: string | null
          opened_at?: string | null
          recovery_count?: number
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sends_journey_run_id_fkey"
            columns: ["journey_run_id"]
            isOneToOne: false
            referencedRelation: "journey_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          body: string | null
          channel: string
          created_at: string | null
          design: Json | null
          excluded_segment_ids: string[]
          id: string
          name: string
          scheduled_at: string | null
          segment_id: string | null
          segment_ids: string[]
          sent_at: string | null
          stats: Json | null
          status: string | null
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          channel: string
          created_at?: string | null
          design?: Json | null
          excluded_segment_ids?: string[]
          id?: string
          name: string
          scheduled_at?: string | null
          segment_id?: string | null
          segment_ids?: string[]
          sent_at?: string | null
          stats?: Json | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string | null
          design?: Json | null
          excluded_segment_ids?: string[]
          id?: string
          name?: string
          scheduled_at?: string | null
          segment_id?: string | null
          segment_ids?: string[]
          sent_at?: string | null
          stats?: Json | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      challenge_insights: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          insights: Json
          leads_analyzed: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          insights: Json
          leads_analyzed?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          insights?: Json
          leads_analyzed?: number
        }
        Relationships: []
      }
      contact_events: {
        Row: {
          description: string | null
          dnia_id: string | null
          event_type: string
          id: string
          lead_id: string | null
          metadata: Json | null
          occurred_at: string | null
          source_app: string
          title: string
        }
        Insert: {
          description?: string | null
          dnia_id?: string | null
          event_type: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          source_app: string
          title: string
        }
        Update: {
          description?: string | null
          dnia_id?: string | null
          event_type?: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          source_app?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_settings: {
        Row: {
          created_at: string | null
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          setting_key: string
          setting_value: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      ecosystem_identities: {
        Row: {
          created_at: string | null
          dndash_lead_id: string | null
          dnia_id: string
          email: string | null
          first_touch_app: string | null
          first_touch_source: string | null
          last_seen_at: string | null
          mentoria_client_id: string | null
          nexus_contact_id: string | null
          nome: string | null
          phone: string | null
          stage: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          dndash_lead_id?: string | null
          dnia_id?: string
          email?: string | null
          first_touch_app?: string | null
          first_touch_source?: string | null
          last_seen_at?: string | null
          mentoria_client_id?: string | null
          nexus_contact_id?: string | null
          nome?: string | null
          phone?: string | null
          stage?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          dndash_lead_id?: string | null
          dnia_id?: string
          email?: string | null
          first_touch_app?: string | null
          first_touch_source?: string | null
          last_seen_at?: string | null
          mentoria_client_id?: string | null
          nexus_contact_id?: string | null
          nome?: string | null
          phone?: string | null
          stage?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      email_events: {
        Row: {
          campaign_id: string | null
          campaign_send_id: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string | null
          occurred_at: string
          payload: Json
          resend_email_id: string | null
          svix_id: string
        }
        Insert: {
          campaign_id?: string | null
          campaign_send_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id?: string | null
          occurred_at: string
          payload: Json
          resend_email_id?: string | null
          svix_id: string
        }
        Update: {
          campaign_id?: string | null
          campaign_send_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
          resend_email_id?: string | null
          svix_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_campaign_send_id_fkey"
            columns: ["campaign_send_id"]
            isOneToOne: false
            referencedRelation: "campaign_sends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          id: string
          lead_id: string | null
          reason: string
          source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          lead_id?: string | null
          reason: string
          source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          lead_id?: string | null
          reason?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          design: Json | null
          html: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          design?: Json | null
          html?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          design?: Json | null
          html?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      journey_runs: {
        Row: {
          context: Json
          current_node_id: string | null
          entered_at: string
          id: string
          journey_id: string
          lead_id: string
          lock_token: string | null
          locked_until: string | null
          state: string
          updated_at: string
          waiting_event: string | null
          wakeup_at: string
        }
        Insert: {
          context?: Json
          current_node_id?: string | null
          entered_at?: string
          id?: string
          journey_id: string
          lead_id: string
          lock_token?: string | null
          locked_until?: string | null
          state?: string
          updated_at?: string
          waiting_event?: string | null
          wakeup_at?: string
        }
        Update: {
          context?: Json
          current_node_id?: string | null
          entered_at?: string
          id?: string
          journey_id?: string
          lead_id?: string
          lock_token?: string | null
          locked_until?: string | null
          state?: string
          updated_at?: string
          waiting_event?: string | null
          wakeup_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_runs_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_step_log: {
        Row: {
          detail: Json
          id: string
          journey_id: string
          lead_id: string | null
          node_id: string
          node_type: string
          occurred_at: string
          result: string
          run_id: string
        }
        Insert: {
          detail?: Json
          id?: string
          journey_id: string
          lead_id?: string | null
          node_id: string
          node_type: string
          occurred_at?: string
          result: string
          run_id: string
        }
        Update: {
          detail?: Json
          id?: string
          journey_id?: string
          lead_id?: string | null
          node_id?: string
          node_type?: string
          occurred_at?: string
          result?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_step_log_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_step_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_step_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "journey_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      journeys: {
        Row: {
          created_at: string
          description: string | null
          entry_config: Json
          entry_node_id: string | null
          entry_type: string
          id: string
          name: string
          nodes: Json
          reentry: string
          reentry_cooldown_hours: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entry_config?: Json
          entry_node_id?: string | null
          entry_type: string
          id?: string
          name: string
          nodes?: Json
          reentry?: string
          reentry_cooldown_hours?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entry_config?: Json
          entry_node_id?: string | null
          entry_type?: string
          id?: string
          name?: string
          nodes?: Json
          reentry?: string
          reentry_cooldown_hours?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_conversions: {
        Row: {
          ab_test: string | null
          ab_var: string | null
          ab_vid: string | null
          converted_at: string
          id: string
          lead_id: string
          page_slug: string | null
          session_id: string | null
          source: string | null
          tipo: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ab_test?: string | null
          ab_var?: string | null
          ab_vid?: string | null
          converted_at?: string
          id?: string
          lead_id: string
          page_slug?: string | null
          session_id?: string | null
          source?: string | null
          tipo?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ab_test?: string | null
          ab_var?: string | null
          ab_vid?: string | null
          converted_at?: string
          id?: string
          lead_id?: string
          page_slug?: string | null
          session_id?: string | null
          source?: string | null
          tipo?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_conversions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          content: string
          created_at: string | null
          id: string
          lead_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          lead_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_statuses: {
        Row: {
          color: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      lead_tags: {
        Row: {
          lead_id: string
          tag_id: string
        }
        Insert: {
          lead_id: string
          tag_id: string
        }
        Update: {
          lead_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ab_test: string | null
          ab_var: string | null
          ab_vid: string | null
          cargo: string | null
          created_at: string | null
          data_interesse: string | null
          deleted_at: string | null
          deleted_by: string | null
          desafios: string | null
          dnia_id: string | null
          email: string | null
          empresa: string | null
          etiqueta: string | null
          faturamento: string | null
          funcionarios: string | null
          id: string
          indicacao: string | null
          interesse_ecossistema: boolean | null
          interesse_formacao: boolean | null
          interesse_mtia: boolean | null
          last_conversion_date: string | null
          lead_score: number | null
          nome: string | null
          origem_campanha: string | null
          phone_normalized: string | null
          presenca: string | null
          session_id: string | null
          source: string | null
          status: string | null
          tipo: string
          tipo_participante: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          whatsapp: string | null
        }
        Insert: {
          ab_test?: string | null
          ab_var?: string | null
          ab_vid?: string | null
          cargo?: string | null
          created_at?: string | null
          data_interesse?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          desafios?: string | null
          dnia_id?: string | null
          email?: string | null
          empresa?: string | null
          etiqueta?: string | null
          faturamento?: string | null
          funcionarios?: string | null
          id?: string
          indicacao?: string | null
          interesse_ecossistema?: boolean | null
          interesse_formacao?: boolean | null
          interesse_mtia?: boolean | null
          last_conversion_date?: string | null
          lead_score?: number | null
          nome?: string | null
          origem_campanha?: string | null
          phone_normalized?: string | null
          presenca?: string | null
          session_id?: string | null
          source?: string | null
          status?: string | null
          tipo: string
          tipo_participante?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          whatsapp?: string | null
        }
        Update: {
          ab_test?: string | null
          ab_var?: string | null
          ab_vid?: string | null
          cargo?: string | null
          created_at?: string | null
          data_interesse?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          desafios?: string | null
          dnia_id?: string | null
          email?: string | null
          empresa?: string | null
          etiqueta?: string | null
          faturamento?: string | null
          funcionarios?: string | null
          id?: string
          indicacao?: string | null
          interesse_ecossistema?: boolean | null
          interesse_formacao?: boolean | null
          interesse_mtia?: boolean | null
          last_conversion_date?: string | null
          lead_score?: number | null
          nome?: string | null
          origem_campanha?: string | null
          phone_normalized?: string | null
          presenca?: string | null
          session_id?: string | null
          source?: string | null
          status?: string | null
          tipo?: string
          tipo_participante?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      meta_config: {
        Row: {
          access_token: string | null
          id: string
          pixel_id: string | null
          test_event_code: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_token?: string | null
          id?: string
          pixel_id?: string | null
          test_event_code?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_token?: string | null
          id?: string
          pixel_id?: string | null
          test_event_code?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      nexus_config: {
        Row: {
          api_key: string | null
          base_url: string | null
          id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string | null
        }
        Insert: {
          api_key?: string | null
          base_url?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          api_key?: string | null
          base_url?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      pages: {
        Row: {
          component_name: string
          config: Json | null
          created_at: string | null
          description: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          name: string
          page_type: string
          slug: string
          status: string | null
          template_base: string | null
          updated_at: string | null
          webhook_url: string | null
          whatsapp_group_url: string | null
        }
        Insert: {
          component_name: string
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          name: string
          page_type: string
          slug: string
          status?: string | null
          template_base?: string | null
          updated_at?: string | null
          webhook_url?: string | null
          whatsapp_group_url?: string | null
        }
        Update: {
          component_name?: string
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          page_type?: string
          slug?: string
          status?: string | null
          template_base?: string | null
          updated_at?: string | null
          webhook_url?: string | null
          whatsapp_group_url?: string | null
        }
        Relationships: []
      }
      pingback_config: {
        Row: {
          convidado_url: string | null
          default_url: string | null
          id: string
          modal_url: string | null
          paid_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          convidado_url?: string | null
          default_url?: string | null
          id?: string
          modal_url?: string | null
          paid_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          convidado_url?: string | null
          default_url?: string | null
          id?: string
          modal_url?: string | null
          paid_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      scoring_config: {
        Row: {
          criteria: Json
          id: string
          thresholds: Json
          updated_at: string | null
        }
        Insert: {
          criteria?: Json
          id?: string
          thresholds?: Json
          updated_at?: string | null
        }
        Update: {
          criteria?: Json
          id?: string
          thresholds?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      segment_contacts: {
        Row: {
          added_at: string | null
          lead_id: string
          segment_id: string
        }
        Insert: {
          added_at?: string | null
          lead_id: string
          segment_id: string
        }
        Update: {
          added_at?: string | null
          lead_id?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_contacts_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          logic: string
          name: string
          rules: Json | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          logic?: string
          name: string
          rules?: Json | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          logic?: string
          name?: string
          rules?: Json | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          payload: Json | null
          response_body: string | null
          status_code: number | null
          success: boolean | null
          webhook_url: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          payload?: Json | null
          response_body?: string | null
          status_code?: number | null
          success?: boolean | null
          webhook_url: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          payload?: Json | null
          response_body?: string | null
          status_code?: number | null
          success?: boolean | null
          webhook_url?: string
        }
        Relationships: []
      }
    }
    Views: {
      page_stats: {
        Row: {
          config: Json | null
          created_at: string | null
          hot_leads: number | null
          id: string | null
          last_lead_at: string | null
          name: string | null
          page_type: string | null
          slug: string | null
          status: string | null
          template_base: string | null
          total_leads: number | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ab_activate_test: {
        Args: { p_force?: boolean; p_test_id: string }
        Returns: Json
      }
      build_segment_condition: { Args: { p_rule: Json }; Returns: string }
      count_segment_audience: {
        Args: { p_exclude?: string[]; p_include: string[] }
        Returns: number
      }
      delete_integration_secret: {
        Args: { p_name: string }
        Returns: undefined
      }
      email_queue_delete: { Args: { p_msg_ids: Json }; Returns: number }
      email_queue_read: {
        Args: { p_qty?: number; p_vt?: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      email_queue_send_batch: { Args: { p_messages: Json }; Returns: number }
      evaluate_rules_for_lead: {
        Args: { p_lead_id: string; p_logic?: string; p_rules: Json }
        Returns: boolean
      }
      evaluate_segment_for_lead: {
        Args: { p_lead_id: string; p_segment_id: string }
        Returns: boolean
      }
      evaluate_segment_rules: {
        Args: { p_segment_id: string }
        Returns: {
          lead_id: string
        }[]
      }
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      finalize_campaign_if_drained: {
        Args: { p_campaign_id: string }
        Returns: boolean
      }
      get_integration_secret: { Args: { p_name: string }; Returns: string }
      get_page_clarity: { Args: { _slug: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_edge_function: {
        Args: { p_body?: Json; p_function: string }
        Returns: number
      }
      journey_claim_due_runs: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          context: Json
          current_node_id: string
          journey_id: string
          lead_id: string
          lock_token: string
          nodes: Json
          reentry: string
          run_id: string
          state: string
          waiting_event: string
        }[]
      }
      journey_enqueue_email: {
        Args: {
          p_journey_id: string
          p_lead_id: string
          p_node_id: string
          p_run_id: string
        }
        Returns: Json
      }
      journey_enroll_event: {
        Args: { p_event_type: string; p_lead_id: string }
        Returns: number
      }
      journey_enroll_segment: {
        Args: { p_journey_id: string; p_limit?: number }
        Returns: number
      }
      journey_node_metrics: { Args: { p_journey_id: string }; Returns: Json }
      journey_queue_delete: { Args: { p_msg_ids: Json }; Returns: number }
      journey_queue_read: {
        Args: { p_qty?: number; p_vt?: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      journey_wake_on_event: {
        Args: {
          p_event_type: string
          p_lead_id: string
          p_metadata?: Json
          p_occurred_at: string
        }
        Returns: Json
      }
      merge_identities: {
        Args: { p_discard: string; p_keep: string }
        Returns: Json
      }
      mql_reuniao_agendada_today: {
        Args: never
        Returns: {
          lead_id: string
        }[]
      }
      normalize_phone_br: { Args: { raw: string }; Returns: string }
      preview_segment_rules: {
        Args: { p_logic?: string; p_rules: Json }
        Returns: {
          lead_id: string
        }[]
      }
      promote_scheduled_campaigns: { Args: never; Returns: number }
      recover_lost_journey_sends: { Args: never; Returns: Json }
      recover_lost_sends: { Args: never; Returns: Json }
      requeue_orphan_journey_sends: { Args: never; Returns: number }
      reset_stuck_campaigns: { Args: never; Returns: number }
      resolve_or_create_identity: {
        Args: {
          p_email?: string
          p_local_id?: string
          p_nome?: string
          p_phone?: string
          p_source_app?: string
          p_stage?: string
          p_utm_source?: string
        }
        Returns: Json
      }
      resolve_segment_audience: {
        Args: { p_exclude?: string[]; p_include: string[]; p_limit?: number }
        Returns: {
          lead_id: string
        }[]
      }
      set_integration_secret: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      validate_journey_graph: {
        Args: { p_entry_node_id: string; p_nodes: Json }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
