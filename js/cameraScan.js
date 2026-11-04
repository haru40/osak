// 카메라에 비친 물체에 사각형을 그리고, 가운데 물체의 이름을 버튼 없이 찾아 카드로 보여준다.
// 사각형은 폰 안의 모델이 그리므로 무료이고, 장면이 바뀌었을 때만 크레딧이 나간다.
const CAMERA_TICK_MS = 350;
const CAMERA_STILL_TICKS = 2;
const CAMERA_FRAME_SIZE = 32;
const CAMERA_STILL_DIFF = 10;
const CAMERA_CHANGED_DIFF = 14;
// 손이 계속 흔들려 멈춘 순간이 없어도 이 시간이 지나면 인식한다.
const CAMERA_FORCE_MS = 2500;
const CAMERA_DARK_LEVEL = 25;
const CAMERA_CROP_RATIO = 0.75;
const CAMERA_SEND_SIDE = 640;
const CAMERA_JPEG_QUALITY = 0.75;
const CAMERA_MAX_SCANS = 60;
const CAMERA_NOTICE_MS = 2500;
const DETECTOR_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
  "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"
];
const DETECT_GAP_MS = 120;
const DETECT_MAX_BOXES = 8;
const DETECT_MIN_SCORE = 0.3;
const BOX_CROP_PADDING = 0.15;
const TARGET_MAX_OFFSET = 0.3;
// 폰 안의 모델이 아는 먹거리와 용기만 사각형으로 보여준다. 정확한 이름은 OpenAI가 찾는다.
const DETECT_LABELS = {
  apple:"사과",banana:"바나나",orange:"오렌지",broccoli:"브로콜리",carrot:"당근",
  sandwich:"샌드위치","hot dog":"소시지",pizza:"피자",donut:"도넛",cake:"케이크",
  bottle:"병",cup:"컵",bowl:"그릇"
};

let camera = null;
let detectorLoading = null;

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
  if(!camera.item && Date.now()>=camera.noticeUntil) setCameraStatus(text);
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
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}
function loadDetector(){
  detectorLoading = detectorLoading || (async()=>{
    for(const src of DETECTOR_SCRIPTS) await loadScript(src);
    return cocoSsd.load({base:"lite_mobilenet_v2"});
  })().catch(error=>{
    detectorLoading = null;
    throw error;
  });
  return detectorLoading;
}
// 화면 가운데에 있는 물체만 대상으로 삼고, 그중 크고 가운데에 가까운 것을 고른다.
function boxOffset({bbox:[x,y,width,height]},video){
  return Math.max(Math.abs((x+width/2)/video.videoWidth-0.5),Math.abs((y+height/2)/video.videoHeight-0.5));
}
function pickTargetBox(boxes,video){
  const score = box=>box.bbox[2]*box.bbox[3]*(1-boxOffset(box,video));
  return boxes
    .filter(box=>boxOffset(box,video)<=TARGET_MAX_OFFSET)
    .reduce((best,box)=>!best || score(box)>score(best) ? box : best,null);
}
function drawCameraBoxes(){
  const canvas = cameraEl("cameraBoxes");
  const video = cameraEl("cameraVideo");
  const scale = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth*scale;
  canvas.height = canvas.clientHeight*scale;
  const context = canvas.getContext("2d");
  context.scale(scale,scale);
  context.font = "800 14px sans-serif";
  context.lineJoin = "round";
  // 영상이 화면을 꽉 채우도록 잘려 있으므로 같은 비율로 좌표를 옮긴다.
  const fit = Math.max(canvas.clientWidth/video.videoWidth,canvas.clientHeight/video.videoHeight);
  const left = (canvas.clientWidth-video.videoWidth*fit)/2;
  const top = (canvas.clientHeight-video.videoHeight*fit)/2;
  for(const box of camera.boxes){
    const [x,y,width,height] = box.bbox.map(value=>value*fit);
    const isTarget = box===camera.target;
    const color = isTarget ? "#35d07f" : "#ffffff";
    context.strokeStyle = color;
    context.lineWidth = isTarget ? 4 : 2;
    context.strokeRect(left+x,top+y,width,height);
    const name = isTarget && camera.item ? camera.item.name : DETECT_LABELS[box.class];
    const label = isTarget && camera.item ? name : `${name} ${Math.round(box.score*100)}%`;
    const labelWidth = context.measureText(label).width+12;
    const labelTop = Math.max(0,top+y-24);
    context.fillStyle = color;
    context.fillRect(left+x,labelTop,labelWidth,24);
    context.fillStyle = "#10201a";
    context.fillText(label,left+x+6,labelTop+17);
  }
}
async function runDetector(session){
  let detector;
  try{
    detector = await loadDetector();
  }catch(error){
    // 모델을 못 받아도 가운데 네모 칸 방식으로 계속 쓸 수 있다.
    console.error("[cameraScan]",error);
    return;
  }
  const video = cameraEl("cameraVideo");
  while(session===camera){
    if(video.readyState>=2 && !session.editing){
      const found = await detector.detect(video,DETECT_MAX_BOXES,DETECT_MIN_SCORE);
      if(session!==camera) return;
      session.boxes = found.filter(box=>DETECT_LABELS[box.class]);
      session.target = pickTargetBox(session.boxes,video);
      cameraEl("cameraScreen").classList.toggle("hasBoxes",Boolean(session.target));
      drawCameraBoxes();
    }
    await new Promise(resolve=>setTimeout(resolve,DETECT_GAP_MS));
  }
}
function cropArea(video,box){
  if(!box){
    const side = Math.min(video.videoWidth,video.videoHeight)*CAMERA_CROP_RATIO;
    return [(video.videoWidth-side)/2,(video.videoHeight-side)/2,side,side];
  }
  const [x,y,width,height] = box.bbox;
  const padX = width*BOX_CROP_PADDING;
  const padY = height*BOX_CROP_PADDING;
  const left = Math.max(0,x-padX);
  const top = Math.max(0,y-padY);
  return [
    left,top,
    Math.min(video.videoWidth,x+width+padX)-left,
    Math.min(video.videoHeight,y+height+padY)-top
  ];
}
function cropCameraPhoto(video,box){
  const [x,y,width,height] = cropArea(video,box);
  const fit = Math.min(1,CAMERA_SEND_SIDE/Math.max(width,height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width*fit);
  canvas.height = Math.round(height*fit);
  canvas.getContext("2d").drawImage(video,x,y,width,height,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",CAMERA_JPEG_QUALITY);
}
function cameraIsWaiting(){
  return camera && !camera.busy && !camera.editing;
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
  const sameScene = camera.sentFrame && frameDiff(frame,camera.sentFrame)<CAMERA_CHANGED_DIFF;
  if(sameScene){
    camera.changedAt = 0;
    return;
  }
  camera.changedAt = camera.changedAt || Date.now();
  const waitedLong = Date.now()-camera.changedAt>=CAMERA_FORCE_MS;
  if(camera.stillTicks>=CAMERA_STILL_TICKS || waitedLong) scanCameraFrame();
  else setCameraHint("재료를 네모 칸에 맞춰주세요");
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
  session.changedAt = 0;
  setCameraHint("무엇인지 보는 중...");
  try{
    const items = await requestScan([cropCameraPhoto(cameraEl("cameraVideo"),session.target)],"single");
    // 인식하는 사이 카드를 고치기 시작했다면 덮어쓰지 않는다.
    if(session!==camera || session.editing) return;
    if(items.length){
      showCameraCard(items[0]);
    }else{
      closeCameraCard();
      showCameraNotice("식재료를 찾지 못했어요. 더 가까이 비춰주세요");
    }
  }catch(error){
    console.error("[cameraScan]",error);
    if(session===camera) showCameraNotice("인식하지 못했어요. 다시 비춰주세요");
  }finally{
    session.busy = false;
    session.stillTicks = 0;
  }
}
function holdCameraCard(){
  if(camera) camera.editing = true;
}
function showCameraCard(item){
  camera.item = item;
  cameraEl("cameraGuideName").textContent = item.name;
  cameraEl("cameraName").value = item.name;
  const seasoning = item.kind==="seasoning";
  cameraEl("cameraTag").hidden = !seasoning;
  cameraEl("cameraAmounts").hidden = seasoning;
  cameraEl("cameraQty").value = item.qty;
  cameraEl("cameraUnit").value = item.unit;
  cameraEl("cameraDays").value = item.days;
  cameraEl("cameraCard").hidden = false;
  setCameraStatus("맞으면 등록을 눌러주세요");
}
function changeCameraQty(step){
  const input = cameraEl("cameraQty");
  input.value = Math.max(1,Number(input.value)+step);
}
function closeCameraCard(){
  camera.item = null;
  camera.editing = false;
  cameraEl("cameraGuideName").textContent = "";
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
    camera = {stream,canvas,frame:null,sentFrame:null,stillTicks:0,busy:false,item:null,boxes:[],target:null,editing:false,changedAt:0,scans:0,saved:0,timer:null,noticeUntil:0};
    cameraEl("cameraScreen").hidden = false;
    cameraEl("cameraCount").textContent = "";
    cameraEl("cameraGuideName").textContent = "";
    setCameraStatus("재료를 네모 칸에 맞춰주세요");
    const video = cameraEl("cameraVideo");
    video.srcObject = stream;
    await video.play();
    camera.timer = setInterval(cameraTick,CAMERA_TICK_MS);
    runDetector(camera);
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
  cameraEl("cameraScreen").classList.remove("hasBoxes");
}

document.addEventListener("visibilitychange",()=>{
  if(document.hidden) closeCamera();
});
