// DMPW check-in web — fires one full "Face ID" event per check-in via the bridge.
const LS_KEY = "dmpw_checkin_user";

// HTTP->MQTT bridge (Render). It publishes the full "Face ID" device event, then
// attaches the chosen photo via /event-logs/{device}/images. Required to check in.
const BRIDGE_URL = "https://dcface-bridge.onrender.com";

let USERS = [];
let selectedImg = null; // { path, el } of the highlighted thumbnail

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }

function imgPath(user, idx) {
  return `images/${user.key}/${pad(idx)}.jpg`;
}

function currentUser() {
  const key = localStorage.getItem(LS_KEY);
  return USERS.find((u) => u.key === key) || null;
}

function toast(msg, type) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (type || "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 3500);
}

function render() {
  const user = currentUser();
  if (user) {
    $("welcome").classList.add("hidden");
    $("identity").classList.remove("hidden");
    $("userName").textContent = user.name;
    $("avatar").src = imgPath(user, 1);
  } else {
    $("identity").classList.add("hidden");
    $("welcome").classList.remove("hidden");
  }
}

function openPicker() {
  const ul = $("userList");
  ul.innerHTML = "";
  USERS.forEach((u) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<img class="u-avatar" src="${imgPath(u, 1)}" alt="" />` +
      `<span class="u-name">${u.name}</span>`;
    li.onclick = () => {
      localStorage.setItem(LS_KEY, u.key);
      $("picker").classList.add("hidden");
      render();
    };
    ul.appendChild(li);
  });
  $("picker").classList.remove("hidden");
}

// datetime-local value (YYYY-MM-DDTHH:mm) from a Date in device-local time.
function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ddMMyyyyHHmmss from the time input (past time allowed). datetime-local has no
// seconds field, so randomize the seconds instead of always sending 00.
function stampFromInput() {
  const v = $("timeInput").value;
  const d = v ? new Date(v) : new Date();
  const sec = v ? Math.floor(Math.random() * 60) : d.getSeconds();
  return pad(d.getDate()) + pad(d.getMonth() + 1) + d.getFullYear() +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(sec);
}

// Open the sheet to pick an image + a check-in time (does not fire yet).
function openCheckinSheet() {
  const user = currentUser();
  if (!user) return;
  $("timeInput").value = fmtLocal(new Date());
  selectedImg = null;
  const grid = $("imgGrid");
  grid.innerHTML = "";
  for (let i = 1; i <= user.count; i++) {
    const path = imgPath(user, i);
    const img = document.createElement("img");
    img.src = path;
    img.alt = "";
    img.onclick = () => selectImg(path, img);
    grid.appendChild(img);
  }
  $("checkinSheet").classList.remove("hidden");
}

// Clicking a thumbnail only highlights it; sending needs the Xác nhận button.
function selectImg(path, el) {
  if (selectedImg) selectedImg.el.classList.remove("selected");
  el.classList.add("selected");
  selectedImg = { path: path, el: el };
  openConfirm();
}

// dd/MM/yyyy HH:mm from the time input, for the confirmation text.
function readableTime() {
  const v = $("timeInput").value;
  if (!v) return "bây giờ";
  const d = new Date(v);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Final confirmation: restate the chosen photo + time before sending.
function openConfirm() {
  const user = currentUser();
  if (!user || !selectedImg) return;
  $("confirmImg").src = selectedImg.path;
  $("confirmText").innerHTML =
    `Chấm công cho <b>${user.name}</b><br>lúc <b>${readableTime()}</b><br>với ảnh này?`;
  $("confirmSheet").classList.remove("hidden");
}

async function sendCheckin(user, path) {
  const stamp = stampFromInput();
  const whenLabel = $("timeInput").value;
  const imageUrl = new URL(path, location.href).href; // absolute URL the server can fetch
  $("checkinSheet").classList.add("hidden");
  if (!BRIDGE_URL) {
    toast("✗ Chưa cấu hình bridge", "err");
    return;
  }
  try {
    // The bridge publishes the full "Face ID" event, then attaches this photo
    // via /event-logs/{device}/images (no ts-webhook -> no server crash).
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      await fetch(BRIDGE_URL + "/fire-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId: user.cardId, userName: user.name, accessTime: stamp, imageUrl: imageUrl,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    $("avatar").src = path;
    toast("✓ Đã gửi chấm công lúc " + (whenLabel || "bây giờ"), "ok");
  } catch (e) {
    toast("✗ " + e.message, "err");
  }
}

async function init() {
  USERS = await fetch("users.json").then((r) => r.json());
  $("btnCheckin").onclick = openCheckinSheet;
  $("btnWhoami").onclick = openPicker;
  $("btnChange").onclick = () => { localStorage.removeItem(LS_KEY); render(); };
  $("pickerClose").onclick = () => $("picker").classList.add("hidden");
  $("checkinClose").onclick = () => $("checkinSheet").classList.add("hidden");
  $("confirmNo").onclick = () => $("confirmSheet").classList.add("hidden");
  $("confirmYes").onclick = () => {
    const user = currentUser();
    const path = selectedImg && selectedImg.path;
    $("confirmSheet").classList.add("hidden");
    if (user && path) sendCheckin(user, path);
  };
  render();
}

init();
