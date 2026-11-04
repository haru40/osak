// 서비스 워커 등록과 브라우저별 앱 설치 안내.
const INSTALL_DISMISSED_KEY = "osak-install-dismissed";
const INSTALL_GUIDES = {
  ios:"Safari 아래쪽 공유 버튼을 누르고 홈 화면에 추가를 선택해주세요.",
  iosOther:"Safari에서 이 주소를 열어야 설치할 수 있어요.",
  inApp:"이 앱 안의 브라우저에서는 설치할 수 없어요. Chrome이나 Safari에서 열어주세요.",
  samsung:"아래쪽 메뉴를 누르고 현재 페이지 추가 → 홈 화면을 선택해주세요.",
  other:"브라우저 메뉴(⋮)에서 앱 설치 또는 홈 화면에 추가를 선택해주세요."
};

let installPrompt = null;

function isInstalledApp(){
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
}
function browserKind(){
  const agent = navigator.userAgent;
  if(/NAVER|Instagram|FBAN|FBAV|Line\//i.test(agent)) return "inApp";
  if(/iPhone|iPad|iPod/i.test(agent)) return /CriOS|FxiOS|EdgiOS|Whale/i.test(agent) ? "iosOther" : "ios";
  if(/SamsungBrowser/i.test(agent)) return "samsung";
  return "other";
}
function installDismissed(){
  try{ return localStorage.getItem(INSTALL_DISMISSED_KEY)==="1"; }catch{ return false; }
}
function dismissInstall(){
  document.getElementById("installBanner").hidden = true;
  try{ localStorage.setItem(INSTALL_DISMISSED_KEY,"1"); }catch{}
}
async function startInstall(){
  if(installPrompt){
    installPrompt.prompt();
    const {outcome} = await installPrompt.userChoice;
    installPrompt = null;
    if(outcome==="accepted") document.getElementById("installBanner").hidden = true;
    return;
  }
  const guide = document.getElementById("installGuide");
  guide.textContent = INSTALL_GUIDES[browserKind()];
  guide.hidden = false;
}
function setupInstallBanner(){
  // 카카오톡 안 브라우저는 설치가 안 되므로 기본 브라우저로 넘긴다.
  if(/KAKAOTALK/i.test(navigator.userAgent)){
    location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href);
    return;
  }
  const isPhone = window.matchMedia("(pointer: coarse)").matches;
  if(isPhone && !isInstalledApp() && !installDismissed()){
    document.getElementById("installBanner").hidden = false;
  }
}

window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled",()=>{
  document.getElementById("installBanner").hidden = true;
});
window.addEventListener("DOMContentLoaded",setupInstallBanner);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("sw.js").catch(error=>console.error("[sw]",error));
  });
}
