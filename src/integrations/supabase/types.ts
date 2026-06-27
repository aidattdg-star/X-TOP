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
      account_education: {
        Row: {
          created_at: string
          enabled: boolean
          keywords: string[]
          last_run_at: string | null
          twitter_account_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          keywords?: string[]
          last_run_at?: string | null
          twitter_account_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          keywords?: string[]
          last_run_at?: string | null
          twitter_account_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_education_twitter_account_id_fkey"
            columns: ["twitter_account_id"]
            isOneToOne: true
            referencedRelation: "twitter_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_flows: {
        Row: {
          account_ids: string[]
          created_at: string
          description: string | null
          execution_interval: string | null
          id: string
          name: string
          react_flow_data: Json
          status: Database["public"]["Enums"]["flow_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_ids?: string[]
          created_at?: string
          description?: string | null
          execution_interval?: string | null
          id?: string
          name: string
          react_flow_data?: Json
          status?: Database["public"]["Enums"]["flow_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_ids?: string[]
          created_at?: string
          description?: string | null
          execution_interval?: string | null
          id?: string
          name?: string
          react_flow_data?: Json
          status?: Database["public"]["Enums"]["flow_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      education_tasks: {
        Row: {
          attempts: number
          created_at: string
          id: string
          keyword: string | null
          last_error: string | null
          scheduled_for: string
          status: Database["public"]["Enums"]["education_task_status"]
          tweet_id: string
          twitter_account_id: string
          updated_at: string
          user_id: string
          view_count: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          keyword?: string | null
          last_error?: string | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["education_task_status"]
          tweet_id: string
          twitter_account_id: string
          updated_at?: string
          user_id: string
          view_count?: number
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          keyword?: string | null
          last_error?: string | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["education_task_status"]
          tweet_id?: string
          twitter_account_id?: string
          updated_at?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "education_tasks_twitter_account_id_fkey"
            columns: ["twitter_account_id"]
            isOneToOne: false
            referencedRelation: "twitter_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_logs: {
        Row: {
          created_at: string
          error_details: Json | null
          flow_id: string | null
          id: string
          level: string
          message: string
          twitter_account_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error_details?: Json | null
          flow_id?: string | null
          id?: string
          level?: string
          message: string
          twitter_account_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          error_details?: Json | null
          flow_id?: string | null
          id?: string
          level?: string
          message?: string
          twitter_account_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_logs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_twitter_account_id_fkey"
            columns: ["twitter_account_id"]
            isOneToOne: false
            referencedRelation: "twitter_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_queue: {
        Row: {
          action_type: string
          attempts: number
          created_at: string
          flow_id: string
          id: string
          last_error: string | null
          payload: Json
          scheduled_for: string
          status: Database["public"]["Enums"]["queue_status"]
          twitter_account_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type: string
          attempts?: number
          created_at?: string
          flow_id: string
          id?: string
          last_error?: string | null
          payload?: Json
          scheduled_for?: string
          status?: Database["public"]["Enums"]["queue_status"]
          twitter_account_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          attempts?: number
          created_at?: string
          flow_id?: string
          id?: string
          last_error?: string | null
          payload?: Json
          scheduled_for?: string
          status?: Database["public"]["Enums"]["queue_status"]
          twitter_account_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_queue_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_queue_twitter_account_id_fkey"
            columns: ["twitter_account_id"]
            isOneToOne: false
            referencedRelation: "twitter_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_monitor_state: {
        Row: {
          flow_id: string
          last_checked_at: string
          last_tweet_id: string | null
          processed_tweet_ids: string[]
          updated_at: string
        }
        Insert: {
          flow_id: string
          last_checked_at?: string
          last_tweet_id?: string | null
          processed_tweet_ids?: string[]
          updated_at?: string
        }
        Update: {
          flow_id?: string
          last_checked_at?: string
          last_tweet_id?: string | null
          processed_tweet_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_monitor_state_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: true
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      media_files: {
        Row: {
          created_at: string
          folder_id: string
          height: number | null
          id: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          user_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          folder_id: string
          height?: number | null
          id?: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          user_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          folder_id?: string
          height?: number | null
          id?: string
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          storage_path?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      media_folders: {
        Row: {
          category: Database["public"]["Enums"]["media_category"]
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["media_category"]
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["media_category"]
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_update_log: {
        Row: {
          created_at: string
          error: string | null
          field: Database["public"]["Enums"]["profile_field"]
          id: string
          new_value: string | null
          old_value: string | null
          status: string
          twitter_account_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          field: Database["public"]["Enums"]["profile_field"]
          id?: string
          new_value?: string | null
          old_value?: string | null
          status?: string
          twitter_account_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          field?: Database["public"]["Enums"]["profile_field"]
          id?: string
          new_value?: string | null
          old_value?: string | null
          status?: string
          twitter_account_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_update_log_twitter_account_id_fkey"
            columns: ["twitter_account_id"]
            isOneToOne: false
            referencedRelation: "twitter_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      proxies: {
        Row: {
          created_at: string
          id: string
          ip: string
          label: string | null
          last_tested_at: string | null
          password: string | null
          port: number
          status: Database["public"]["Enums"]["proxy_status"]
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip: string
          label?: string | null
          last_tested_at?: string | null
          password?: string | null
          port: number
          status?: Database["public"]["Enums"]["proxy_status"]
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string
          label?: string | null
          last_tested_at?: string | null
          password?: string | null
          port?: number
          status?: Database["public"]["Enums"]["proxy_status"]
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      twitter_accounts: {
        Row: {
          auth_tokens: Json
          cooldown_until: string | null
          created_at: string
          display_name: string | null
          id: string
          last_used_at: string | null
          profile_picture_url: string | null
          proxy_id: string | null
          status: Database["public"]["Enums"]["twitter_account_status"]
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          auth_tokens?: Json
          cooldown_until?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_used_at?: string | null
          profile_picture_url?: string | null
          proxy_id?: string | null
          status?: Database["public"]["Enums"]["twitter_account_status"]
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          auth_tokens?: Json
          cooldown_until?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_used_at?: string | null
          profile_picture_url?: string | null
          proxy_id?: string | null
          status?: Database["public"]["Enums"]["twitter_account_status"]
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "twitter_accounts_proxy_id_fkey"
            columns: ["proxy_id"]
            isOneToOne: false
            referencedRelation: "proxies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      education_task_status: "pending" | "processing" | "completed" | "failed"
      flow_status: "active" | "paused" | "draft"
      media_category: "profile_picture" | "tweet_media"
      profile_field: "avatar" | "banner" | "name" | "bio" | "username"
      proxy_status: "active" | "dead" | "unknown"
      queue_status: "pending" | "processing" | "completed" | "failed"
      twitter_account_status: "active" | "paused" | "banned" | "unknown"
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
      education_task_status: ["pending", "processing", "completed", "failed"],
      flow_status: ["active", "paused", "draft"],
      media_category: ["profile_picture", "tweet_media"],
      profile_field: ["avatar", "banner", "name", "bio", "username"],
      proxy_status: ["active", "dead", "unknown"],
      queue_status: ["pending", "processing", "completed", "failed"],
      twitter_account_status: ["active", "paused", "banned", "unknown"],
    },
  },
} as const
