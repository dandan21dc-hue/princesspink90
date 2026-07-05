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
          created_at: string
          display_name: string
          event_types: string | null
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
          created_at?: string
          display_name: string
          event_types?: string | null
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
          created_at?: string
          display_name?: string
          event_types?: string | null
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
          description: string | null
          id: string
          kind: string
          media_urls: Json
          price_cents: number | null
          published: boolean
          subscribers_only: boolean
          title: string
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          creator_id: string
          description?: string | null
          id?: string
          kind: string
          media_urls?: Json
          price_cents?: number | null
          published?: boolean
          subscribers_only?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          creator_id?: string
          description?: string | null
          id?: string
          kind?: string
          media_urls?: Json
          price_cents?: number | null
          published?: boolean
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
          channels: Json
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string
          reminder_type: string
          screening_id: string
          status: string
          user_id: string
          valid_until: string
        }
        Insert: {
          channels?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key: string
          reminder_type?: string
          screening_id: string
          status?: string
          user_id: string
          valid_until: string
        }
        Update: {
          channels?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string
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
          id: string
          kind: string
          private_session_fulfilled_at: string | null
          private_session_requested_at: string | null
          stripe_session_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          environment?: string
          event_ticket_event_id?: string | null
          event_ticket_used_at?: string | null
          id?: string
          kind?: string
          private_session_fulfilled_at?: string | null
          private_session_requested_at?: string | null
          stripe_session_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          environment?: string
          event_ticket_event_id?: string | null
          event_ticket_used_at?: string | null
          id?: string
          kind?: string
          private_session_fulfilled_at?: string | null
          private_session_requested_at?: string | null
          stripe_session_id?: string | null
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
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          user_id?: string
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
          channels: Json
          created_at: string
          document_id: string
          error_message: string | null
          expires_on: string
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["venue_compliance_kind"]
          recipients: Json
          reminder_type: string
          status: string
        }
        Insert: {
          channels?: Json
          created_at?: string
          document_id: string
          error_message?: string | null
          expires_on: string
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["venue_compliance_kind"]
          recipients?: Json
          reminder_type?: string
          status?: string
        }
        Update: {
          channels?: Json
          created_at?: string
          document_id?: string
          error_message?: string | null
          expires_on?: string
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["venue_compliance_kind"]
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purge_expired_health_screenings: { Args: never; Returns: number }
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
