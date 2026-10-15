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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      admin_scope: {
        Row: { admin_id: string; district: string | null; id: number; system_wide: boolean }
        Insert: { admin_id: string; district?: string | null; id?: never; system_wide?: boolean }
        Update: { admin_id?: string; district?: string | null; id?: never; system_wide?: boolean }
        Relationships: [
          {
            foreignKeyName: "admin_scope_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit: {
        Row: {
          church: string | null; device: string | null; district: string | null; id: number
          month: string | null; name: string | null; role: string | null; status: string | null
          total: number | null; ts: string; year: number | null
        }
        Insert: {
          church?: string | null; device?: string | null; district?: string | null; id?: never
          month?: string | null; name?: string | null; role?: string | null; status?: string | null
          total?: number | null; ts?: string; year?: number | null
        }
        Update: {
          church?: string | null; device?: string | null; district?: string | null; id?: never
          month?: string | null; name?: string | null; role?: string | null; status?: string | null
          total?: number | null; ts?: string; year?: number | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string; actor_name: string | null; actor_role: string | null; created_at: string
          details: Json; id: number; target_id: string | null; target_type: string | null
        }
        Insert: {
          action: string; actor_name?: string | null; actor_role?: string | null; created_at?: string
          details?: Json; id?: never; target_id?: string | null; target_type?: string | null
        }
        Update: {
          action?: string; actor_name?: string | null; actor_role?: string | null; created_at?: string
          details?: Json; id?: never; target_id?: string | null; target_type?: string | null
        }
        Relationships: []
      }
      churches: {
        Row: { created_at: string; district_id: string; id: string; name: string }
        Insert: { created_at?: string; district_id: string; id?: string; name: string }
        Update: { created_at?: string; district_id?: string; id?: string; name?: string }
        Relationships: [
          {
            foreignKeyName: "churches_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
        ]
      }
      districts: {
        Row: { created_at: string; id: string; name: string }
        Insert: { created_at?: string; id?: string; name: string }
        Update: { created_at?: string; id?: string; name?: string }
        Relationships: []
      }
      entries: {
        Row: {
          amounts: Json; church: string; device: string | null; district: string
          editedat: string | null; editedby: string | null; id: string; late_fields: Json
          month: string; serialno: string | null; year: number
        }
        Insert: {
          amounts?: Json; church: string; device?: string | null; district: string
          editedat?: string | null; editedby?: string | null; id: string; late_fields?: Json
          month: string; serialno?: string | null; year: number
        }
        Update: {
          amounts?: Json; church?: string; device?: string | null; district?: string
          editedat?: string | null; editedby?: string | null; id?: string; late_fields?: Json
          month?: string; serialno?: string | null; year?: number
        }
        Relationships: []
      }
      offering_types: {
        Row: { key: string; label: string; sort_order: number }
        Insert: { key: string; label: string; sort_order?: number }
        Update: { key?: string; label?: string; sort_order?: number }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null; created_at: string; email: string | null; full_name: string | null; id: string
          last_login: string | null; phone: string | null; role: string; status: string
        }
        Insert: {
          avatar_url?: string | null; created_at?: string; email?: string | null; full_name?: string | null; id: string
          last_login?: string | null; phone?: string | null; role?: string; status?: string
        }
        Update: {
          avatar_url?: string | null; created_at?: string; email?: string | null; full_name?: string | null; id?: string
          last_login?: string | null; phone?: string | null; role?: string; status?: string
        }
        Relationships: []
      }
      support_access: {
        Row: {
          account_email: string; expires_at: string; granted_at: string; granted_by: string | null
          id: string; permissions: Json; reason: string; revoked_at: string | null
        }
        Insert: {
          account_email: string; expires_at: string; granted_at?: string; granted_by?: string | null
          id?: string; permissions?: Json; reason: string; revoked_at?: string | null
        }
        Update: {
          account_email?: string; expires_at?: string; granted_at?: string; granted_by?: string | null
          id?: string; permissions?: Json; reason?: string; revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: { id: boolean; initialized: boolean }
        Insert: { id?: boolean; initialized?: boolean }
        Update: { id?: boolean; initialized?: boolean }
        Relationships: []
      }
      user_district_access: {
        Row: { district: string; id: number; user_id: string }
        Insert: { district: string; id?: never; user_id: string }
        Update: { district?: string; id?: never; user_id?: string }
        Relationships: [
          {
            foreignKeyName: "user_district_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_church: { Args: { p_district: string; p_name: string }; Returns: undefined }
      add_district: { Args: { p_name: string }; Returns: undefined }
      approve_user: { Args: { p_user_id: string }; Returns: undefined }
      can_manage_user: { Args: { p_target: string }; Returns: boolean }
      grant_support_access: {
        Args: { p_account_email: string; p_hours: number; p_permissions: Json; p_reason: string }
        Returns: undefined
      }
      is_admin_or_super: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      promote_to_admin: { Args: { p_user_id: string }; Returns: undefined }
      record_login: { Args: never; Returns: undefined }
      remove_church: { Args: { p_district: string; p_name: string }; Returns: undefined }
      remove_district: { Args: { p_name: string }; Returns: undefined }
      rename_church: {
        Args: { p_district: string; p_new_name: string; p_old_name: string }
        Returns: undefined
      }
      rename_district: { Args: { p_new_name: string; p_old_name: string }; Returns: undefined }
      revoke_support_access: { Args: { p_id: string }; Returns: undefined }
      set_user_districts: { Args: { p_districts: string[]; p_user_id: string }; Returns: undefined }
      set_user_status: { Args: { p_status: string; p_user_id: string }; Returns: undefined }
      user_has_district_access: { Args: { p_district: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Update"]
