// Supabase 프로젝트 설정
// Project Settings > API에서 Project URL과 Publishable Key를 입력하세요.
// 브라우저 코드에는 service_role key를 절대 사용하지 마세요.
const SUPABASE_CONFIG = Object.freeze({
  projectUrl: "https://flxmosoodhwlzljogtgv.supabase.co",
  publishableKey: "sb_publishable_RjcyAHh66V61Zqqb3z1X8g_i-FcTy-1"
});

const supabaseClient = window.supabase.createClient(
  SUPABASE_CONFIG.projectUrl,
  SUPABASE_CONFIG.publishableKey
);

console.log("[Supabase] client created:", Boolean(supabaseClient));
