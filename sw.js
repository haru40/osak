// 앱 파일을 저장해 두고, 인터넷이 되면 항상 새 파일을 먼저 받는다.
// 파일 목록을 바꾸면 VERSION을 올린다.
const VERSION = "v2";
const CACHE_NAME = `osak-${VERSION}`;
const APP_FILES = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/supabase.js",
  "js/auth.js",
  "js/ingredients.js",
  "js/pantry.js",
  "js/recipes.js",
  "js/publicRecipes.js",
  "js/customRecipes.js",
  "js/storage.js",
  "js/photoScan.js",
  "js/cameraScan.js",
  "js/install.js",
  "js/app.js",
  "images/icons/icon-192.png",
  "images/icons/icon-512.png",
  "images/fridge/apple.png",
  "images/fridge/carrot.png",
  "images/fridge/cucumber.png",
  "images/fridge/egg-side.png",
  "images/fridge/egg-sleep.png",
  "images/fridge/grape.png",
  "images/fridge/mushroom.png",
  "images/fridge/napa-cabbage.png",
  "images/fridge/orange.png",
  "images/fridge/peach.png",
  "images/fridge/tofu.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names = await caches.keys();
    await Promise.all(names.filter(name=>name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request){
  const cache = await caches.open(CACHE_NAME);
  try{
    const response = await fetch(request);
    if(response.ok) await cache.put(request,response.clone());
    return response;
  }catch(error){
    const cached = await cache.match(request) || (request.mode==="navigate" && await cache.match("index.html"));
    if(cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch",event=>{
  const {request} = event;
  // 로그인, 냉장고 저장, 사진 분석 같은 외부 요청은 건드리지 않는다.
  if(request.method!=="GET" || new URL(request.url).origin!==self.location.origin) return;
  event.respondWith(networkFirst(request));
});
