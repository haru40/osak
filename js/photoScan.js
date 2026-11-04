// 냉장고 사진을 n8n으로 보내 재료를 찾고, 사용자가 확인한 항목만 저장한다.
// n8n Webhook의 Production URL을 넣으면 켜진다. OpenAI 키는 n8n에만 둔다.
const PHOTO_SCAN_URL = "https://n8n-76zv.srv1948977.hstgr.cloud/webhook/fridge-scan";
const SCAN_MAX_PHOTOS = 3;
const SCAN_MAX_SIDE = 1280;
const SCAN_JPEG_QUALITY = 0.8;
const SCAN_UNITS = ["g","개","ml"];
const SCAN_DAYS = [[0,"오늘까지"],[3,"3일 이내"],[5,"5일 이내"],[7,"7일 이내"],[14,"14일 이내"]];
const SCAN_DEFAULT_DAYS = 5;

let scanBusy = false;

async function shrinkPhoto(file){
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1,SCAN_MAX_SIDE/Math.max(bitmap.width,bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width*scale);
  canvas.height = Math.round(bitmap.height*scale);
  canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg",SCAN_JPEG_QUALITY);
}
function setScanBusy(busy){
  scanBusy = busy;
  document.getElementById("scanStatus").hidden = !busy;
  document.getElementById("scanInput").disabled = busy;
}
// 로그인 토큰과 함께 사진을 보내 찾은 재료 목록을 받는다.
async function requestScan(images,mode){
  const {data} = await supabaseClient.auth.getSession();
  const token = data.session?.access_token;
  if(!token) throw new Error("no session");
  const response = await fetch(PHOTO_SCAN_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
    body:JSON.stringify({images,mode})
  });
  if(!response.ok) throw new Error(`scan failed: ${response.status}`);
  const {items} = await response.json();
  return items || [];
}
async function scanFridgePhotos(input){
  const files = [...input.files];
  input.value = "";
  if(!files.length || scanBusy) return;
  if(!PHOTO_SCAN_URL){ toast("사진 분석 주소가 아직 연결되지 않았어요."); return; }
  if(files.length>SCAN_MAX_PHOTOS) toast(`사진은 ${SCAN_MAX_PHOTOS}장까지만 분석해요.`);

  setScanBusy(true);
  try{
    const images = await Promise.all(files.slice(0,SCAN_MAX_PHOTOS).map(shrinkPhoto));
    const items = await requestScan(images,"fridge");
    if(!items.length){ toast("사진에서 식재료를 찾지 못했어요."); return; }
    renderScanResult(items);
  }catch(error){
    console.error("[photoScan]",error);
    toast("사진을 분석하지 못했어요. 잠시 후 다시 시도해주세요.");
  }finally{
    setScanBusy(false);
  }
}
function scanSelect(options,value,label){
  const select = document.createElement("select");
  select.setAttribute("aria-label",label);
  options.forEach(([optionValue,text])=>select.add(new Option(text,optionValue)));
  select.value = value;
  return select;
}
function scanRow(item){
  const row = document.createElement("div");
  row.className = "scanRow";
  row.dataset.kind = item.kind;

  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = true;
  check.className = "ingredientCheck";
  check.setAttribute("aria-label",`${item.name} 넣기`);

  const name = document.createElement("input");
  name.className = "scanName";
  name.value = item.name;
  name.setAttribute("aria-label","재료명");
  row.append(check,name);

  if(item.kind==="seasoning"){
    const tag = document.createElement("span");
    tag.className = "badge scanTag";
    tag.textContent = "양념냉장고로";
    row.append(tag);
    return row;
  }
  const qty = document.createElement("input");
  qty.className = "scanQty";
  qty.type = "number";
  qty.min = "0";
  qty.step = "any";
  qty.value = item.qty;
  qty.setAttribute("aria-label","수량");
  row.append(
    qty,
    scanSelect(SCAN_UNITS.map(unit=>[unit,unit]),item.unit,"단위"),
    scanSelect(SCAN_DAYS,item.days,"소비기한")
  );
  return row;
}
function renderScanResult(items){
  document.getElementById("scanRows").replaceChildren(...items.map(scanRow));
  document.getElementById("scanResult").hidden = false;
}
function closeScanResult(){
  document.getElementById("scanRows").replaceChildren();
  document.getElementById("scanResult").hidden = true;
}
function readScanRows(){
  return [...document.querySelectorAll("#scanRows .scanRow")]
    .filter(row=>row.querySelector(".ingredientCheck").checked)
    .map(row=>{
      const name = row.querySelector(".scanName").value.trim();
      if(row.dataset.kind==="seasoning") return {kind:"seasoning",name};
      const [unit,days] = [...row.querySelectorAll("select")].map(select=>select.value);
      return {kind:"ingredient",name,qty:Number(row.querySelector(".scanQty").value),unit,days:Number(days)};
    });
}
async function saveScanResult(){
  const rows = readScanRows();
  if(!rows.length){ toast("넣을 재료를 선택해주세요."); return; }
  if(rows.some(row=>!row.name || (row.kind==="ingredient" && !(row.qty>0)))){
    toast("재료명과 양을 확인해주세요.");
    return;
  }
  if(!await storeScanRows(rows)) return;
  closeScanResult();
  toast(`${rows.length}개를 넣었어요.`);
}
// 재료는 냉장고에, 양념은 양념냉장고에 넣는다.
async function storeScanRows(rows){
  if(!inventoryUser) return false;
  const saved = await runInventoryOperation("재료 저장 중...",async()=>{
    for(const row of rows.filter(item=>item.kind==="ingredient")){
      const expiryDate = addDaysToDateValue(todayDateValue(),row.days);
      await storeIngredient({name:row.name,qty:row.qty,unit:row.unit,days:row.days,expiryDate});
    }
    render();
  });
  if(!saved) return false;
  for(const row of rows.filter(item=>item.kind==="seasoning")){
    const name = pantryCanonicalName(row.name);
    if(!pantryItems.some(item=>item.name===name)) await togglePantryItem(name);
  }
  return true;
}
