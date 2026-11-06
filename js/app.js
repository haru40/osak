// 식품안전나라 공공 레시피(publicRecipes.js)를 기본 레시피 뒤에 합친다.
if(typeof PUBLIC_RECIPES!=="undefined") RECIPES.push(...PUBLIC_RECIPES);
if(typeof CUSTOM_RECIPES!=="undefined") RECIPES.push(...CUSTOM_RECIPES);

// 물, 밥, 곡물은 집에 늘 있다고 보고 냉장고 비교에서 뺀다.
const STAPLE_PATTERN = /^쌀뜨물|^(물|현미|흑미|귀리|보리|백미)$|(밥|쌀)$/;
function isStaple(name){
  return STAPLE_PATTERN.test(String(name).replace(/\s+/g,""));
}
function moveStaples(recipe){
  Object.entries(recipe.ingredients).filter(([name])=>isStaple(name)).forEach(([name,qty])=>{
    delete recipe.ingredients[name];
    recipe.seasonings.push([name,`${qty}g`]);
  });
  return recipe;
}
RECIPES.forEach(moveStaples);
const DIET_MAX_KCAL = 400;
const FAT_DENSE_KCAL = 400;

const DEFAULT = [
  {name:"양파", qty:600, unit:"g", days:7},
  {name:"감자", qty:700, unit:"g", days:10},
  {name:"당근", qty:300, unit:"g", days:10},
  {name:"돼지고기", qty:500, unit:"g", days:3},
  {name:"대파", qty:120, unit:"g", days:5}
];

const initialState = AppStorage.loadState(DEFAULT);
let inventory = initialState.inventory;
let cookedHistory = initialState.cookedHistory;
let lastDeductions = initialState.lastDeductions;
let currentRecipeId = null;
let recipeCategory = "general";
let pantryItems = [];
let pantryUserId = null;
const pantryBusyNames = new Set();
let pantryOpenCategory = "기본 양념";
let currentServings = 1;
let selectionMode = false;
let selectedIngredientIds = new Set();
let inventoryUser = null;
let loadedInventoryUserId = null;
let inventoryLoadingUserId = null;
let inventoryLoadSequence = 0;
let inventoryOperationBusy = false;
let inventorySyncBlocked = false;

function save(){
  AppStorage.saveState({inventory, cookedHistory, lastDeductions});
}
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 1800);
}
function setInventoryBusy(isBusy,label="냉장고 저장 중..."){
  inventoryOperationBusy = isBusy;
  const status = document.getElementById("inventoryOperationStatus");
  const statusText = document.getElementById("inventoryOperationText");
  status.hidden = !isBusy;
  statusText.textContent = label;

  document.querySelectorAll("#fridgeView button,#fridgeView input,#fridgeView select,#modal button")
    .forEach(element=>element.disabled=isBusy);
}
function showInventorySyncNotice(text){
  document.getElementById("inventorySyncMessage").textContent = text;
  document.getElementById("inventorySyncNotice").hidden = false;
}
function clearInventorySyncNotice(){
  document.getElementById("inventorySyncNotice").hidden = true;
}
async function runInventoryOperation(label,operation){
  if(inventoryOperationBusy) return false;
  if(inventorySyncBlocked){
    toast("먼저 냉장고 데이터를 다시 불러와주세요.");
    return false;
  }

  setInventoryBusy(true,label);
  try{
    await operation();
    return true;
  }catch(error){
    reportInventoryError(label,error);
    return false;
  }finally{
    setInventoryBusy(false);
  }
}
function reportInventoryError(action,error){
  console.error(`[ingredients] ${action}`,error);
  inventorySyncBlocked = true;
  showInventorySyncNotice("저장 상태를 확인할 수 없습니다. 서버 데이터를 다시 불러와주세요.");
  toast("냉장고 데이터를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
}
function gramTotal(list=inventory){
  return list.filter(x=>x.unit==="g").reduce((s,x)=>s+Number(x.qty||0),0);
}
function fmt(q,u="g"){
  if(u==="개") return (Number.isInteger(q)?q:q.toFixed(1)) + "개";
  if(u==="g" && q>=1000) return Math.round(q/100)/10 + "kg";
  return Math.round(q) + u;
}
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateValue(date){
  const year = date.getFullYear();
  const month = String(date.getMonth()+1).padStart(2,"0");
  const day = String(date.getDate()).padStart(2,"0");
  return `${year}-${month}-${day}`;
}
function todayDateValue(){
  return formatDateValue(new Date());
}
function isValidDateValue(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year,month,day] = value.split("-").map(Number);
  const date = new Date(year,month-1,day);
  return date.getFullYear()===year && date.getMonth()===month-1 && date.getDate()===day;
}
function dateValueToUtcDay(value){
  const [year,month,day] = value.split("-").map(Number);
  return Date.UTC(year,month-1,day);
}
function remainingDaysUntil(expiryDate){
  if(!isValidDateValue(expiryDate)) return null;
  const difference = (dateValueToUtcDay(expiryDate)-dateValueToUtcDay(todayDateValue()))/DAY_MS;
  return Math.round(difference);
}
function addDaysToDateValue(baseDateValue,days){
  const [year,month,day] = baseDateValue.split("-").map(Number);
  const date = new Date(year,month-1,day);
  date.setDate(date.getDate()+(Number(days)||0));
  return formatDateValue(date);
}
function storedDays(item){
  if(item.days===null || item.days===undefined || item.days==="") return null;
  const days = Number(item.days);
  return Number.isFinite(days) ? days : null;
}
function ingredientRemainingDays(item){
  return isValidDateValue(item.expiryDate)
    ? remainingDaysUntil(item.expiryDate)
    : storedDays(item);
}
function syncInventoryExpiryDates(){
  const changedItems = [];
  const today = todayDateValue();

  inventory.forEach(item=>{
    let itemChanged = false;
    const legacyDays = storedDays(item);
    if(!isValidDateValue(item.expiryDate) && legacyDays!==null){
      item.expiryDate = addDaysToDateValue(today,legacyDays);
      itemChanged = true;
    }

    const remaining = remainingDaysUntil(item.expiryDate);
    if(remaining!==null && item.days!==remaining){
      item.days = remaining;
      itemChanged = true;
    }
    if(itemChanged) changedItems.push(item);
  });

  return changedItems;
}
function formatExpirySummary(item){
  const remaining = ingredientRemainingDays(item);
  if(!isValidDateValue(item.expiryDate)) return remaining===null ? "소비기한 미설정" : `${remaining}일 내 사용`;
  const [,month,day] = item.expiryDate.split("-").map(Number);
  return `${month}월 ${day}일까지 · ${remaining<0 ? "기한 지남" : `${remaining}일 남음`}`;
}
function toggleExpiryDateInput(){
  const select = document.getElementById("daysInput");
  const dateInput = document.getElementById("expiryDateInput");
  const field = document.getElementById("expiryField");
  const isCustom = select.value==="custom";

  dateInput.hidden = !isCustom;
  dateInput.min = todayDateValue();
  field.classList.toggle("customExpiry",isCustom);
}
function openFridge(){
  document.querySelector(".fridgeScene").classList.add("open");
}
function go(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id===id));
  document.querySelectorAll(".navBtn").forEach(n=>n.classList.toggle("active", n.dataset.target===id));
  document.querySelector(".screen").classList.toggle("landing", id==="landingView");
  if(id==="landingView") document.querySelector(".fridgeScene").classList.remove("open");
}
async function loadDemo(){
  if(!inventoryUser) return;
  const sampleInventory = JSON.parse(JSON.stringify(DEFAULT));
  const previousInventory = inventory;
  inventory = sampleInventory;
  syncInventoryExpiryDates();
  inventory = previousInventory;

  await runInventoryOperation("샘플 재료 저장 중...",async()=>{
    await IngredientStore.removeAll(inventoryUser.id);
    inventory = await IngredientStore.insertMany(inventoryUser.id,sampleInventory);
    cookedHistory = [];
    lastDeductions = [];
    save();
    render();
    toast("샘플 재료를 다시 채웠어요.");
  });
}
async function clearAll(){
  if(!confirm("냉장고 재료를 모두 비울까요?")) return;
  if(!inventoryUser) return;

  await runInventoryOperation("냉장고 비우는 중...",async()=>{
    await IngredientStore.removeAll(inventoryUser.id);
    inventory = [];
    cookedHistory = [];
    lastDeductions = [];
    selectionMode = false;
    selectedIngredientIds.clear();
    save();
    render();
  });
}
function resetCooked(){
  cookedHistory = [];
  save();
  render();
  toast("완료 기록을 초기화했어요.");
}
async function addIngredient(){
  const n = document.getElementById("nameInput").value.trim();
  const enteredQty = Number(document.getElementById("qtyInput").value);
  const enteredUnit = document.getElementById("unitInput").value;
  if(!n || !enteredQty || enteredQty<=0){ toast("재료명과 양을 입력해주세요."); return; }
  // kg은 g으로 바꿔 저장해서 레시피 비교와 차감을 같은 방식으로 처리한다.
  const q = enteredUnit==="kg" ? enteredQty*1000 : enteredQty;
  const u = enteredUnit==="kg" ? "g" : enteredUnit;

  const expirySelection = document.getElementById("daysInput").value;
  let expiryDate;
  let d;

  if(expirySelection==="custom"){
    expiryDate = document.getElementById("expiryDateInput").value;
    if(!isValidDateValue(expiryDate)){
      toast("소비기한 날짜를 선택해주세요.");
      return;
    }
    if(dateValueToUtcDay(expiryDate)<dateValueToUtcDay(todayDateValue())){
      toast("오늘 이후의 날짜를 선택해주세요.");
      return;
    }
    d = remainingDaysUntil(expiryDate);
  }else{
    d = Number(expirySelection);
    expiryDate = addDaysToDateValue(todayDateValue(),d);
  }

  if(!inventoryUser) return;
  await runInventoryOperation("재료 저장 중...",async()=>{
    await storeIngredient({name:n,qty:q,unit:u,days:d,expiryDate});

    document.getElementById("nameInput").value = "";
    document.getElementById("qtyInput").value = "";
    render();
    toast(n + " 추가 완료");
  });
}
// 이름·단위·소비기한이 같으면 수량을 합치고, 아니면 새로 넣는다.
async function storeIngredient({name,qty,unit,days,expiryDate}){
  const existingIndex = inventory.findIndex(x=>
    normalizeIngredientName(x.name)===normalizeIngredientName(name) &&
    x.unit===unit &&
    x.expiryDate===expiryDate
  );
  if(existingIndex>=0){
    const existing = inventory[existingIndex];
    const currentExpiry = isValidDateValue(existing.expiryDate)
      ? existing.expiryDate
      : addDaysToDateValue(todayDateValue(),existing.days);
    const candidate = {
      ...existing,
      qty:Number(existing.qty)+qty,
      expiryDate:currentExpiry<=expiryDate ? currentExpiry : expiryDate
    };
    candidate.days = remainingDaysUntil(candidate.expiryDate);
    inventory[existingIndex] = await IngredientStore.update(inventoryUser.id,candidate);
  }else{
    const inserted = await IngredientStore.insert(inventoryUser.id,{name,qty,unit,days,expiryDate});
    inventory.push(inserted);
  }
}
async function removeIngredient(id){
  const item = inventory.find(candidate=>String(candidate.id)===String(id));
  if(!item || !inventoryUser) return;
  if(item.id==null){
    toast("냉장고 연결을 확인한 후 다시 시도해주세요.");
    return;
  }

  await runInventoryOperation("재료 삭제 중...",async()=>{
    await IngredientStore.remove(inventoryUser.id,item.id);
    inventory = inventory.filter(candidate=>String(candidate.id)!==String(item.id));
    render();
  });
}
function toggleSelectionMode(){
  selectionMode = !selectionMode;
  selectedIngredientIds.clear();
  renderIngredients();
}
function toggleIngredientSelection(id, checked){
  const normalizedId = String(id);
  if(checked) selectedIngredientIds.add(normalizedId);
  else selectedIngredientIds.delete(normalizedId);
}
async function deleteSelectedIngredients(){
  if(!selectedIngredientIds.size){
    toast("삭제할 재료를 선택해주세요.");
    return;
  }
  if(!inventoryUser) return;
  const selectedItems = inventory.filter(item=>item.id!=null && selectedIngredientIds.has(String(item.id)));
  const ids = selectedItems.map(item=>item.id);
  if(ids.length!==selectedIngredientIds.size){
    toast("냉장고 연결을 확인한 후 다시 시도해주세요.");
    return;
  }

  await runInventoryOperation("선택한 재료 삭제 중...",async()=>{
    await IngredientStore.removeMany(inventoryUser.id,ids);
    inventory = inventory.filter(item=>!selectedIngredientIds.has(String(item.id)));
    selectionMode = false;
    selectedIngredientIds.clear();
    render();
  });
}
function renderSelectionControls(){
  const selectButton = document.getElementById("selectClearBtn");
  const actionButton = document.getElementById("clearAllBtn");
  if(!selectButton || !actionButton) return;

  selectButton.textContent = selectionMode ? "취소" : "선택 삭제";
  actionButton.textContent = selectionMode ? "선택 삭제" : "전체 비우기";
  actionButton.onclick = selectionMode ? deleteSelectedIngredients : clearAll;
}

const INGREDIENT_ALIASES = {
  "달걀":"계란",
  "파":"대파",
  "쪽파":"대파",
  "돼지":"돼지고기",
  "돼지목살":"돼지고기",
  "목살":"돼지고기",
  "앞다리살":"돼지고기",
  "돼지앞다리살":"돼지고기",
  "감자 ":"감자",
  "양파 ":"양파"
};

// 1개당 대략적인 중량. 사용자가 '개'로 입력해도 g 레시피와 비교/차감 가능하게 사용.
const PIECE_GRAMS = {
  "양파":200,
  "감자":150,
  "당근":150,
  "애호박":280,
  "두부":300,
  "대파":100,
  "김치":200
};

function normalizeIngredientName(name){
  const cleaned = String(name || "").trim().replace(/\s+/g,"");
  return INGREDIENT_ALIASES[cleaned] || cleaned;
}

function recipeUnit(name){
  return normalizeIngredientName(name)==="계란" ? "개" : "g";
}

function inventoryAmountInRecipeUnit(name, inv=inventory){
  const canonical = normalizeIngredientName(name);
  const targetUnit = recipeUnit(canonical);
  let total = 0;

  inv.forEach(item=>{
    if(normalizeIngredientName(item.name)!==canonical) return;
    const qty = Number(item.qty) || 0;

    if(targetUnit==="개"){
      if(item.unit==="개") total += qty;
      // 계란을 g으로 입력한 경우 1개≈50g으로 환산
      else if(item.unit==="g") total += qty / 50;
    } else {
      if(item.unit==="g") total += qty;
      else if(item.unit==="개"){
        const gpp = PIECE_GRAMS[canonical];
        if(gpp) total += qty * gpp;
      }
      else if(item.unit==="ml"){
        // 물과 비슷한 밀도의 재료에 대한 단순 MVP 환산
        total += qty;
      }
    }
  });

  return total;
}


function canCookRecipe(recipe, servings=1, inv=inventory){
  return missing(recipe, inv, servings).length===0;
}

function inventoryDisplayForRecipeIngredient(name, inv=inventory){
  const canonical = normalizeIngredientName(name);
  const matched = inv.filter(v=>normalizeIngredientName(v.name)===canonical);
  if(!matched.length) return "없음";
  return matched.map(v=>{
    return fmt(Math.round(Number(v.qty)*10)/10,v.unit);
  }).join(" + ");
}

function deductIngredient(name, amountInRecipeUnit, inv=inventory){
  const canonical = normalizeIngredientName(name);
  const targetUnit = recipeUnit(canonical);
  let remaining = Number(amountInRecipeUnit) || 0;
  const deductionRows = [];

  // 같은 재료의 여러 batch는 소비기한이 가까운 순서대로 차감한다.
  // 날짜가 없는 레거시 데이터는 날짜가 있는 batch 뒤에서 days 순으로 처리한다.
  const batches = inv
    .map((item,index)=>({item,index}))
    .filter(({item})=>normalizeIngredientName(item.name)===canonical)
    .sort((a,b)=>{
      const aHasDate = isValidDateValue(a.item.expiryDate);
      const bHasDate = isValidDateValue(b.item.expiryDate);
      if(aHasDate && bHasDate){
        const dateOrder = a.item.expiryDate.localeCompare(b.item.expiryDate);
        return dateOrder || a.index-b.index;
      }
      if(aHasDate!==bHasDate) return aHasDate ? -1 : 1;
      const daysOrder = Number(a.item.days || 0)-Number(b.item.days || 0);
      return daysOrder || a.index-b.index;
    });

  for(const {item} of batches){
    if(remaining<=0) break;

    const before = Number(item.qty) || 0;
    let availableTarget = 0;
    let targetPerStored = 1;

    if(targetUnit==="개"){
      if(item.unit==="개"){ availableTarget = before; targetPerStored = 1; }
      else if(item.unit==="g"){ availableTarget = before / 50; targetPerStored = 1/50; }
    }else{
      if(item.unit==="g"){ availableTarget = before; targetPerStored = 1; }
      else if(item.unit==="개" && PIECE_GRAMS[canonical]){
        availableTarget = before * PIECE_GRAMS[canonical];
        targetPerStored = PIECE_GRAMS[canonical];
      }else if(item.unit==="ml"){
        availableTarget = before;
        targetPerStored = 1;
      }
    }

    if(availableTarget<=0) continue;

    const useTarget = Math.min(availableTarget, remaining);
    const useStored = useTarget / targetPerStored;
    item.qty = Math.max(0, before - useStored);

    deductionRows.push({
      name:item.name,
      used: Math.round(useStored*10)/10,
      before: Math.round(before*10)/10,
      after: Math.round(item.qty*10)/10,
      unit:item.unit
    });

    remaining -= useTarget;
  }

  return deductionRows;
}

function missing(recipe, inv=inventory, servings=1){
  return Object.entries(recipe.ingredients)
    .map(([name, need])=>{
      const required = Number(need) * servings;
      const have = inventoryAmountInRecipeUnit(name, inv);
      return [name, Math.max(0, required-have)];
    })
    .filter(([,shortage])=>shortage>0.0001)
    .map(([name,shortage])=>[name, Math.ceil(shortage*10)/10]);
}
function score(recipe, inv=inventory){
  let owned = 0, total = Object.keys(recipe.ingredients).length, urgent = 0;

  Object.entries(recipe.ingredients).forEach(([name, need])=>{
    const have = inventoryAmountInRecipeUnit(name, inv);
    if(have>0){
      owned += Math.min(have/need, 1);

      // 동일 재료 중 가장 임박한 보관기한 반영
      const matched = inv.filter(v=>normalizeIngredientName(v.name)===normalizeIngredientName(name));
      if(matched.some(v=>v.days<=3)) urgent += 4;
    }
  });

  return Math.max(0, Math.round((total ? owned/total : 1)*80 + urgent - missing(recipe, inv).length*8));
}
function isCooked(id){
  return cookedHistory.some(h=>h.id===id);
}
function unitFor(name){
  return recipeUnit(name);
}
function totalMissingAmount(recipe, inv=inventory){
  return missing(recipe, inv).reduce((sum, [name, qty]) => sum + (unitFor(name)==="개" ? qty*80 : qty), 0);
}
function isDietRecipe(r){
  return r.diet===true || (recipeKcal(r)!=null && recipeKcal(r)<=DIET_MAX_KCAL);
}
function recipesInCategory(category){
  return RECIPES.filter(r=>isDietRecipe(r)===(category==="diet"));
}
function rankedRecipes(category=recipeCategory){
  return recipesInCategory(category).map(r=>{
    const miss = missing(r);
    return {
      recipe:r,
      score:score(r),
      miss,
      owned:Object.keys(r.ingredients).length-miss.length,
      cooked:isCooked(r.id),
      missingAmount:totalMissingAmount(r)
    };
  }).sort((a,b)=>{
    if(a.miss.length!==b.miss.length) return a.miss.length-b.miss.length;
    if(a.owned!==b.owned) return b.owned-a.owned;
    if(a.missingAmount!==b.missingAmount) return a.missingAmount-b.missingAmount;
    return b.score-a.score;
  });
}
function readyNewRecipes(category=recipeCategory){
  return rankedRecipes(category).filter(x=>!x.cooked && x.miss.length===0);
}
function nearNewRecipes(category=recipeCategory){
  return rankedRecipes(category).filter(x=>!x.cooked && x.owned>0 && x.miss.length>0 && x.miss.length<=2).slice(0,5);
}
function readyRepeatRecipes(category=recipeCategory){
  return rankedRecipes(category).filter(x=>x.cooked && x.miss.length===0);
}
function fallbackRecipes(category=recipeCategory){
  return rankedRecipes(category).slice(0,5);
}
function renderStats(){
  document.getElementById("sCount").textContent = inventory.length;
  const w = gramTotal();
  document.getElementById("sWeight").textContent = w>=1000 ? (w/1000).toFixed(1)+"kg" : Math.round(w)+"g";
  document.getElementById("sUrgent").textContent = inventory.filter(x=>{
    const remaining = ingredientRemainingDays(x);
    return remaining!==null && remaining<=3;
  }).length;
}
function urgentStatusLabel(remaining){
  if(remaining<0) return "기한 지남";
  return remaining===0 ? "D-DAY" : `D-${remaining}`;
}
function renderUrgentIngredients(){
  const card = document.getElementById("urgentIngredientsCard");
  const list = document.getElementById("urgentIngredientsList");
  if(!card || !list) return;

  const urgentItems = inventory
    .map((item,index)=>({item,index,remaining:ingredientRemainingDays(item)}))
    .filter(({remaining})=>remaining!==null && remaining<=3)
    .sort((a,b)=>a.remaining-b.remaining || a.index-b.index)
    .slice(0,3);

  card.hidden = urgentItems.length===0;
  if(!urgentItems.length){
    list.innerHTML = "";
    return;
  }

  list.innerHTML = urgentItems.map(({item,remaining})=>{
    const dateText = isValidDateValue(item.expiryDate)
      ? `${Number(item.expiryDate.slice(5,7))}월 ${Number(item.expiryDate.slice(8,10))}일까지`
      : `${remaining}일 이내`;
    return `<div class="urgentIngredientItem">
      <div><b>${escapeHtml(item.name)}</b><small>${fmt(item.qty,item.unit)} · ${dateText}</small></div>
      <span class="urgentDay ${remaining<0 ? "expired" : ""}">${urgentStatusLabel(remaining)}</span>
    </div>`;
  }).join("");
}
function inventoryDisplayOrder(){
  return inventory
    .map((item,index)=>({item,index}))
    .sort((a,b)=>{
      const aHasDate = isValidDateValue(a.item.expiryDate);
      const bHasDate = isValidDateValue(b.item.expiryDate);
      if(aHasDate && bHasDate){
        const dateOrder = a.item.expiryDate.localeCompare(b.item.expiryDate);
        return dateOrder || a.index-b.index;
      }
      if(aHasDate!==bHasDate) return aHasDate ? -1 : 1;

      const aDays = storedDays(a.item);
      const bDays = storedDays(b.item);
      if(aDays!==null && bDays!==null) return aDays-bDays || a.index-b.index;
      if((aDays!==null)!==(bDays!==null)) return aDays!==null ? -1 : 1;
      return a.index-b.index;
    })
    .map(({item})=>item);
}
function renderIngredients(){
  const box = document.getElementById("ingredientList");
  renderSelectionControls();
  if(!inventory.length){
    box.innerHTML = '<div class="empty">냉장고가 비어 있어요.<br>재료를 먼저 추가해보세요.</div>';
    return;
  }
  box.innerHTML = inventoryDisplayOrder()
    .map(x=>{
      const remaining = ingredientRemainingDays(x);
      const badges = remaining!==null && remaining<0
        ? '<span class="badge expired">기한 지남</span>'
        : `<span class="badge">보관 중</span>${remaining!==null && remaining<=3 ? '<span class="badge urgent">임박</span>' : ""}`;
      return `<div class="ing ${selectionMode ? "selecting" : ""}">
      ${selectionMode ? `<input class="ingredientCheck" type="checkbox" aria-label="${escapeHtml(x.name)} 선택" ${x.id==null ? "disabled" : ""} ${selectedIngredientIds.has(String(x.id)) ? "checked" : ""} onchange='toggleIngredientSelection(${JSON.stringify(String(x.id))}, this.checked)'>` : ""}
      <div><b>${escapeHtml(x.name)}</b><small class="ingredientMeta"><b>남은 잔량 ${fmt(x.qty,x.unit)}</b><span>${formatExpirySummary(x)}</span></small></div>
      <span class="ingredientBadges">${badges}</span>
      ${selectionMode ? "" : `<button class="iconBtn" onclick='removeIngredient(${JSON.stringify(String(x.id))})'>×</button>`}
    </div>`;
    }).join("");
}
function isPublicRecipe(r){
  return r.id.startsWith("fs-");
}
function toAppRecipe(row){
  return moveStaples({
    id:`cr-${row.id}`,
    name:escapeHtml(row.name),
    emoji:escapeHtml(row.emoji),
    time:row.time_min,
    diet:true,
    ingredients:Object.fromEntries(Object.entries(row.ingredients).map(([name,qty])=>[escapeHtml(name),Number(qty)])),
    seasonings:row.seasonings.map(([name,qty])=>[escapeHtml(name),escapeHtml(qty)]),
    steps:row.steps.map(escapeHtml),
    source:escapeHtml(row.source || "직접 입력한 레시피"),
    sourceUrl:/^https:\/\//.test(row.source_url || "") ? escapeHtml(row.source_url) : "",
    image:/^https:\/\//.test(row.image_url || "") ? escapeHtml(row.image_url) : "",
    nutrition:row.nutrition && {
      ...row.nutrition,
      highlights:(row.nutrition.highlights || []).map(item=>({
        name:escapeHtml(item.name),
        kcal:Number(item.kcal),
        share:Number(item.share),
        per100:Number(item.per100),
        kind:item.kind,
        removable:item.removable===true
      }))
    }
  });
}
// n8n이 저장하고 승인한 레시피를 합친다. 실패해도 나머지 레시피는 그대로 쓴다.
async function loadSavedRecipes(){
  try{
    const {data,error} = await supabaseClient
      .from("custom_recipes")
      .select("id,name,emoji,time_min,ingredients,seasonings,steps,nutrition,image_url,source,source_url");
    if(error) throw error;
    const kept = RECIPES.filter(r=>!r.id.startsWith("cr-"));
    RECIPES.splice(0,RECIPES.length,...kept,...data.map(toAppRecipe));
    renderRecipes();
  }catch(error){
    console.error("[recipes] 저장된 레시피 불러오기 실패",error);
  }
}
function recipeImageSrc(r){
  return RECIPE_PHOTOS[r.id]?.src || RECIPE_IMAGES[r.id] || r.image || "";
}
function recipePhotoCredit(r){
  const photo = RECIPE_PHOTOS[r.id];
  if(!photo) return "";
  return `<a class="photoCredit" href="${photo.page}" target="_blank" rel="noreferrer">사진: ${escapeHtml(photo.credit)} · ${photo.license} · 크기 조정</a>`;
}
function recipeKcal(r){
  return r.nutrition?.kcal ?? null;
}
function recipeMeta(r){
  return [
    r.time ? `${r.time}분` : "",
    recipeKcal(r)!=null ? `${recipeKcal(r)}kcal` : "",
    "1인분"
  ].filter(Boolean).join(" · ");
}
function recipeCard(r, s, mode="new"){
  const m = missing(r);
  const cooked = isCooked(r.id);
  let status = "";
  if(m.length===0){
    status = cooked ? "전에 만든 메뉴 · 냉장고 재료로 다시 가능" : "냉장고 재료로 바로 요리 가능";
  }else{
    status = "추가: " + m.slice(0,3).map(x=>x[0]+" "+x[1]+unitFor(x[0])).join(", ");
  }

  const tag = mode==="repeat"
    ? '<span class="chip">🔁 다시 만들기</span>'
    : mode==="near"
      ? '<span class="chip">🛒 최소 추가구매</span>'
      : '<span class="chip">✨ 새 메뉴</span>';

  return `<div class="recipe">
    ${recipeImageSrc(r) ? `<img class="recipeImage clickable" src="${recipeImageSrc(r)}" loading="lazy" alt="${r.name} 플레이팅 참고 이미지" onclick="openRecipe('${r.id}')">` : ""}
    <div class="recipeTop">
      <div>
        <h4>${r.emoji} ${r.name}</h4>
        <small>${status}</small>
      </div>
      <div class="score">${Math.min(99,s)}<small>활용점수</small></div>
    </div>
    <div class="chips">
      ${r.time ? `<span class="chip">⏱ ${r.time}분</span>` : ""}
      ${recipeKcal(r)!=null ? `<span class="chip">🔥 ${recipeKcal(r)}kcal</span>` : ""}
      <span class="chip">🍽 1인분 기본</span>
      ${tag}
    </div>
    <div style="font-size:10px;color:var(--muted);margin:6px 0 10px">${isPublicRecipe(r) ? "🏛 식약처 레시피 DB · 영양정보 포함" : "🌐 웹 레시피 기반 상세 양념장 반영"}</div>
    <div class="actions">
      <button class="btn primary" onclick="openRecipe('${r.id}')">레시피 보기</button>
    </div>
  </div>`;
}
function setRecipeCategory(category){
  recipeCategory = category;
  renderRecipes();
}
function renderRecipes(){
  const readyNew = readyNewRecipes();
  const nearNew = nearNewRecipes();
  const repeats = readyRepeatRecipes();

  document.querySelectorAll(".recipeTabs button").forEach(button=>{
    button.classList.toggle("on",button.dataset.category===recipeCategory);
  });

  // HOME: 새 메뉴 우선 → 다시 만들기 → 최소 추가구매 → 전체 최적 후보 (일반 레시피 기준)
  let homePick = readyNewRecipes("general")[0] || readyRepeatRecipes("general")[0]
    || nearNewRecipes("general")[0] || fallbackRecipes("general")[0];
  document.getElementById("homeRecipe").innerHTML = homePick
    ? recipeCard(
        homePick.recipe,
        homePick.score,
        homePick.cooked ? "repeat" : (homePick.miss.length ? "near" : "new")
      )
    : '<div class="empty">냉장고에 재료를 추가하면 메뉴를 계속 추천해드려요.</div>';

  // 새 메뉴: 현재 재료로 바로 가능한 메뉴
  document.getElementById("recipeList").innerHTML = readyNew.length
    ? readyNew.slice(0,10).map(x=>recipeCard(x.recipe,x.score,"new")).join("")
    : '<div class="empty recipeEmpty">아직 바로 만들 수 있는 새 메뉴가 없어요. 아래 ‘조금만 더 사면 가능’ 또는 ‘다시 만들어도 돼요’를 확인해보세요.</div>';

  // 최소 추가구매
  const nearBox = document.getElementById("nearRecipeList");
  if(nearBox){
    nearBox.innerHTML = nearNew.length
      ? nearNew.map(x=>recipeCard(x.recipe,x.score,"near")).join("")
      : '<div class="empty">추가 구매가 필요한 새 메뉴가 없어요.</div>';
  }

  // 이전에 만든 메뉴도 재료만 있으면 다시 허용
  const repeatBox = document.getElementById("repeatRecipeList");
  if(repeatBox){
    repeatBox.innerHTML = repeats.length
      ? repeats.map(x=>recipeCard(x.recipe,x.score,"repeat")).join("")
      : '<div class="empty repeatEmpty">지금 다시 만들 수 있는 완료 메뉴는 없어요.</div>';
  }
}
function makePlan(){
  let inv = inventory.map(x=>({...x}));
  const before = gramTotal(inv);
  const plan = [];
  for(let day=0; day<5; day++){
    const candidate = recipesInCategory("general")
      .filter(r=>!plan.some(p=>p.id===r.id))
      .filter(r=>missing(r, inv).length===0)
      .sort((a,b)=>score(b,inv)-score(a,inv))[0];
    if(!candidate) break;
    plan.push(candidate);
    Object.entries(candidate.ingredients).forEach(([n,q])=>{
      deductIngredient(n, q, inv);
    });
    inv = inv.filter(x=>x.qty>0);
    inv.forEach(x=>x.days = Math.max(0, x.days-1));
  }
  const after = gramTotal(inv);
  const percent = before ? Math.max(0, Math.round((1-after/before)*100)) : 0;
  return [plan, percent];
}
function renderPlan(){
  const [plan, percent] = makePlan();
  document.getElementById("planList").innerHTML = plan.length
    ? plan.map((r,i)=>`<div class="planItem">
        <div class="day">${i===0?"오늘":"DAY "+(i+1)}</div>
        <div><b>${r.emoji} ${r.name}</b><br><small>${recipeMeta(r)}</small></div>
        <button class="btn soft" onclick="openRecipe('${r.id}')">보기</button>
      </div>`).join("")
    : '<div class="empty planEmpty">현재 재료 기준으로 새 소진 플랜이 없어요.</div>';
  document.getElementById("planBar").style.width = percent + "%";
  document.getElementById("planPercent").textContent = percent + "%";
  document.getElementById("sUse").textContent = percent + "%";
}
function renderHistory(){
  const box = document.getElementById("historyList");
  if(!cookedHistory.length){
    box.innerHTML = '<div class="empty">아직 완료한 요리가 없어요.</div>';
    return;
  }
  box.innerHTML = cookedHistory.slice().reverse().map(h=>`
    <div class="historyItem">
      <b>${h.emoji} ${h.name}</b><br>
      <small>${h.servings}인분 완료 · ${h.timeLabel}</small>
    </div>
  `).join("");
}

function renderDeductions(){
  const box = document.getElementById("deductionList");
  if(!box) return;
  if(!lastDeductions.length){
    box.innerHTML = '<div class="empty">아직 차감된 재료가 없어요.<br>요리를 완료하면 여기에 기록됩니다.</div>';
    return;
  }
  box.innerHTML = lastDeductions.map(d=>`
    <div class="historyItem">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div>
          <b>${escapeHtml(d.name)}</b><br>
          <small>${d.before}${d.unit} → <b style="color:var(--brand)">${d.after}${d.unit}</b></small>
        </div>
        <span class="badge warn">-${d.used}${d.unit}</span>
      </div>
    </div>
  `).join("");
}

function openRecipe(id){
  currentRecipeId = id;
  currentServings = 1;
  renderModal();
  document.getElementById("modalBg").classList.add("show");
}
function closeModal(){
  document.getElementById("modalBg").classList.remove("show");
}
function setServings(n){
  currentServings = n;
  renderModal();
}
function scale(text){
  const m = String(text).match(/^([0-9.]+)(.*)$/);
  if(!m) return text;
  const value = Math.round(Number(m[1]) * currentServings * 10) / 10;
  return (Number.isInteger(value)?value:value.toFixed(1)) + m[2];
}
// 양념 칸 선택지. 각 묶음의 첫 값이 표시 이름이고 뒤는 레시피에서 같은 양념으로 볼 이름이다.
const PANTRY_CATALOG = [
  ["기본 양념","🧂",[["소금","천일염"],["설탕"],["후추","후춧가루"],["마늘"],["생강"],["고춧가루"],["참깨","통깨","깨소금","검은깨","검정깨","흑임자"]]],
  ["장·젓갈","🍶",[["간장"],["고추장"],["된장"],["쌈장"],["액젓"],["참치액"],["새우젓"]]],
  ["기름·유지","🌻",[["식용유","카놀라유","포도씨유","현미유","튀김기름"],["참기름"],["들기름"],["올리브유","올리브오일"],["고추기름"],["버터"]]],
  ["단맛","🍯",[["올리고당"],["물엿"],["꿀"],["매실청","매실액"],["알룰로스"],["유자청"]]],
  ["식초·술","🍋",[["식초"],["레몬즙","레몬주스"],["맛술","미림"],["청주","정종"]]],
  ["소스","🥫",[["마요네즈"],["케첩","케찹"],["머스터드","머스타드","겨자"],["굴소스"],["토마토소스"]]],
  ["가루","🌾",[["밀가루","강력분","박력분","중력분"],["전분","녹말"],["빵가루"],["튀김가루"],["부침가루"],["찹쌀가루"],["카레가루"],["들깨가루","들깻가루"]]],
  ["육수·조미료","🍲",[["코인육수","코인","멸치육수","다시마육수","육수","다시팩"],["멸치"],["다시마"],["치킨스톡","닭육수"],["다시다"]]],
  ["허브·향신료","🌿",[["파슬리"],["바질"],["로즈마리"],["월계수잎"],["계피"]]]
];
const PANTRY_CUSTOM_LABEL = "직접 등록";
const PANTRY_NAMES = PANTRY_CATALOG.flatMap(([,,options])=>options);
function pantryWords(name){
  return PANTRY_NAMES.find(([label])=>label===name) || [name];
}
function pantryKey(name){
  return String(name).replace(/\s+/g,"");
}
// '간장'을 고르면 '진간장'도 있는 것으로 본다. 한 글자 이름은 정확히 같을 때만 인정한다.
function pantryHas(name){
  const key = pantryKey(name);
  return isStaple(key) || pantryItems.some(item=>pantryWords(item.name).some(word=>{
    const owned = pantryKey(word);
    if(owned===key) return true;
    return owned.length>1 && key.length>1 && (owned.includes(key) || key.includes(owned));
  }));
}
// 양념 칸에 없어도 냉장고에 있으면 있는 것으로 본다. 레시피 양념 줄에 대파, 우유 같은 재료도 있다.
function seasoningAvailable(name){
  const key = normalizeIngredientName(name);
  return pantryHas(name) || inventory.some(item=>normalizeIngredientName(item.name)===key);
}
function pantryOption(name){
  const on = pantryItems.some(item=>item.name===name);
  return `<button type="button" class="pantryOption ${on ? "on" : ""}" aria-pressed="${on}" data-name="${escapeHtml(name)}" onclick="togglePantryItem(this.dataset.name)">${escapeHtml(name)}</button>`;
}
function pantryTab({label,icon,names}){
  const count = names.filter(name=>pantryItems.some(item=>item.name===name)).length;
  const open = label===pantryOpenCategory;
  return `<button type="button" class="pantryTab ${open ? "on" : ""}" aria-expanded="${open}" data-label="${label}" onclick="togglePantryCategory(this.dataset.label)">
    <span class="pantryTabIcon" aria-hidden="true">${icon}</span>
    <b>${label}</b>
    <small>${count}개</small>
  </button>`;
}
function togglePantryCategory(label){
  pantryOpenCategory = label===pantryOpenCategory ? null : label;
  renderPantry();
}
function renderPantry(){
  const box = document.getElementById("pantryList");
  if(!box) return;
  // 목록에 없는 양념은 직접 등록 묶음에 보여준다. 다시 누르면 지워진다.
  const others = pantryItems.map(item=>item.name).filter(name=>!isStaple(name) && !PANTRY_NAMES.some(([label])=>label===name));
  const groups = PANTRY_CATALOG.map(([label,icon,options])=>({label,icon,names:options.map(([name])=>name)}));
  if(others.length) groups.push({label:PANTRY_CUSTOM_LABEL,icon:"✏️",names:others});
  const open = groups.find(group=>group.label===pantryOpenCategory);
  box.innerHTML = `<div class="pantryTabs">${groups.map(pantryTab).join("")}</div>
    ${open ? `<div class="pantryOptions">${open.names.map(pantryOption).join("")}</div>` : ""}`;
}
async function loadPantry(user){
  pantryUserId = user.id;
  try{
    const items = await PantryStore.getAll(user.id);
    if(pantryUserId!==user.id) return;
    pantryItems = items;
    renderPantry();
  }catch(error){
    console.error("[pantry] 양념냉장고 불러오기 실패",error);
    toast("양념냉장고를 불러오지 못했어요.");
  }
}
// 목록에 있는 이름이면 그 양념을 선택하고, 없으면 직접 등록으로 저장한다.
function pantryListed(typed){
  return PANTRY_NAMES.find(words=>words.some(word=>pantryKey(word)===pantryKey(typed)));
}
function pantryCanonicalName(typed){
  const listed = pantryListed(typed);
  return listed ? listed[0] : typed;
}
async function addPantryItem(){
  const input = document.getElementById("pantryInput");
  const typed = input.value.trim();
  if(!typed){ toast("양념 이름을 입력해주세요."); return; }
  const listed = pantryListed(typed);
  const name = pantryCanonicalName(typed);
  if(pantryItems.some(item=>pantryKey(item.name)===pantryKey(name))){
    toast("이미 선택한 양념이에요.");
    return;
  }
  const category = PANTRY_CATALOG.find(([,,options])=>options.includes(listed));
  pantryOpenCategory = category ? category[0] : PANTRY_CUSTOM_LABEL;
  await togglePantryItem(name);
  if(pantryItems.some(item=>item.name===name)) input.value = "";
}
async function togglePantryItem(name){
  if(!pantryUserId){ toast("로그인 정보를 확인 중이에요. 새로고침 후 다시 시도해주세요."); return; }
  if(pantryBusyNames.has(name)) return;
  pantryBusyNames.add(name);
  const owned = pantryItems.find(item=>item.name===name);
  try{
    if(owned){
      await PantryStore.remove(pantryUserId,owned.id);
      pantryItems = pantryItems.filter(item=>item.id!==owned.id);
    }else{
      pantryItems.push(await PantryStore.insert(pantryUserId,name));
    }
    renderPantry();
  }catch(error){
    console.error("[pantry] 양념 변경 실패",error);
    toast("양념을 저장하지 못했어요.");
  }finally{
    pantryBusyNames.delete(name);
  }
}
function calorieHighlightRow(item){
  const note = item.kind==="fat" && item.per100>=FAT_DENSE_KCAL
    ? "지방이 대부분이라 조금만 넣어도 칼로리가 크게 늘어요"
    : {fat:"지방 비중이 높아요",carb:"탄수화물 비중이 높아요",protein:"단백질 비중이 높아요"}[item.kind] || "";
  const kcal = Math.round(item.kcal*currentServings);
  const total = Math.round(recipeKcal(RECIPES.find(x=>x.id===currentRecipeId))*currentServings);
  return `<div class="row">
    <span>${item.name} · 전체의 ${item.share}%<br><small style="color:var(--muted)">100g당 약 ${item.per100}kcal${note ? ` · ${note}` : ""}</small></span>
    <b style="color:var(--brand)">${item.removable ? `빼면 -${kcal}kcal → ${total-kcal}kcal` : `약 ${kcal}kcal`}</b>
  </div>`;
}
const STEP_NAME_ALIASES = {"계란":["달걀"],"소고기":["쇠고기"],"닭고기":["닭"],"닭가슴살":["닭"],"돼지고기":["돼지"]};
// 재료 이름 뒤에 조사나 문장부호가 올 때만 맞춘다. '고추'가 '고추장'에 붙거나 '두 가지'에 붙지 않게 한다.
function stepAmountPattern(word){
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return new RegExp(`(?<![두세네]\\s)${escaped}(?=[은는이가을를와과에도로의,.·\\s]|$)`);
}
// 공공·인스타 레시피의 조리 순서에는 양이 없어서, 재료가 처음 나오는 문장에 분량을 붙인다.
function stepsWithAmounts(r){
  if(!r.nutrition) return r.steps;
  const amounts = [
    ...Object.entries(r.ingredients).map(([name,q])=>[name,fmt(q*currentServings,recipeUnit(name))]),
    ...r.seasonings.map(([name,q])=>[name,scale(q)])
  ].filter(([name])=>name.length>1).sort((a,b)=>b[0].length-a[0].length);
  const steps = [...r.steps];
  amounts.forEach(([name,amount])=>{
    const patterns = [name,...(STEP_NAME_ALIASES[name] || [])].map(stepAmountPattern);
    for(let i=0;i<steps.length;i++){
      const pattern = patterns.find(p=>p.test(steps[i]));
      if(pattern){
        steps[i] = steps[i].replace(pattern,match=>`${match}(${amount})`);
        break;
      }
    }
  });
  return steps;
}
function renderModal(){
  const r = RECIPES.find(x=>x.id===currentRecipeId);
  const m = missing(r, inventory, currentServings);
  document.getElementById("modal").innerHTML = `
    <div class="mhead">
      <div>
        <small style="color:var(--muted);font-weight:800">${isPublicRecipe(r) ? "식약처 레시피 DB 기반 레시피" : "웹 레시피 기반 1인분 상세 레시피"}</small>
        <h3>${r.emoji} ${r.name}</h3>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <div class="serv">
      ${[1,2,3].map(n=>`<button class="${currentServings===n?'on':''}" onclick="setServings(${n})">${n}인분</button>`).join('')}
    </div>
    ${recipeImageSrc(r) ? `<img class="modalRecipeImage" src="${recipeImageSrc(r)}" alt="${r.name} 완성 및 플레이팅 참고 이미지">
    ${recipePhotoCredit(r)}
    <div class="platingHint">📸 완성 이미지의 담음새와 고명 배치를 플레이팅 참고용으로 활용해보세요.</div>` : ""}
    ${r.nutrition ? `<div class="box">
      <h4>🔥 영양정보 (1인분${r.nutrition.estimated ? ", 추정" : ""})</h4>
      ${[["열량",r.nutrition.kcal,"kcal"],["탄수화물",r.nutrition.carb,"g"],["단백질",r.nutrition.protein,"g"],["지방",r.nutrition.fat,"g"],["나트륨",r.nutrition.sodium,"mg"]]
        .filter(([,v])=>v!=null).map(([label,v,unit])=>`<div class="row"><span>${label}</span><b>${Math.round(v*currentServings)}${unit}</b></div>`).join("")}
    </div>` : ""}
    ${r.nutrition?.highlights?.length ? `<div class="box">
      <h4>⚖️ 칼로리를 많이 차지하는 재료</h4>
      ${r.nutrition.highlights.map(calorieHighlightRow).join("")}
    </div>` : ""}
    <div class="box">
      <h4>🥬 필요한 재료</h4>
      ${Object.entries(r.ingredients).map(([name,q])=>{
        const unit = recipeUnit(name);
        const need = q * currentServings;
        const have = inventoryAmountInRecipeUnit(name, inventory);
        const enough = have + 0.0001 >= need;
        const stockText = inventoryDisplayForRecipeIngredient(name, inventory);
        return `<div class="row">
          <span>${name}<br><small style="color:var(--muted)">냉장고 ${stockText}</small></span>
          <b style="color:${enough ? 'var(--brand)' : '#b35a4f'}">${fmt(need, unit)} ${enough ? '✓' : '부족'}</b>
        </div>`;
      }).join("")}
    </div>
    <div class="box">
      <h4>${isPublicRecipe(r) ? "🥄 그 밖의 재료 / 양념" : "🥄 양념장 / 간 맞추기"}</h4>
      ${r.seasonings.map(([name,q])=>`<div class="row"><span>${name} <small style="color:${seasoningAvailable(name) ? 'var(--brand)' : '#b35a4f'};font-weight:800">${seasoningAvailable(name) ? '✓ 있음' : '없음'}</small></span><b>${scale(q)}</b></div>`).join("")}
    </div>
    <div class="box">
      <h4>👩‍🍳 만드는 순서</h4>
      <div class="steps">
        ${stepsWithAmounts(r).map((step,i)=>`<div class="step"><div class="num">${i+1}</div><div>${step}</div></div>`).join("")}
      </div>
    </div>
    ${r.tip ? `<div class="box"><h4>💡 TIP</h4><div style="font-size:12px;line-height:1.6">${r.tip}</div></div>` : ""}
    <div class="webref">🌐 ${r.source}${r.sourceUrl ? `<br><a href="${r.sourceUrl}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:800;text-decoration:none">원문 참고하기 ↗</a>` : ""}</div>
    <div class="modalFooter">
      ${canCookRecipe(r, currentServings, inventory)
        ? `<b style="font-size:12px;color:var(--brand)">✓ 냉장고 재료로 바로 만들 수 있어요. 완료를 누르면 실제 사용량만큼 자동 차감됩니다.</b>
           <button class="btn primary" onclick="completeCooking()">✓ 요리 완료 · 재료 차감</button>`
        : `<div class="miss">⚠️ 이 메뉴는 현재 ‘조금만 더 사면 가능’ 메뉴입니다.<br>부족: ${missing(r, inventory, currentServings).map(x=>x[0] + " " + x[1] + unitFor(x[0])).join(", ")}</div>`
      }
    </div>
  `;
}
async function completeCooking(){
  const r = RECIPES.find(x=>x.id===currentRecipeId);
  if(!canCookRecipe(r, currentServings, inventory)){
    const actualMissing = missing(r, inventory, currentServings);
    const msg = actualMissing.slice(0,3).map(x=>x[0] + " " + x[1] + unitFor(x[0])).join(" · ");
    toast("부족한 재료: " + msg);
    return;
  }
  if(!inventoryUser) return;
  if(inventory.some(item=>item.id==null)){
    toast("냉장고 연결을 확인한 후 다시 시도해주세요.");
    return;
  }

  await runInventoryOperation("재료 차감 저장 중...",async()=>{
  const beforeInventory = inventory.map(item=>({...item}));
  let nextInventory = inventory.map(item=>({...item}));
  const deductions = [];

  Object.entries(r.ingredients).forEach(([name, need])=>{
    const usedInRecipeUnit = need * currentServings;
    const rows = deductIngredient(name, usedInRecipeUnit,nextInventory);
    deductions.push(...rows);
  });

  // 0이 된 재료는 냉장고 목록에서 제거
  nextInventory = nextInventory.filter(x=>Number(x.qty) > 0);

  // 날짜가 있는 재료는 실제 소비기한 기준으로 남은 일수를 유지한다.
  nextInventory.forEach(x=>{
    x.days = isValidDateValue(x.expiryDate)
      ? remainingDaysUntil(x.expiryDate)
      : Math.max(0,x.days-1);
  });

  await IngredientStore.syncChanges(inventoryUser.id,beforeInventory,nextInventory);

  inventory = nextInventory;

  // 방금 차감된 내역 저장
  lastDeductions = deductions;

  // 완료한 메뉴는 추천/요리 목록에서 숨김
  if(!cookedHistory.some(h=>h.id===r.id)){
    cookedHistory.push({
      id:r.id,
      name:r.name,
      emoji:r.emoji,
      servings:currentServings,
      timeLabel:new Date().toLocaleString("ko-KR")
    });
  }

  save();
  closeModal();
  render();

  // 차감이 바로 보이도록 냉장고 화면으로 이동
  go('fridgeView');

  const summary = deductions
    .slice(0,3)
    .map(d=>`${d.name} -${d.used}${d.unit}`)
    .join(" · ");

  toast(summary ? `차감 완료! ${summary}` : "재료 차감 완료!");
  });
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
}
function notifyInventoryReady(user){
  window.dispatchEvent(new CustomEvent("todayssak:inventory-ready",{detail:{user}}));
}
async function loadInventoryForUser(user,{force=false}={}){
  if(!user?.id) return;
  if(loadedInventoryUserId===user.id && !force){
    notifyInventoryReady(user);
    return;
  }
  if(inventoryLoadingUserId===user.id) return;

  if(force) loadedInventoryUserId = null;
  const sequence = ++inventoryLoadSequence;
  inventoryLoadingUserId = user.id;
  inventoryUser = user;
  setInventoryBusy(true,"냉장고 불러오는 중...");

  try{
    let remoteInventory = await IngredientStore.getAll(user.id);
    if(sequence!==inventoryLoadSequence || inventoryUser?.id!==user.id) return;

    if(remoteInventory.length===0){
      const legacyInventory = AppStorage.loadLegacyInventory();
      if(legacyInventory?.length){
        inventory = JSON.parse(JSON.stringify(legacyInventory));
        syncInventoryExpiryDates();
        remoteInventory = await IngredientStore.insertMany(user.id,inventory);
      }
    }

    if(sequence!==inventoryLoadSequence || inventoryUser?.id!==user.id) return;
    inventory = remoteInventory;
    const expiryChanges = syncInventoryExpiryDates();
    if(expiryChanges.length) await IngredientStore.updateMany(user.id,expiryChanges);

    AppStorage.removeLegacyInventory();
    loadedInventoryUserId = user.id;
    inventorySyncBlocked = false;
    clearInventorySyncNotice();
    render();
    notifyInventoryReady(user);
  }catch(error){
    if(sequence!==inventoryLoadSequence || inventoryUser?.id!==user.id) return;
    console.error("[ingredients] 냉장고 불러오기 실패",error);
    inventorySyncBlocked = true;
    showInventorySyncNotice("서버 데이터를 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.");
    const legacyInventory = AppStorage.loadLegacyInventory();
    inventory = legacyInventory ? JSON.parse(JSON.stringify(legacyInventory)) : [];
    syncInventoryExpiryDates();
    render();
    notifyInventoryReady(user);
    toast("냉장고 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }finally{
    if(sequence===inventoryLoadSequence){
      inventoryLoadingUserId = null;
      setInventoryBusy(false);
    }
  }
}
function retryInventoryLoad(){
  if(!inventoryUser || inventoryOperationBusy) return;
  loadInventoryForUser(inventoryUser,{force:true});
}
function render(){
  const expiryChanges = syncInventoryExpiryDates();
  if(expiryChanges.length && inventoryUser){
    IngredientStore.updateMany(inventoryUser.id,expiryChanges)
      .catch(error=>reportInventoryError("소비기한 갱신 실패",error));
  }
  renderStats();
  renderUrgentIngredients();
  renderIngredients();
  renderPantry();
  renderRecipes();
  renderPlan();
  renderHistory();
  renderDeductions();
}
document.getElementById("nameInput").addEventListener("keydown", e=>{ if(e.key==="Enter") addIngredient(); });
document.getElementById("qtyInput").addEventListener("keydown", e=>{ if(e.key==="Enter") addIngredient(); });
document.getElementById("daysInput").addEventListener("change", toggleExpiryDateInput);
document.getElementById("pantryInput").addEventListener("keydown", e=>{ if(e.key==="Enter") addPantryItem(); });
function loadUserData(user){
  loadInventoryForUser(user);
  loadSavedRecipes();
  loadPantry(user);
}
window.addEventListener("todayssak:auth-changed",event=>{
  const user = event.detail?.user;
  if(user){
    loadUserData(user);
    return;
  }

  pantryItems = [];
  pantryUserId = null;
  renderPantry();
  go("landingView");

  inventoryLoadSequence += 1;
  inventoryLoadingUserId = null;
  loadedInventoryUserId = null;
  inventoryUser = null;
  inventorySyncBlocked = false;
  setInventoryBusy(false);
  clearInventorySyncNotice();
  inventory = [];
  selectionMode = false;
  selectedIngredientIds.clear();
  render();
});
toggleExpiryDateInput();
render();
if(window.currentAuthUser) loadUserData(window.currentAuthUser);
