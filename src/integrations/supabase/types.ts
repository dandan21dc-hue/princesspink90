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
      events: {
        Row: {
          address: string | null
          capacity: number | null
          city: string | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          dress_code: string | null
          ends_at: string | null
          host_id: string
          id: string
          is_private: boolean
          published: boolean
          starts_at: string
          tagline: string | null
          theme: string | null
          ticket_price_cents: number
          title: string
          updated_at: string
          venue_name: string
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          dress_code?: string | null
          ends_at?: string | null
          host_id: string
          id?: string
          is_private?: boolean
          published?: boolean
          starts_at: string
          tagline?: string | null
          theme?: string | null
          ticket_price_cents?: number
          title: string
          updated_at?: string
          venue_name: string
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          dress_code?: string | null
          ends_at?: string | null
          host_id?: string
          id?: string
          is_private?: boolean
          published?: boolean
          starts_at?: string
          tagline?: string | null
          theme?: string | null
          ticket_price_cents?: number
          title?: string
          updated_at?: string
          venue_name?: string
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
      user_can_access_content: {
        Args: { _content_id: string; _env?: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
