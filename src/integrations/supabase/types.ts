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
      age_gate_events: {
        Row: {
          context: string
          created_at: string
          id: string
          ip_hash: string | null
          outcome: string
          path: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          outcome: string
          path?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          outcome?: string
          path?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      age_verifications: {
        Row: {
          adult_content_release: boolean
          adult_content_release_at: string | null
          adult_content_release_version: string | null
          date_of_birth: string
          id: string
          id_file_path: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_file_path: string | null
          status: string
          submitted_at: string
          user_id: string
        }
        Insert: {
          adult_content_release?: boolean
          adult_content_release_at?: string | null
          adult_content_release_version?: string | null
          date_of_birth: string
          id?: string
          id_file_path: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_file_path?: string | null
          status?: string
          submitted_at?: string
          user_id: string
        }
        Update: {
          adult_content_release?: boolean
          adult_content_release_at?: string | null
          adult_content_release_version?: string | null
          date_of_birth?: string
          id?: string
          id_file_path?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_file_path?: string | null
          status?: string
          submitted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          action: string | null
          created_at: string
          event: string
          id: string
          plan: string | null
          props: Json
          session_id: string | null
          tier_kind: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string
          event: string
          id?: string
          plan?: string | null
          props?: Json
          session_id?: string | null
          tier_kind?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string
          event?: string
          id?: string
          plan?: string | null
          props?: Json
          session_id?: string | null
          tier_kind?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      cohost_application_reviews: {
        Row: {
          application_id: string
          created_at: string
          decision: string
          id: string
          notes: string | null
          previous_status: string | null
          reviewer_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          decision: string
          id?: string
          notes?: string | null
          previous_status?: string | null
          reviewer_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          decision?: string
          id?: string
          notes?: string | null
          previous_status?: string | null
          reviewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohost_application_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "cohost_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      cohost_applications: {
        Row: {
          admin_notes: string | null
          age: number
          agreement_file_path: string | null
          agreement_uploaded_at: string | null
          availability: string | null
          bio: string | null
          city: string
          co_host_agreement_signed_at: string | null
          created_at: string
          display_name: string
          event_types: string | null
          handbook_signature_name: string | null
          handbook_version: string | null
          hosting_experience: string
          id: string
          instagram_handle: string | null
          other_socials: string | null
          relevant_experience: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          updated_at: string
          user_id: string
          why_join: string
        }
        Insert: {
          admin_notes?: string | null
          age: number
          agreement_file_path?: string | null
          agreement_uploaded_at?: string | null
          availability?: string | null
          bio?: string | null
          city: string
          co_host_agreement_signed_at?: string | null
          created_at?: string
          display_name: string
          event_types?: string | null
          handbook_signature_name?: string | null
          handbook_version?: string | null
          hosting_experience: string
          id?: string
          instagram_handle?: string | null
          other_socials?: string | null
          relevant_experience?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id: string
          why_join: string
        }
        Update: {
          admin_notes?: string | null
          age?: number
          agreement_file_path?: string | null
          agreement_uploaded_at?: string | null
          availability?: string | null
          bio?: string | null
          city?: string
          co_host_agreement_signed_at?: string | null
          created_at?: string
          display_name?: string
          event_types?: string | null
          handbook_signature_name?: string | null
          handbook_version?: string | null
          hosting_experience?: string
          id?: string
          instagram_handle?: string | null
          other_socials?: string | null
          relevant_experience?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
          why_join?: string
        }
        Relationships: []
      }
      cohost_handbook_acknowledgements: {
        Row: {
          acknowledged_at: string
          created_at: string
          handbook_version: string
          id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          created_at?: string
          handbook_version?: string
          id?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          created_at?: string
          handbook_version?: string
          id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      compliance_policy_agreements: {
        Row: {
          accepted_at: string
          accepted_by_user_id: string
          created_at: string
          event_id: string | null
          id: string
          ip_address: string | null
          policy_version_id: string
          policy_version_label: string
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          accepted_by_user_id: string
          created_at?: string
          event_id?: string | null
          id?: string
          ip_address?: string | null
          policy_version_id: string
          policy_version_label: string
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          accepted_by_user_id?: string
          created_at?: string
          event_id?: string | null
          id?: string
          ip_address?: string | null
          policy_version_id?: string
          policy_version_label?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_policy_agreements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_policy_agreements_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "compliance_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_policy_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          effective_at: string
          id: string
          is_current: boolean
          summary: string
          updated_at: string
          version: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          effective_at?: string
          id?: string
          is_current?: boolean
          summary: string
          updated_at?: string
          version: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          effective_at?: string
          id?: string
          is_current?: boolean
          summary?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      content_items: {
        Row: {
          cover_url: string | null
          created_at: string
          creator_id: string
          currency: string
          description: string | null
          id: string
          kind: string
          materials: string | null
          media_urls: Json
          moderation_notes: string | null
          moderation_reviewed_at: string | null
          moderation_reviewed_by: string | null
          moderation_status: string
          moderation_submitted_at: string
          price_cents: number | null
          published: boolean
          sizes: string[]
          subscribers_only: boolean
          title: string
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          creator_id: string
          currency?: string
          description?: string | null
          id?: string
          kind: string
          materials?: string | null
          media_urls?: Json
          moderation_notes?: string | null
          moderation_reviewed_at?: string | null
          moderation_reviewed_by?: string | null
          moderation_status?: string
          moderation_submitted_at?: string
          price_cents?: number | null
          published?: boolean
          sizes?: string[]
          subscribers_only?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          creator_id?: string
          currency?: string
          description?: string | null
          id?: string
          kind?: string
          materials?: string | null
          media_urls?: Json
          moderation_notes?: string | null
          moderation_reviewed_at?: string | null
          moderation_reviewed_by?: string | null
          moderation_status?: string
          moderation_submitted_at?: string
          price_cents?: number | null
          published?: boolean
          sizes?: string[]
          subscribers_only?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_purchases: {
        Row: {
          amount_cents: number
          content_item_id: string
          created_at: string
          environment: string
          id: string
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          content_item_id: string
          created_at?: string
          environment?: string
          id?: string
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          content_item_id?: string
          created_at?: string
          environment?: string
          id?: string
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_purchases_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_health_alerts: {
        Row: {
          alert_type: string
          created_at: string
          details: Json
          id: string
          job_name: string | null
          message: string
          resolved_at: string | null
          severity: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          details?: Json
          id?: string
          job_name?: string | null
          message: string
          resolved_at?: string | null
          severity: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          details?: Json
          id?: string
          job_name?: string | null
          message?: string
          resolved_at?: string | null
          severity?: string
        }
        Relationships: []
      }
      dunning_schedule: {
        Row: {
          created_at: string
          environment: string
          id: string
          last_sent_at: string | null
          last_sent_stage: string | null
          next_email_at: string
          stage: string
          stripe_invoice_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          last_sent_at?: string | null
          last_sent_stage?: string | null
          next_email_at: string
          stage?: string
          stripe_invoice_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          last_sent_at?: string | null
          last_sent_stage?: string | null
          next_email_at?: string
          stage?: string
          stripe_invoice_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      event_access_codes: {
        Row: {
          code: string
          created_at: string
          event_id: string
          id: string
          note: string | null
          used_at: string | null
          used_by_name: string | null
        }
        Insert: {
          code: string
          created_at?: string
          event_id: string
          id?: string
          note?: string | null
          used_at?: string | null
          used_by_name?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          event_id?: string
          id?: string
          note?: string | null
          used_at?: string | null
          used_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_access_codes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_documents: {
        Row: {
          content_type: string | null
          doc_type: Database["public"]["Enums"]["event_doc_type"]
          event_id: string
          file_name: string
          file_path: string
          id: string
          policy_version_id: string | null
          policy_version_label: string | null
          size_bytes: number | null
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          content_type?: string | null
          doc_type: Database["public"]["Enums"]["event_doc_type"]
          event_id: string
          file_name: string
          file_path: string
          id?: string
          policy_version_id?: string | null
          policy_version_label?: string | null
          size_bytes?: number | null
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          content_type?: string | null
          doc_type?: Database["public"]["Enums"]["event_doc_type"]
          event_id?: string
          file_name?: string
          file_path?: string
          id?: string
          policy_version_id?: string | null
          policy_version_label?: string | null
          size_bytes?: number | null
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_documents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_documents_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "compliance_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string | null
          capacity: number | null
          capacity_confirmed: boolean
          city: string | null
          compliance_notes: string | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          dress_code: string | null
          ends_at: string | null
          host_id: string
          id: string
          insurance_confirmed: boolean
          insurance_expires_on: string | null
          insurance_policy_number: string | null
          insurance_provider: string | null
          is_private: boolean
          legal_capacity: number | null
          permit_details: string | null
          permits_confirmed: boolean
          published: boolean
          starts_at: string
          tagline: string | null
          theme: string | null
          ticket_price_cents: number
          title: string
          updated_at: string
          venue_name: string
          waiver_text: string
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          capacity_confirmed?: boolean
          city?: string | null
          compliance_notes?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          dress_code?: string | null
          ends_at?: string | null
          host_id: string
          id?: string
          insurance_confirmed?: boolean
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          is_private?: boolean
          legal_capacity?: number | null
          permit_details?: string | null
          permits_confirmed?: boolean
          published?: boolean
          starts_at: string
          tagline?: string | null
          theme?: string | null
          ticket_price_cents?: number
          title: string
          updated_at?: string
          venue_name: string
          waiver_text?: string
        }
        Update: {
          address?: string | null
          capacity?: number | null
          capacity_confirmed?: boolean
          city?: string | null
          compliance_notes?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          dress_code?: string | null
          ends_at?: string | null
          host_id?: string
          id?: string
          insurance_confirmed?: boolean
          insurance_expires_on?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          is_private?: boolean
          legal_capacity?: number | null
          permit_details?: string | null
          permits_confirmed?: boolean
          published?: boolean
          starts_at?: string
          tagline?: string | null
          theme?: string | null
          ticket_price_cents?: number
          title?: string
          updated_at?: string
          venue_name?: string
          waiver_text?: string
        }
        Relationships: []
      }
      health_screening_reminder_log: {
        Row: {
          attempt_count: number
          channels: Json
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string
          last_attempt_at: string
          max_attempts: number
          next_retry_at: string | null
          reminder_type: string
          screening_id: string
          status: string
          user_id: string
          valid_until: string
        }
        Insert: {
          attempt_count?: number
          channels?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key: string
          last_attempt_at?: string
          max_attempts?: number
          next_retry_at?: string | null
          reminder_type?: string
          screening_id: string
          status?: string
          user_id: string
          valid_until: string
        }
        Update: {
          attempt_count?: number
          channels?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string
          last_attempt_at?: string
          max_attempts?: number
          next_retry_at?: string | null
          reminder_type?: string
          screening_id?: string
          status?: string
          user_id?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_screening_reminder_log_screening_id_fkey"
            columns: ["screening_id"]
            isOneToOne: false
            referencedRelation: "health_screenings"
            referencedColumns: ["id"]
          },
        ]
      }
      health_screenings: {
        Row: {
          created_at: string
          expiry_reminder_sent_at: string | null
          file_path: string
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          test_date: string
          updated_at: string
          user_id: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          expiry_reminder_sent_at?: string | null
          file_path: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          test_date: string
          updated_at?: string
          user_id: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          expiry_reminder_sent_at?: string | null
          file_path?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          test_date?: string
          updated_at?: string
          user_id?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      health_screenings_purge_log: {
        Row: {
          id: string
          original_screening_id: string
          purged_at: string
          reason: string
          status: string | null
          test_date: string | null
          user_id: string
          valid_until: string | null
        }
        Insert: {
          id?: string
          original_screening_id: string
          purged_at?: string
          reason: string
          status?: string | null
          test_date?: string | null
          user_id: string
          valid_until?: string | null
        }
        Update: {
          id?: string
          original_screening_id?: string
          purged_at?: string
          reason?: string
          status?: string | null
          test_date?: string | null
          user_id?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      memberships: {
        Row: {
          amount_cents: number | null
          created_at: string
          environment: string
          event_ticket_event_id: string | null
          event_ticket_used_at: string | null
          expires_at: string | null
          id: string
          kind: string
          private_session_bundle_granted_at: string | null
          private_session_bundle_id: string | null
          private_session_duration_minutes: number
          private_session_fulfilled_at: string | null
          private_session_requested_at: string | null
          stripe_session_id: string | null
          term_months: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          environment?: string
          event_ticket_event_id?: string | null
          event_ticket_used_at?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          private_session_bundle_granted_at?: string | null
          private_session_bundle_id?: string | null
          private_session_duration_minutes?: number
          private_session_fulfilled_at?: string | null
          private_session_requested_at?: string | null
          stripe_session_id?: string | null
          term_months?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          environment?: string
          event_ticket_event_id?: string | null
          event_ticket_used_at?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          private_session_bundle_granted_at?: string | null
          private_session_bundle_id?: string | null
          private_session_duration_minutes?: number
          private_session_fulfilled_at?: string | null
          private_session_requested_at?: string | null
          stripe_session_id?: string | null
          term_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_event_ticket_event_id_fkey"
            columns: ["event_ticket_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_private_session_bundle_id_fkey"
            columns: ["private_session_bundle_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link_url: string | null
          metadata: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link_url?: string | null
          metadata?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link_url?: string | null
          metadata?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      panty_orders: {
        Row: {
          admin_notes: string | null
          amount_cents: number
          created_at: string
          currency: string
          customer_email: string | null
          environment: string
          hours: number
          id: string
          shipping_city: string | null
          shipping_country: string | null
          shipping_line1: string | null
          shipping_line2: string | null
          shipping_name: string | null
          shipping_postal_code: string | null
          shipping_state: string | null
          status: string
          stripe_session_id: string | null
          updated_at: string
          user_id: string
          variant: string
        }
        Insert: {
          admin_notes?: string | null
          amount_cents?: number
          created_at?: string
          currency?: string
          customer_email?: string | null
          environment?: string
          hours: number
          id?: string
          shipping_city?: string | null
          shipping_country?: string | null
          shipping_line1?: string | null
          shipping_line2?: string | null
          shipping_name?: string | null
          shipping_postal_code?: string | null
          shipping_state?: string | null
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id: string
          variant: string
        }
        Update: {
          admin_notes?: string | null
          amount_cents?: number
          created_at?: string
          currency?: string
          customer_email?: string | null
          environment?: string
          hours?: number
          id?: string
          shipping_city?: string | null
          shipping_country?: string | null
          shipping_line1?: string | null
          shipping_line2?: string | null
          shipping_name?: string | null
          shipping_postal_code?: string | null
          shipping_state?: string | null
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      partnership_inquiries: {
        Row: {
          created_at: string
          email: string
          id: string
          inquiry_type: string | null
          message: string
          name: string
          notes: string | null
          organization: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          inquiry_type?: string | null
          message: string
          name: string
          notes?: string | null
          organization?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          inquiry_type?: string | null
          message?: string
          name?: string
          notes?: string | null
          organization?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      partnership_replies: {
        Row: {
          body: string
          created_at: string
          id: string
          inquiry_id: string
          sent_by: string | null
          subject: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          inquiry_id: string
          sent_by?: string | null
          subject: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          inquiry_id?: string
          sent_by?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "partnership_replies_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "partnership_inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      private_room_bookings: {
        Row: {
          amount_cents: number | null
          created_at: string
          currency: string
          customer_email: string | null
          duration_minutes: number
          environment: string
          id: string
          notes: string | null
          starts_at: string
          status: string
          stripe_session_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          duration_minutes: number
          environment?: string
          id?: string
          notes?: string | null
          starts_at: string
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          duration_minutes?: number
          environment?: string
          id?: string
          notes?: string | null
          starts_at?: string
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age_gate_confirmed_at: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          pending_deletion_at: string | null
          user_id: string
        }
        Insert: {
          age_gate_confirmed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          pending_deletion_at?: string | null
          user_id: string
        }
        Update: {
          age_gate_confirmed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          pending_deletion_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reminder_job_config: {
        Row: {
          daily_run_time_utc: string
          expiring_within_days: number
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          daily_run_time_utc?: string
          expiring_within_days?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          daily_run_time_utc?: string
          expiring_within_days?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      rsvps: {
        Row: {
          age_confirmed_at: string | null
          checked_in_at: string | null
          checked_in_by: string | null
          consent_at_checkin: Json | null
          consent_confirmed_at: string | null
          created_at: string
          door_notes: string | null
          entry_code: string
          entry_phrase: string | null
          event_id: string
          guest_count: number
          id: string
          status: string
          ticket_code: string
          user_id: string
          video_consent: Json
          waiver_accepted_at: string | null
          waiver_signature: string | null
          waiver_text_hash: string | null
        }
        Insert: {
          age_confirmed_at?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          consent_at_checkin?: Json | null
          consent_confirmed_at?: string | null
          created_at?: string
          door_notes?: string | null
          entry_code?: string
          entry_phrase?: string | null
          event_id: string
          guest_count?: number
          id?: string
          status?: string
          ticket_code?: string
          user_id: string
          video_consent?: Json
          waiver_accepted_at?: string | null
          waiver_signature?: string | null
          waiver_text_hash?: string | null
        }
        Update: {
          age_confirmed_at?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          consent_at_checkin?: Json | null
          consent_confirmed_at?: string | null
          created_at?: string
          door_notes?: string | null
          entry_code?: string
          entry_phrase?: string | null
          event_id?: string
          guest_count?: number
          id?: string
          status?: string
          ticket_code?: string
          user_id?: string
          video_consent?: Json
          waiver_accepted_at?: string | null
          waiver_signature?: string | null
          waiver_text_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_incident_attachments: {
        Row: {
          created_at: string
          description: string | null
          file_name: string
          file_path: string
          id: string
          incident_id: string
          mime_type: string | null
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_name: string
          file_path: string
          id?: string
          incident_id: string
          mime_type?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          file_name?: string
          file_path?: string
          id?: string
          incident_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_incident_attachments_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "safety_incident_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_incident_export_log: {
        Row: {
          columns: string[]
          exported_at: string
          exported_by: string
          format: string
          id: string
          row_count: number
          search: string
          view: string
        }
        Insert: {
          columns?: string[]
          exported_at?: string
          exported_by: string
          format: string
          id?: string
          row_count?: number
          search?: string
          view: string
        }
        Update: {
          columns?: string[]
          exported_at?: string
          exported_by?: string
          format?: string
          id?: string
          row_count?: number
          search?: string
          view?: string
        }
        Relationships: []
      }
      safety_incident_reports: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string
          id: string
          incident_date: string
          involved_party: string
          nature_of_incident: string
          resolution_taken: string
          updated_at: string
          venue: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          incident_date: string
          involved_party: string
          nature_of_incident: string
          resolution_taken: string
          updated_at?: string
          venue: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          incident_date?: string
          involved_party?: string
          nature_of_incident?: string
          resolution_taken?: string
          updated_at?: string
          venue?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          email: string
          fetlife_handle: string
          id: string
          reddit_handle: string
          updated_at: string
        }
        Insert: {
          email?: string
          fetlife_handle?: string
          id?: string
          reddit_handle?: string
          updated_at?: string
        }
        Update: {
          email?: string
          fetlife_handle?: string
          id?: string
          reddit_handle?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          created_at: string
          environment: string
          error_message: string | null
          event_type: string
          id: string
          processed_at: string | null
          processing_ms: number | null
          raw_payload: Json
          received_at: string
          status: string
          stripe_event_id: string | null
        }
        Insert: {
          created_at?: string
          environment: string
          error_message?: string | null
          event_type: string
          id?: string
          processed_at?: string | null
          processing_ms?: number | null
          raw_payload: Json
          received_at?: string
          status?: string
          stripe_event_id?: string | null
        }
        Update: {
          created_at?: string
          environment?: string
          error_message?: string | null
          event_type?: string
          id?: string
          processed_at?: string | null
          processing_ms?: number | null
          raw_payload?: Json
          received_at?: string
          status?: string
          stripe_event_id?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          admin_unread_count: number
          created_at: string
          escalated: boolean
          escalated_at: string | null
          escalation_reason: string | null
          id: string
          last_message_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_unread_count?: number
          created_at?: string
          escalated?: boolean
          escalated_at?: string | null
          escalation_reason?: string | null
          id?: string
          last_message_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_unread_count?: number
          created_at?: string
          escalated?: boolean
          escalated_at?: string | null
          escalation_reason?: string | null
          id?: string
          last_message_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          author_user_id: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json
          role: string
        }
        Insert: {
          author_user_id?: string | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json
          role: string
        }
        Update: {
          author_user_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
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
      venue_compliance_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          details: Json
          document_id: string | null
          document_kind: string | null
          document_title: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          details?: Json
          document_id?: string | null
          document_kind?: string | null
          document_title?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          details?: Json
          document_id?: string | null
          document_kind?: string | null
          document_title?: string | null
          id?: string
        }
        Relationships: []
      }
      venue_compliance_documents: {
        Row: {
          created_at: string
          expires_on: string | null
          expiry_reminder_sent_at: string | null
          file_mime_type: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          issued_on: string | null
          issuer: string | null
          kind: Database["public"]["Enums"]["venue_compliance_kind"]
          notes: string | null
          reference_number: string | null
          title: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          expires_on?: string | null
          expiry_reminder_sent_at?: string | null
          file_mime_type?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          kind: Database["public"]["Enums"]["venue_compliance_kind"]
          notes?: string | null
          reference_number?: string | null
          title: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          expires_on?: string | null
          expiry_reminder_sent_at?: string | null
          file_mime_type?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          kind?: Database["public"]["Enums"]["venue_compliance_kind"]
          notes?: string | null
          reference_number?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: []
      }
      venue_compliance_reminder_log: {
        Row: {
          attempt_count: number
          channels: Json
          created_at: string
          document_id: string
          error_message: string | null
          expires_on: string
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["venue_compliance_kind"]
          last_attempt_at: string
          max_attempts: number
          next_retry_at: string | null
          recipients: Json
          reminder_type: string
          status: string
        }
        Insert: {
          attempt_count?: number
          channels?: Json
          created_at?: string
          document_id: string
          error_message?: string | null
          expires_on: string
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["venue_compliance_kind"]
          last_attempt_at?: string
          max_attempts?: number
          next_retry_at?: string | null
          recipients?: Json
          reminder_type?: string
          status?: string
        }
        Update: {
          attempt_count?: number
          channels?: Json
          created_at?: string
          document_id?: string
          error_message?: string | null
          expires_on?: string
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["venue_compliance_kind"]
          last_attempt_at?: string
          max_attempts?: number
          next_retry_at?: string | null
          recipients?: Json
          reminder_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_compliance_reminder_log_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "venue_compliance_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      waiver_audit_log: {
        Row: {
          action: string
          created_at: string
          event_id: string
          id: string
          ip_address: string | null
          rsvp_id: string | null
          user_agent: string | null
          user_id: string
          waiver_signature: string | null
          waiver_text_hash: string | null
        }
        Insert: {
          action: string
          created_at?: string
          event_id: string
          id?: string
          ip_address?: string | null
          rsvp_id?: string | null
          user_agent?: string | null
          user_id: string
          waiver_signature?: string | null
          waiver_text_hash?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          event_id?: string
          id?: string
          ip_address?: string | null
          rsvp_id?: string | null
          user_agent?: string | null
          user_id?: string
          waiver_signature?: string | null
          waiver_text_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waiver_audit_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_audit_log_rsvp_id_fkey"
            columns: ["rsvp_id"]
            isOneToOne: false
            referencedRelation: "rsvps"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cron_health_snapshot: { Args: never; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_private_room_busy: {
        Args: { from_ts: string; to_ts: string }
        Returns: {
          duration_minutes: number
          starts_at: string
        }[]
      }
      go_live_status: { Args: never; Returns: Json }
      has_age_verification: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_accounts_to_purge: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      purge_account_rows: { Args: { _user_id: string }; Returns: undefined }
      purge_expired_health_screenings: { Args: never; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      user_can_access_content: {
        Args: { _content_id: string; _env?: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "cohost"
      event_doc_type: "permit" | "insurance" | "capacity" | "other"
      venue_compliance_kind:
        | "public_liability_insurance"
        | "event_permit"
        | "other"
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
      app_role: ["admin", "moderator", "user", "cohost"],
      event_doc_type: ["permit", "insurance", "capacity", "other"],
      venue_compliance_kind: [
        "public_liability_insurance",
        "event_permit",
        "other",
      ],
    },
  },
} as const
