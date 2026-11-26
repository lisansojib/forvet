/* Forvet deployment settings.
 * Both values empty → LOCAL MODE (data stays in each browser, anyone can edit).
 * Filled in → CLOUD MODE (Supabase). With requireSignIn: true nothing is shown until the user signs in,
 * and only accounts listed in forvet_admins (edit) or forvet_viewers (read only) can see data.
 * The publishable/anon key is meant to be public — security comes from the database rules in
 * supabase/forvet_schema.sql. NEVER put the service_role / secret key here.
 */
window.FORVET_CONFIG = {
  supabaseUrl: 'https://likxajawyxhatboiwqun.supabase.co',
  supabaseAnonKey: 'sb_publishable_Cko-d0qejjHu_3S5tbGExw_4oKGGuOO',
  requireSignIn: true,  // private: sign-in screen before anything loads
  allowSignup: false    // keep false; also turn off sign-ups in Supabase → Authentication
};
