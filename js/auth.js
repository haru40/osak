const AuthController = (() => {
  const authShell = document.getElementById("authShell");
  const appShell = document.getElementById("appShell");
  const form = document.getElementById("authForm");
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const title = document.getElementById("authTitle");
  const description = document.getElementById("authDescription");
  const message = document.getElementById("authMessage");
  const submitButton = document.getElementById("authSubmitBtn");
  const switchText = document.getElementById("authSwitchText");
  const switchButton = document.getElementById("authSwitchBtn");
  const userEmail = document.getElementById("authUserEmail");
  const logoutButton = document.getElementById("logoutBtn");

  const forgotButton = document.getElementById("authForgotBtn");
  const socialSection = document.getElementById("authSocial");
  const googleButton = document.getElementById("authGoogleBtn");
  const confirmInput = document.getElementById("authPasswordConfirm");
  const confirmLabel = document.querySelector('label[for="authPasswordConfirm"]');
  const passwordLabel = document.querySelector('label[for="authPassword"]');
  const emailLabel = document.querySelector('label[for="authEmail"]');
  let recoveryPending = new URLSearchParams(window.location.hash.slice(1)).get("type")==="recovery";
  let mode = "login";

  function setMessage(text="",type="error"){
    message.textContent = text;
    message.classList.toggle("success",type==="success");
  }

  function setMode(nextMode,{clearMessage=true}={}){
    mode = nextMode;
    const isSignup = mode==="signup";

    title.textContent = isSignup ? "회원가입" : "로그인";
    description.textContent = isSignup
      ? "이메일과 비밀번호로 오늘도싹 계정을 만들어보세요."
      : "오늘도싹에 로그인하고 냉장고를 확인하세요.";
    submitButton.textContent = isSignup ? "회원가입" : "로그인";
    switchText.textContent = isSignup ? "이미 계정이 있나요?" : "계정이 없나요?";
    switchButton.textContent = isSignup ? "로그인" : "회원가입";
    passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
    passwordInput.value = "";
    const isForgot = mode==="forgot";
    const isReset = mode==="reset";
    emailInput.hidden = emailLabel.hidden = isReset;
    passwordInput.hidden = passwordLabel.hidden = isForgot;
    confirmInput.hidden = confirmLabel.hidden = !isReset;
    confirmInput.value = "";
    forgotButton.hidden = mode!=="login";
    socialSection.hidden = isForgot || isReset;
    switchButton.parentElement.hidden = isReset;
    if(isForgot || isReset){
      title.textContent = isReset ? "새 비밀번호 설정" : "비밀번호 찾기";
      description.textContent = isReset ? "새로 사용할 비밀번호를 입력해주세요." : "가입한 이메일로 비밀번호 재설정 링크를 보내드려요.";
      submitButton.textContent = isReset ? "비밀번호 변경" : "재설정 메일 보내기";
      switchText.textContent = "로그인 화면으로 돌아가려면";
      switchButton.textContent = "로그인";
    }
    passwordInput.autocomplete = (isSignup || isReset) ? "new-password" : "current-password";
    if(clearMessage) setMessage();
  }

  function showAuth(){
    appShell.hidden = true;
    authShell.hidden = false;
    userEmail.textContent = "";
    window.currentAuthUser = null;
    window.dispatchEvent(new CustomEvent("todayssak:auth-changed",{detail:{user:null}}));
  }

  function prepareApp(user){
    userEmail.textContent = user?.email || "로그인 사용자";
    userEmail.title = user?.email || "";
    appShell.hidden = true;
    window.currentAuthUser = user;
    window.dispatchEvent(new CustomEvent("todayssak:auth-changed",{detail:{user}}));
  }

  function revealApp(user){
    if(recoveryPending || mode==="reset" || !user || window.currentAuthUser?.id!==user.id) return;
    authShell.hidden = true;
    appShell.hidden = false;
    setMessage();
  }

  function validateCredentials(){
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if(mode!=="reset" && !email){
      setMessage("이메일을 입력해주세요.");
      emailInput.focus();
      return null;
    }
    if(mode!=="reset" && !emailInput.validity.valid){
      setMessage("올바른 이메일 주소를 입력해주세요.");
      emailInput.focus();
      return null;
    }
    if(mode==="forgot") return {email};
    if(!password){
      setMessage("비밀번호를 입력해주세요.");
      passwordInput.focus();
      return null;
    }
    if(password.length<6){
      setMessage("비밀번호는 6자 이상 입력해주세요.");
      passwordInput.focus();
      return null;
    }

    if(mode==="reset" && password!==confirmInput.value){
      setMessage("비밀번호가 일치하지 않습니다.");
      confirmInput.focus();
      return null;
    }
    return {email,password};
  }

  function friendlyError(error,action){
    const errorText = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();

    if(errorText.includes("already registered") || errorText.includes("user_already_exists")){
      return "이미 가입된 이메일입니다.";
    }
    if(errorText.includes("invalid login credentials") || errorText.includes("invalid_credentials")){
      return "이메일 또는 비밀번호를 확인해주세요.";
    }
    if(errorText.includes("email not confirmed")){
      return "이메일 인증을 완료해주세요.";
    }
    if(errorText.includes("password") && (errorText.includes("short") || errorText.includes("weak"))){
      return "비밀번호는 6자 이상 입력해주세요.";
    }
    if(errorText.includes("rate limit") || errorText.includes("too many requests")){
      return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
    }
    if(action==="forgot" && (errorText.includes("email address not authorized") || errorText.includes("email not authorized") || errorText.includes("email_address_not_authorized"))){
      return "메일 발송이 제한되어 있습니다. 관리자에게 메일 발송 서버(SMTP) 설정을 요청해주세요.";
    }
    if(action==="forgot" && (errorText.includes("error sending") || errorText.includes("smtp"))){
      return "메일 서버에서 발송하지 못했습니다. 관리자에게 SMTP 설정 확인을 요청해주세요.";
    }
    if(action==="forgot") return "재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.";
    if(action==="reset") return "비밀번호를 변경하지 못했습니다. 새 링크를 요청하거나 다른 비밀번호를 입력해주세요.";
    return action==="signup"
      ? "회원가입에 실패했습니다. 입력 내용을 확인해주세요."
      : "로그인에 실패했습니다. 잠시 후 다시 시도해주세요.";
  }

  async function handleSubmit(event){
    event.preventDefault();
    if(submitButton.disabled) return;
    const credentials = validateCredentials();
    if(!credentials) return;

    submitButton.disabled = true;
    setMessage();
    switchButton.disabled = forgotButton.disabled = true;

    try{
      if(mode==="forgot"){
        const {error} = await supabaseClient.auth.resetPasswordForEmail(credentials.email,{
          redirectTo: window.location.origin + window.location.pathname
        });
        if(error) throw error;
        setMessage("가입된 이메일이라면 재설정 링크가 발송됩니다. 메일함과 스팸함을 확인해주세요.","success");
      }else if(mode==="reset"){
        const {data,error} = await supabaseClient.auth.updateUser({password:credentials.password});
        if(error) throw error;
        recoveryPending = false;
        setMode("login");
        setMessage("비밀번호가 변경되었습니다.","success");
        prepareApp(data.user);
      }else if(mode==="signup"){
        const {data,error} = await supabaseClient.auth.signUp(credentials);
        if(error) throw error;

        if(data.user?.identities?.length===0){
          setMessage("이미 가입된 이메일입니다.");
          return;
        }
        if(data.session){
          prepareApp(data.user);
          return;
        }

        setMode("login",{clearMessage:false});
        emailInput.value = credentials.email;
        setMessage("회원가입이 완료되었습니다. 이메일 인증 후 로그인해주세요.","success");
      }else{
        const {data,error} = await supabaseClient.auth.signInWithPassword(credentials);
        if(error) throw error;
        prepareApp(data.user);
      }
    }catch(error){
      console.error("[Auth] 요청 실패", {action:mode, code:error?.code, status:error?.status, message:error?.message});
      setMessage(friendlyError(error,mode));
    }finally{
      submitButton.disabled = false;
      switchButton.disabled = forgotButton.disabled = false;
    }
  }

  async function handleLogout(){
    logoutButton.disabled = true;
    const {error} = await supabaseClient.auth.signOut();
    logoutButton.disabled = false;

    if(error){
      window.alert("로그아웃에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    setMode("login");
    emailInput.value = "";
    showAuth();
  }

  async function initialize(){
    supabaseClient.auth.onAuthStateChange((event,session)=>{
      if(event==="PASSWORD_RECOVERY"){
        recoveryPending = true;
        showAuth();
        setMode("reset");
        return;
      }
      if(recoveryPending || mode==="reset") return;
      if(session?.user) prepareApp(session.user);
      else showAuth();
    });

    const {data,error} = await supabaseClient.auth.getSession();
    if(error){
      showAuth();
      setMessage("로그인 상태를 확인하지 못했습니다. 다시 로그인해주세요.");
      return;
    }

    if(recoveryPending || mode==="reset"){
      showAuth();
      setMode("reset");
      if(!data.session){
        recoveryPending = false;
        setMode("forgot");
        setMessage("재설정 링크가 만료되었거나 유효하지 않습니다. 새 링크를 요청해주세요.");
      }
      return;
    }
    if(data.session?.user) prepareApp(data.session.user);
    else showAuth();
  }

  async function signInWithProvider(provider,button){
    setMessage();
    button.disabled = true;
    const {error} = await supabaseClient.auth.signInWithOAuth({
      provider,
      options:{redirectTo:window.location.origin + window.location.pathname}
    });
    if(error){
      console.error("[Auth] 소셜 로그인 실패",error);
      button.disabled = false;
      setMessage("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  form.addEventListener("submit",handleSubmit);
  googleButton.addEventListener("click",()=>signInWithProvider("google",googleButton));
  switchButton.addEventListener("click",()=>setMode(mode==="login" ? "signup" : "login"));
  forgotButton.addEventListener("click",()=>{setMode("forgot"); emailInput.focus();});
  logoutButton.addEventListener("click",handleLogout);
  window.addEventListener("todayssak:inventory-ready",event=>revealApp(event.detail?.user));
  setMode("login");
  initialize().catch(error=>{
    console.error("[Auth] 초기화 실패",error);
    showAuth();
    submitButton.disabled = true;
    setMessage("로그인 서비스를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해주세요.");
  });

  return {initialize};
})();
