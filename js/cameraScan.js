// 카메라를 비추다가 화면이 멈추면 가운데 물건 하나를 인식해 카드로 보여준다.
// 화면 변화는 폰에서 계산하므로, 멈춘 장면이 바뀌었을 때만 크레딧이 나간다.
const CAMERA_TICK_MS = 350;
const CAMERA_STILL_TICKS = 3;
const CAMERA_FRAME_SIZE = 32;
const CAMERA_STILL_DIFF = 6;
const CAMERA_CHANGED_DIFF = 12;
const CAMERA_DARK_LEVEL = 25;
const CAMERA_CROP_RATIO = 0.75;
const CAMERA_SEND_SIDE = 640;
const CAMERA_JPEG_QUALITY = 0.75;
const CAMERA_MAX_SCANS = 60;
const CAMERA_NOTICE_MS = 2500;

let camera = null;

function cameraEl(id){
  return document.getElementById(id);
}
function setCameraStatus(text){
  cameraEl("cameraStatus").textContent = text;
}
// 결과 안내는 잠시 유지해서 기본 안내에 바로 덮이지 않게 한다.
function showCameraNotice(text){
  camera.noticeUntil = Date.now()+CAMERA_NOTICE_MS;
  setCameraStatus(text);
}
function setCameraHint(text){
  if(Date.now()>=camera.noticeUntil) setCameraStatus(text);
}
function readCameraFrame(video,canvas){
  const context = canvas.getContext("2d",{willReadFrequently:true});
  context.drawImage(video,0,0,CAMERA_FRAME_SIZE,CAMERA_FRAME_SIZE);
  const {data} = context.getImageData(0,0,CAMERA_FRAME_SIZE,CAMERA_FRAME_SIZE);
  const levels = new Uint8Array(CAMERA_FRAME_SIZE*CAMERA_FRAME_SIZE);
  for(let i=0;i<levels.length;i++) levels[i] = (data[i*4]+data[i*4+1]+data[i*4+2])/3;
  return levels;
}
function frameAverage(frame){
  return frame.reduce((sum,level)=>sum+level,0)/frame.length;
}
function frameDiff(first,second){
  let sum = 0;
  for(let i=0;i<first.length;i++) sum += Math.abs(first[i]-second[i]);
  return sum/first.length;
}
function cropCameraPhoto(video){
  const side = Math.min(video.videoWidth,video.videoHeight)*CAMERA_CROP_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CAMERA_SEND_SIDE;
  canvas.getContext("2d").drawImage(
    video,
    (video.videoWidth-side)/2,(video.videoHeight-side)/2,side,side,
    0,0,CAMERA_SEND_SIDE,CAMERA_SEND_SIDE
  );
  return canvas.toDataURL("image/jpeg",CAMERA_JPEG_QUALITY);
}
function cameraIsWaiting(){
  return camera && !camera.busy && !camera.item;
}
function cameraTick(){
  if(!cameraIsWaiting() || cameraEl("cameraVideo").readyState<2) return;
  const frame = readCameraFrame(cameraEl("cameraVideo"),camera.canvas);
  const previous = camera.frame;
  camera.frame = frame;
  if(frameAverage(frame)<CAMERA_DARK_LEVEL){
    camera.stillTicks = 0;
    setCameraHint("화면이 너무 어두워요");
    return;
  }
  const still = previous && frameDiff(frame,previous)<CAMERA_STILL_DIFF;
  camera.stillTicks = still ? camera.stillTicks+1 : 0;
  if(camera.stillTicks<CAMERA_STILL_TICKS){
    setCameraHint("재료를 네모 칸에 맞춰주세요");
    return;
  }
  const sameScene = camera.sentFrame && frameDiff(frame,camera.sentFrame)<CAMERA_CHANGED_DIFF;
  if(!sameScene) scanCameraFrame();
}
async function scanCameraFrame(){
  if(!cameraIsWaiting()) return;
  if(camera.scans>=CAMERA_MAX_SCANS){
    showCameraNotice("인식 횟수를 다 썼어요. 다시 열어주세요");
    return;
  }
  const session = camera;
  session.busy = true;
  session.scans += 1;
  session.sentFrame = session.frame;
  setCameraStatus("무엇인지 보는 중...");
  try{
    const items = await requestScan([cropCameraPhoto(cameraEl("cameraVideo"))],"single");
    if(session!==camera) return;
    if(items.length) showCameraCard(items[0]);
    else showCameraNotice("식재료를 찾지 못했어요. 더 가까이 비춰주세요");
  }catch(error){
    console.error("[cameraScan]",error);
    if(session===camera) showCameraNotice("인식하지 못했어요. 다시 비춰주세요");
  }finally{
    session.busy = false;
    session.stillTicks = 0;
  }
}
function showCameraCard(item){
  camera.item = item;
  cameraEl("cameraName").value = item.name;
  const seasoning = item.kind==="seasoning";
  cameraEl("cameraTag").hidden = !seasoning;
  cameraEl("cameraAmounts").hidden = seasoning;
  cameraEl("cameraQty").value = item.qty;
  cameraEl("cameraUnit").value = item.unit;
  cameraEl("cameraDays").value = item.days;
  cameraEl("cameraCard").hidden = false;
  setCameraStatus("맞는지 확인해주세요");
}
function changeCameraQty(step){
  const input = cameraEl("cameraQty");
  input.value = Math.max(1,Number(input.value)+step);
}
function closeCameraCard(){
  camera.item = null;
  camera.stillTicks = 0;
  cameraEl("cameraCard").hidden = true;
  setCameraStatus("재료를 네모 칸에 맞춰주세요");
}
async function registerCameraItem(){
  const name = cameraEl("cameraName").value.trim();
  const seasoning = camera.item.kind==="seasoning";
  const row = seasoning
    ? {kind:"seasoning",name}
    : {kind:"ingredient",name,qty:Number(cameraEl("cameraQty").value),unit:cameraEl("cameraUnit").value,days:Number(cameraEl("cameraDays").value)};
  if(!name || (!seasoning && !(row.qty>0))){ toast("재료명과 양을 확인해주세요."); return; }
  if(!await storeScanRows([row])) return;
  camera.saved += 1;
  cameraEl("cameraCount").textContent = `${camera.saved}개 등록`;
  toast(`${name} 추가 완료`);
  closeCameraCard();
}
async function openCamera(){
  if(camera) return;
  if(!PHOTO_SCAN_URL){ toast("사진 분석 주소가 아직 연결되지 않았어요."); return; }
  if(!navigator.mediaDevices?.getUserMedia){
    toast("이 브라우저에서는 카메라를 쓸 수 없어요. 사진으로 등록해주세요.");
    return;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"},width:{ideal:1280}},
      audio:false
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CAMERA_FRAME_SIZE;
    camera = {stream,canvas,frame:null,sentFrame:null,stillTicks:0,busy:false,item:null,scans:0,saved:0,timer:null,noticeUntil:0};
    cameraEl("cameraScreen").hidden = false;
    cameraEl("cameraCount").textContent = "";
    setCameraStatus("재료를 네모 칸에 맞춰주세요");
    const video = cameraEl("cameraVideo");
    video.srcObject = stream;
    await video.play();
    camera.timer = setInterval(cameraTick,CAMERA_TICK_MS);
  }catch(error){
    console.error("[cameraScan]",error);
    closeCamera();
    toast(error.name==="NotAllowedError"
      ? "카메라 권한을 허용해주세요. 브라우저 설정에서 바꿀 수 있어요."
      : "카메라를 켜지 못했어요. 사진으로 등록해주세요.");
  }
}
function closeCamera(){
  if(!camera) return;
  clearInterval(camera.timer);
  camera.stream.getTracks().forEach(track=>track.stop());
  camera = null;
  cameraEl("cameraVideo").srcObject = null;
  cameraEl("cameraCard").hidden = true;
  cameraEl("cameraScreen").hidden = true;
}

document.addEventListener("visibilitychange",()=>{
  if(document.hidden) closeCamera();
});
