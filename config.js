/* Forvet deployment settings.
 * Leave both values empty to run in LOCAL MODE (data stays in each browser, anyone can edit).
 * Fill them in to use Supabase: everyone can VIEW, only admins listed in forvet_admins can EDIT.
 * The anon/publishable key is safe to publish — security comes from the database RLS policies.
 * NEVER put the service_role / secret key here.
 */
window.FORVET_CONFIG = {
  supabaseUrl: '',      // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseAnonKey: '',  // Project Settings → API → anon / publishable key
  allowSignup: false    // true shows "Create account" (new accounts are view-only anyway)
};
